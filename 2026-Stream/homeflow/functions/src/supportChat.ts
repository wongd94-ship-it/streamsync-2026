/**
 * AI Support Chat — Anthropic-backed Cloud Function proxy.
 *
 * Acts as a server-side gate between the iOS app and the Anthropic API.
 * Applies a PII firewall: only firstName + study-logistics fields are
 * ever sent to Claude. lastName, email, phone, DOB, and full clinical
 * dates never leave Firestore.
 *
 * Persists every message to Firestore so the researcher dashboard can
 * watch threads in real time and a researcher can join the conversation
 * directly (their writes are gated by Firestore rules, not this function).
 *
 * Required secret: ANTHROPIC_API_KEY (Firebase Secret Manager).
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {THRONE_SUPPORT_KNOWLEDGE} from "./throneSupportKnowledge";
import {APPLE_HEALTH_KNOWLEDGE} from "./appleHealthKnowledge";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  participantId?: string;
  chatId?: string;
  userMessage?: string;
  conversationHistory?: ChatMessage[];
  triggerReason?: "48h-alert" | "5d-alert" | "participant-initiated";
  /**
   * When true, the client is asking Claude to OPEN the conversation.
   * The function injects a primer turn so the API has a valid first
   * user message — but only Claude's reply is persisted as the visible
   * opening line.
   */
  isOpening?: boolean;
}

// Anthropic Sonnet alias — auto-updates to the latest 4.6 snapshot. The
// original demo file shipped with "claude-sonnet-4-20250514" which was
// never a real model id; using an alias means we don't have to chase
// snapshot IDs as Anthropic releases minor versions.
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 512;
const MAX_HISTORY = 20;

/**
 * Pilot/demo Throne data is shared across all enrolled testers via this
 * canonical UID — the firestore.rules carve out a special allow rule so
 * any signed-in user can read its throne_* subcollections. The (tabs)/index
 * dashboard already pulls voiding stats from here. We fall back to it for
 * the support chat's "last Throne sync" lookup so the chat reflects the
 * same data the dashboard shows during the pilot, before each participant
 * is wired to their own Throne ingestion.
 */
const DEMO_THRONE_UID = "CUziuLyPtDNO2IvSbsifXPKrNEk2";

const OPENING_PRIMER =
  "[CONVERSATION_OPENING] The participant has just tapped a notification " +
  "about a sync issue and opened this support chat. Begin the conversation " +
  "now per your opening instructions.";

// ─── Auth + lookup ───────────────────────────────────────────────────────────

async function authenticateRequest(authHeader: string | undefined): Promise<string> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing Authorization header");
  }
  const token = authHeader.slice("Bearer ".length);
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded.uid;
}

/**
 * Confirms the authenticated UID is the same person as the requested
 * participantId. The Streamsync data model uses Firebase UID as the
 * participant id (users/{uid}), so we just compare them.
 *
 * @param {string} uid - Authenticated Firebase UID from the request token.
 * @param {string} participantId - Participant identifier from the request body.
 */
function assertParticipantOwnership(uid: string, participantId: string): void {
  if (uid !== participantId) {
    throw new Error("UID does not match requested participantId");
  }
}

// ─── Sync-issue detection ────────────────────────────────────────────────────

interface ParticipantContext {
  firstName: string;
  participantId: string;
  currentPhase: string;
  daysInPhase: number | null;
  phaseDurationDays: number | null;
  lastThroneSyncRel: string;
  lastAppleHealthSyncRel: string;
  consecutiveDaysWithoutSync: number;
  deviceModel: string;
  iosVersion: string;
  appleWatchModel: string;
  upcomingClinicalEventRel: string;
  throneIssue: boolean;
  appleIssue: boolean;
  // Study-level context — added so Claude can answer "when is my surgery"
  // / "how long do I have left" without saying "I can't check."
  pathwayLabel: string; // e.g. "Urodynamics monitoring" / "BPH surgery (HoLEP/TURP/etc.)"
  pathwayKey: "uds" | "surgery" | "both" | "unknown";
  urodynamicsDateRel: string | null; // "in 5 days" / "passed 12 days ago" / null
  surgeryDateRel: string | null;
  observationWindowDescription: string; // human-readable expected observation period
  consentStatus: string; // "Signed YYYY-MM-DD" / "Not yet signed"
}

function relativeAge(ts: number | null | undefined): string {
  if (!ts || !Number.isFinite(ts)) return "never synced";
  const ms = Date.now() - ts;
  if (ms < 0) return "just now";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function hoursSince(ts: number | null | undefined): number {
  if (!ts || !Number.isFinite(ts)) return Infinity;
  const ms = Date.now() - ts;
  return Math.max(0, ms / (60 * 60 * 1000));
}

function relativeUpcoming(iso: string | null | undefined): string {
  if (!iso) return "None scheduled";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "None scheduled";
  const days = Math.round((t - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return "Already passed";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} day${days === 1 ? "" : "s"}`;
}

function tsFromAny(value: any): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value?.toDate === "function") {
    return value.toDate().getTime();
  }
  if (typeof value?._seconds === "number") {
    return value._seconds * 1000;
  }
  return null;
}

/**
 * Threshold (in hours) that flips a device from "ok" to "issue". Pulled
 * from /config/support_chat so a researcher can tune it without a
 * redeploy. Defaults to 48 — the canonical sync-alert window.
 */
async function getSyncThresholdHours(): Promise<number> {
  try {
    const snap = await admin.firestore().collection("config").doc("support_chat").get();
    const raw = snap.data()?.syncThresholdHours;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n < 24 * 30) return n;
  } catch (err) {
    logger.warn("Failed to load support_chat config; using default 48h", err);
  }
  return 48;
}

/**
 * Resolve the participant's "last Apple Health sync" by aggregating across
 * the per-metric cursor docs the iOS app writes to /users/{uid}/hk_sync/*.
 * Each doc has a `lastSyncedAt` Timestamp pointing at the most recent
 * sample's endDate for that metric. The freshest value across any metric
 * is the right "did this watch sync recently" signal — it's robust to one
 * metric type returning no samples (e.g. user without HRV-capable Watch).
 *
 * @param {admin.firestore.Firestore} db The Firestore admin instance.
 * @param {string} participantId Firebase UID for the user being queried.
 * @return {Promise<number | null>} Epoch ms of the freshest sync, or null.
 */
async function readLastAppleHealthSync(
  db: admin.firestore.Firestore,
  participantId: string,
): Promise<number | null> {
  try {
    const snap = await db
      .collection("users")
      .doc(participantId)
      .collection("hk_sync")
      .get();
    let max: number | null = null;
    snap.forEach((d) => {
      const ts = tsFromAny(d.data()?.lastSyncedAt);
      if (ts && (max == null || ts > max)) max = ts;
    });
    return max;
  } catch {
    return null;
  }
}

/**
 * Resolve the participant's "last Throne sync" from the throne_sync/state
 * doc written by the throneIngestion Cloud Function. `lastVoidAt` is the
 * timestamp of the most recent void the user actually produced — which is
 * the meaningful signal for "is the device still being used." Falls back
 * to `lastRunAt` (when our ingester last completed) only when no voids
 * have ever been recorded.
 *
 * @param {admin.firestore.Firestore} db The Firestore admin instance.
 * @param {string} participantId Firebase UID for the user being queried.
 * @return {Promise<number | null>} Epoch ms of the most recent void/run.
 */
async function readLastThroneSync(
  db: admin.firestore.Firestore,
  participantId: string,
): Promise<number | null> {
  try {
    const snap = await db
      .collection("users")
      .doc(participantId)
      .collection("throne_sync")
      .doc("state")
      .get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    return tsFromAny(data.lastVoidAt) || tsFromAny(data.lastRunAt) || null;
  } catch {
    return null;
  }
}

/**
 * Pull the participant's signed-consent metadata, if any. Returns a short
 * human-readable status — never the raw PDF URL or signature image.
 *
 * @param {admin.firestore.Firestore} db Admin Firestore handle.
 * @param {string} participantId Firebase UID for the user.
 * @return {Promise<string>} "Signed YYYY-MM-DD" / "Not yet signed".
 */
async function readConsentStatus(
  db: admin.firestore.Firestore,
  participantId: string,
): Promise<string> {
  try {
    const snap = await db
      .collection("users")
      .doc(participantId)
      .collection("consent_response")
      .doc("current")
      .get();
    if (!snap.exists) return "Not yet signed";
    const data = snap.data() ?? {};
    if (!data.given) return "Not yet signed";
    const ts = tsFromAny(data.consentTimestamp) ||
      (typeof data.consentDateLabel === "string" ?
        Date.parse(data.consentDateLabel) :
        null);
    if (!ts) return "Signed (date unknown)";
    const iso = new Date(ts).toISOString().slice(0, 10);
    return `Signed ${iso}`;
  } catch {
    return "Not yet signed";
  }
}

/**
 * Read a date that may be stored as a string (`surgeryDate: "YYYY-MM-DD"`)
 * inside a sub-doc at users/{uid}/{collection}/current. Falls back to the
 * `users/{uid}.{field}` flat field on the user doc when the sub-doc is
 * missing — both are valid storage paths in the current codebase.
 *
 * @param {admin.firestore.Firestore} db Admin Firestore handle.
 * @param {string} participantId Firebase UID.
 * @param {string} subcollection e.g. "surgery_date" or "urodynamics_date".
 * @param {string} field Name of the date field inside that doc.
 * @param {string | null} fallbackOnUserDoc Date string from the user doc, if any.
 * @return {Promise<string | null>} ISO date string or null.
 */
async function readClinicalDate(
  db: admin.firestore.Firestore,
  participantId: string,
  subcollection: string,
  field: string,
  fallbackOnUserDoc: string | null,
): Promise<string | null> {
  try {
    const snap = await db
      .collection("users")
      .doc(participantId)
      .collection(subcollection)
      .doc("current")
      .get();
    if (snap.exists) {
      const v = snap.data()?.[field];
      if (typeof v === "string" && v) return v.slice(0, 10);
      const t = tsFromAny(v);
      if (t) return new Date(t).toISOString().slice(0, 10);
    }
  } catch {
    // ignore
  }
  return fallbackOnUserDoc;
}

/**
 * Render the relative offset of a clinical date as a human phrase.
 *
 * @param {string | null} iso ISO date string (YYYY-MM-DD) or null.
 * @return {string | null} "in 5 days" / "12 days ago" / null.
 */
function relativeClinicalDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.round((t - Date.now()) / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

type PathwayKey = ParticipantContext["pathwayKey"];

/**
 * Compose a short observation-window description tailored to the
 * participant's pathway. These windows are pulled from the protocol notes in
 * CLAUDE.md (UDS pathway: ≥2 weeks pre + UDS + 2 weeks post; surgery pathway:
 * ≥2 weeks pre + surgery + 12 weeks post). Stored as static copy here rather
 * than per-participant config so the function doesn't need to depend on
 * onboarding-service.
 *
 * @param {PathwayKey} pathway Pathway key.
 * @return {string} Observation window summary for the system prompt.
 */
function describeObservationWindow(
  pathway: PathwayKey,
): string {
  switch (pathway) {
  case "uds":
    return "Urodynamics pathway: at least 2 weeks of pre-UDS monitoring, " +
        "the urodynamics study itself, then 2 weeks of post-UDS monitoring.";
  case "surgery":
    return "BPH-surgery pathway: at least 2 weeks of pre-surgery monitoring, " +
        "the BPH procedure (HoLEP / TURP / UroLift / Rezum), then 12 weeks " +
        "of post-surgery monitoring with IPSS questionnaires at 1, 2, and 3 " +
        "months post-op.";
  case "both":
    return "Combined pathway: pre-UDS monitoring, urodynamics, then transition " +
        "to the surgery arm with pre-surgery + 12 weeks of post-surgery " +
        "monitoring.";
  default:
    return "Standard StreamSync monitoring period (varies by pathway).";
  }
}

async function buildParticipantContext(
  participantId: string,
  thresholdHours: number,
): Promise<ParticipantContext> {
  const db = admin.firestore();
  const [userSnap, lastThroneTsAsync, lastAppleTsAsync, consentStatus] =
    await Promise.all([
      db.collection("users").doc(participantId).get(),
      readLastThroneSync(db, participantId),
      readLastAppleHealthSync(db, participantId),
      readConsentStatus(db, participantId),
    ]);
  const data: any = userSnap.exists ? userSnap.data() : {};

  // Surgery + UDS dates: try the dedicated subcollection first
  // (users/{uid}/surgery_date/current), fall back to flat fields on the
  // user doc. Both shapes exist in the current codebase.
  const [surgeryIsoDate, udsIsoDate] = await Promise.all([
    readClinicalDate(
      db,
      participantId,
      "surgery_date",
      "surgeryDate",
      typeof data?.surgeryDate === "string" ? data.surgeryDate : null,
    ),
    readClinicalDate(
      db,
      participantId,
      "urodynamics_date",
      "urodynamicsDate",
      typeof data?.urodynamicsDate === "string" ? data.urodynamicsDate : null,
    ),
  ]);

  // Pathway resolution: the codebase has both `pathway` ("uds" | "bph")
  // and `studyPathway` ("uds" | "surgery") in different writers. Treat
  // "bph" / "surgery" as equivalent.
  let pathwayKey: ParticipantContext["pathwayKey"] = "unknown";
  const pwRaw = (data?.pathway || data?.studyPathway || "").toLowerCase();
  if (pwRaw === "uds") pathwayKey = "uds";
  else if (pwRaw === "surgery" || pwRaw === "bph") pathwayKey = "surgery";
  else if (pwRaw === "both") pathwayKey = "both";
  // If only one of the two dates is set, infer pathway from that.
  if (pathwayKey === "unknown") {
    if (surgeryIsoDate && !udsIsoDate) pathwayKey = "surgery";
    else if (udsIsoDate && !surgeryIsoDate) pathwayKey = "uds";
    else if (surgeryIsoDate && udsIsoDate) pathwayKey = "both";
  }
  const pathwayLabel =
    pathwayKey === "uds" ? "Urodynamics monitoring" :
      pathwayKey === "surgery" ? "BPH surgery monitoring" :
        pathwayKey === "both" ? "Combined urodynamics + BPH-surgery" :
          "Pathway not yet selected";

  // Allow the user doc to override (e.g. if a researcher manually backdates
  // a participant's start), but prefer the live cursor docs since those
  // reflect actual data flow.
  let lastThroneTs =
    lastThroneTsAsync || tsFromAny(data?.lastThroneSyncAt) || null;
  const lastAppleTs =
    lastAppleTsAsync || tsFromAny(data?.lastAppleHealthSyncAt) || null;

  // Pilot fallback: the demo Throne UID hosts shared voiding data for testers
  // who don't yet have their own Throne ingestion wired up. Use it ONLY if we
  // couldn't find data on the participant's real UID — never preferentially.
  if (lastThroneTs == null && participantId !== DEMO_THRONE_UID) {
    lastThroneTs = await readLastThroneSync(db, DEMO_THRONE_UID);
  }

  const throneIssue = hoursSince(lastThroneTs) >= thresholdHours;
  const appleIssue = hoursSince(lastAppleTs) >= thresholdHours;

  const consecutive = Number(data?.consecutiveDaysWithoutSync ?? 0);

  // Pull phase + dates without leaking absolute clinical dates.
  const phase = String(data?.currentPhase ?? "unknown");
  const phaseDuration = Number(data?.phaseDurationDays ?? null);
  const daysInPhase = Number(data?.daysInPhase ?? null);

  const upcoming =
    typeof data?.surgeryDate === "string" ?
      data.surgeryDate :
      typeof data?.urodynamicsDate === "string" ?
        data.urodynamicsDate :
        null;

  return {
    firstName: String(data?.firstName ?? "there").trim() || "there",
    participantId,
    currentPhase: phase,
    daysInPhase: Number.isFinite(daysInPhase) ? daysInPhase : null,
    phaseDurationDays: Number.isFinite(phaseDuration) ? phaseDuration : null,
    lastThroneSyncRel: relativeAge(lastThroneTs),
    lastAppleHealthSyncRel: relativeAge(lastAppleTs),
    consecutiveDaysWithoutSync: Number.isFinite(consecutive) ? consecutive : 0,
    deviceModel: String(data?.deviceModel ?? "iPhone"),
    iosVersion: String(data?.iosVersion ?? "iOS"),
    appleWatchModel: String(data?.appleWatchModel ?? "Apple Watch"),
    upcomingClinicalEventRel: relativeUpcoming(upcoming),
    throneIssue,
    appleIssue,
    pathwayLabel,
    pathwayKey,
    urodynamicsDateRel: relativeClinicalDate(udsIsoDate),
    surgeryDateRel: relativeClinicalDate(surgeryIsoDate),
    observationWindowDescription: describeObservationWindow(pathwayKey),
    consentStatus,
  };
}

// ─── System prompt ───────────────────────────────────────────────────────────

function deviceSummary(throneIssue: boolean, appleIssue: boolean): string {
  if (throneIssue && appleIssue) {
    return "Both the Throne uroflow device AND Apple Health/Watch data appear to have " +
      "stopped syncing.";
  }
  if (throneIssue) {
    return "The Throne uroflow device specifically has stopped syncing. " +
      "Apple Health/Watch data is still flowing normally.";
  }
  if (appleIssue) {
    return "Apple Health/Watch data has stopped syncing. " +
      "The Throne uroflow device is still recording normally.";
  }
  return "All devices are currently syncing — this chat may be participant-initiated.";
}

function buildSystemPrompt(ctx: ParticipantContext): string {
  const intro =
    "You are StreamSync Support, a compassionate AI assistant embedded in the " +
    "StreamSync BPH research app. Your job is to help participants resolve device " +
    "sync issues — never to blame or pressure them. Address the participant by " +
    "first name naturally.";
  const phaseTail = ctx.daysInPhase != null && ctx.phaseDurationDays != null ?
    ` (Day ${ctx.daysInPhase} of ${ctx.phaseDurationDays})` :
    "";
  const openingExamples = [
    "   - \"Has anything changed recently with where the device is set up?\"",
    "   - \"Have you noticed anything different about how the app or device has been behaving?\"",
    "   - \"Is there anything going on — travel, illness, a busy stretch — that might " +
      "be making it harder to use the device?\"",
  ].join("\n");
  const youDoNotKnow = [
    "You DO know — and should reference confidently when asked:",
    `- Last Throne sync: ${ctx.lastThroneSyncRel}`,
    `- Last Apple Health/Watch sync: ${ctx.lastAppleHealthSyncRel}`,
    `- Consecutive days without sync: ${ctx.consecutiveDaysWithoutSync}`,
    `- Study pathway: ${ctx.pathwayLabel}`,
    `- Consent status: ${ctx.consentStatus}`,
    `- Urodynamics date: ${ctx.urodynamicsDateRel ?? "not on file"}`,
    `- Surgery date: ${ctx.surgeryDateRel ?? "not on file"}`,
    `- Expected observation window: ${ctx.observationWindowDescription}`,
    `- ${ctx.firstName}'s first name, participant ID, study phase, and device model`,
    "",
    "If the participant asks any of the following, answer with the specific value above:",
    "  - \"is my data syncing?\" / \"when did you last see data?\" / \"is my Throne working?\"",
    "  - \"when is my urodynamics study?\" / \"when is my surgery?\"",
    "  - \"how long do I need to keep doing this?\" / \"when does the study end?\"",
    "  - \"did I sign the consent?\" / \"do you have my consent?\"",
    "Do NOT say \"I can't check\" — those values are live, derived from Firestore moments",
    "before this conversation, and they are accurate. If a value is \"not on file,\" tell",
    "the participant that and offer to flag it to the research team.",
    "",
    `You do NOT have access to ${ctx.firstName}'s last name, email, phone, medical`,
    "history details, or any clinical findings outside the sync timestamps + study",
    "logistics above. Never give medical advice and never speculate about the meaning",
    "of voiding data or vital-sign trends. If they ask you to contact them, let them",
    "know the research team will follow up.",
  ].join("\n");
  const ongoingRules = [
    "- Warm, non-judgmental tone — frame all problems as device/software issues, " +
      "never user error",
    "- Address troubleshooting based on which device is the issue (see Sync Issue " +
      "Summary above)",
    "- After 3 failed troubleshooting exchanges, escalate gracefully",
    "- Never give medical advice. Never discuss study results. 2-4 sentences per reply.",
  ].join("\n");
  const escalateLine =
    "When escalating: \"I'm flagging this for our research coordinator — they'll be " +
    `in touch soon. Thank you for your patience, ${ctx.firstName}."`;
  return `${intro}

## Participant Context
- First name: ${ctx.firstName}
- Participant ID: ${ctx.participantId}
- Study pathway: ${ctx.pathwayLabel}
- Monitoring Phase: ${ctx.currentPhase}${phaseTail}
- Last Throne sync: ${ctx.lastThroneSyncRel}
- Last Apple Health/Watch sync: ${ctx.lastAppleHealthSyncRel}
- Consecutive days without sync: ${ctx.consecutiveDaysWithoutSync}
- Device: ${ctx.deviceModel}, ${ctx.iosVersion}
- Apple Watch: ${ctx.appleWatchModel}
- Upcoming event: ${ctx.upcomingClinicalEventRel}

## Study Logistics
- Consent status: ${ctx.consentStatus}
- Urodynamics date: ${ctx.urodynamicsDateRel ?? "not on file"}
- Surgery date: ${ctx.surgeryDateRel ?? "not on file"}
- Expected observation window: ${ctx.observationWindowDescription}

## Sync Issue Summary
${deviceSummary(ctx.throneIssue, ctx.appleIssue)}

## Opening the Conversation (your FIRST message only)
When you receive the [CONVERSATION_OPENING] signal, you must open the chat with a brief, warm message that:
1. Greets ${ctx.firstName} by first name
2. Acknowledges specifically WHICH device appears to have a sync issue (do not mention devices that are syncing fine)
3. Asks ONE open-ended question to understand their circumstances — examples:
${openingExamples}
4. Do NOT start listing troubleshooting steps in your opening message
5. Keep it to 2–3 sentences total

After the participant responds, then begin troubleshooting based on what they share.

## What You Know vs. Don't Know
${youDoNotKnow}

## Ongoing Conversation Rules
${ongoingRules}

${THRONE_SUPPORT_KNOWLEDGE}

${APPLE_HEALTH_KNOWLEDGE}

${escalateLine}`;
}

// ─── Anthropic call ──────────────────────────────────────────────────────────

interface AnthropicMessageParam {
  role: "user" | "assistant";
  content: string;
}

async function callAnthropic(
  systemPrompt: string,
  messages: AnthropicMessageParam[],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "<no body>");
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data: any = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Anthropic response had no text content");
  }
  return text.trim();
}

// ─── Persistence ─────────────────────────────────────────────────────────────

async function ensureChatDoc(opts: {
  participantId: string;
  chatId: string | undefined;
  triggerReason: ChatRequest["triggerReason"];
  ctx: ParticipantContext;
}): Promise<{chatId: string; created: boolean}> {
  const db = admin.firestore();
  const col = db.collection("supportChats");
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (opts.chatId) {
    const ref = col.doc(opts.chatId);
    await ref.set(
      {
        participantId: opts.participantId,
        triggerReason: opts.triggerReason ?? "participant-initiated",
        status: "open",
        lastActivity: now,
        // Snapshot of context at last interaction — useful for the
        // researcher dashboard to render a sync banner without
        // re-deriving from hk_sync collections.
        contextSnapshot: {
          firstName: opts.ctx.firstName,
          throneIssue: opts.ctx.throneIssue,
          appleIssue: opts.ctx.appleIssue,
          lastThroneSyncRel: opts.ctx.lastThroneSyncRel,
          lastAppleHealthSyncRel: opts.ctx.lastAppleHealthSyncRel,
          currentPhase: opts.ctx.currentPhase,
          consecutiveDaysWithoutSync: opts.ctx.consecutiveDaysWithoutSync,
        },
      },
      {merge: true},
    );
    return {chatId: opts.chatId, created: false};
  }

  const ref = col.doc();
  await ref.set({
    participantId: opts.participantId,
    triggerReason: opts.triggerReason ?? "participant-initiated",
    status: "open",
    createdAt: now,
    lastActivity: now,
    contextSnapshot: {
      firstName: opts.ctx.firstName,
      throneIssue: opts.ctx.throneIssue,
      appleIssue: opts.ctx.appleIssue,
      lastThroneSyncRel: opts.ctx.lastThroneSyncRel,
      lastAppleHealthSyncRel: opts.ctx.lastAppleHealthSyncRel,
      currentPhase: opts.ctx.currentPhase,
      consecutiveDaysWithoutSync: opts.ctx.consecutiveDaysWithoutSync,
    },
  });
  return {chatId: ref.id, created: true};
}

async function appendMessage(
  chatId: string,
  role: "participant" | "assistant",
  content: string,
): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection("supportChats").doc(chatId).collection("messages").doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set({role, content, timestamp: now});
}

async function getRecentHistory(chatId: string): Promise<ChatMessage[]> {
  const db = admin.firestore();
  const snap = await db
    .collection("supportChats")
    .doc(chatId)
    .collection("messages")
    .orderBy("timestamp", "desc")
    .limit(MAX_HISTORY)
    .get();
  const docs = snap.docs.reverse();
  return docs.map((d) => {
    const data = d.data();
    const role: "assistant" | "user" = data.role === "assistant" ? "assistant" : "user";
    return {role, content: String(data.content ?? "")};
  });
}

// ─── HTTPS handler ───────────────────────────────────────────────────────────

export async function handleSupportChat(req: any, res: any): Promise<void> {
  // CORS
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({error: "Method not allowed"});
    return;
  }

  let uid: string;
  try {
    uid = await authenticateRequest(req.headers.authorization);
  } catch (err) {
    logger.warn("[supportChat] auth failed", err);
    res.status(401).json({error: "Unauthorized"});
    return;
  }

  const body = (req.body || {}) as ChatRequest;
  const participantId = String(body.participantId ?? uid);
  try {
    assertParticipantOwnership(uid, participantId);
  } catch (err) {
    logger.warn("[supportChat] ownership mismatch", {uid, participantId});
    res.status(403).json({error: "Forbidden"});
    return;
  }

  if (!body.isOpening && (typeof body.userMessage !== "string" || !body.userMessage.trim())) {
    res.status(400).json({error: "userMessage is required when isOpening is false"});
    return;
  }

  try {
    const thresholdHours = await getSyncThresholdHours();
    const ctx = await buildParticipantContext(participantId, thresholdHours);

    const {chatId, created} = await ensureChatDoc({
      participantId,
      chatId: body.chatId,
      triggerReason: body.triggerReason,
      ctx,
    });

    const systemPrompt = buildSystemPrompt(ctx);

    // Persist user message FIRST so the dashboard sees it the moment we
    // call Anthropic — even if the upstream request hangs the researcher
    // can still see what was asked. Skip for opening (the primer is a
    // hidden internal turn, not a participant message).
    if (!body.isOpening) {
      await appendMessage(chatId, "participant", body.userMessage!.trim());
    }

    // Build the Anthropic payload — prefer client-supplied history when
    // present (saves a Firestore read on the hot path); fall back to the
    // server-side history if the client didn't send one.
    let priorMessages: AnthropicMessageParam[];
    if (Array.isArray(body.conversationHistory) && body.conversationHistory.length > 0) {
      priorMessages = body.conversationHistory
        .slice(-MAX_HISTORY)
        .map<AnthropicMessageParam>((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content ?? ""),
        }))
        .filter((m) => m.content.trim().length > 0);
    } else if (created || body.isOpening) {
      priorMessages = [];
    } else {
      priorMessages = await getRecentHistory(chatId);
    }

    const messages: AnthropicMessageParam[] = body.isOpening ?
      [...priorMessages, {role: "user", content: OPENING_PRIMER}] :
      [...priorMessages, {role: "user", content: body.userMessage!.trim()}];

    const reply = await callAnthropic(systemPrompt, messages);
    await appendMessage(chatId, "assistant", reply);

    // Bump lastActivity so the dashboard sort order reflects the new turn.
    await admin
      .firestore()
      .collection("supportChats")
      .doc(chatId)
      .set({lastActivity: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});

    res.status(200).json({
      status: "ok",
      chatId,
      reply,
      thresholdHours,
      // Echo the API-safe context so the iOS app can render its sync
      // banner without independently re-deriving relative timestamps.
      context: {
        firstName: ctx.firstName,
        throneIssue: ctx.throneIssue,
        appleIssue: ctx.appleIssue,
        lastThroneSyncRel: ctx.lastThroneSyncRel,
        lastAppleHealthSyncRel: ctx.lastAppleHealthSyncRel,
        currentPhase: ctx.currentPhase,
      },
    });
  } catch (err) {
    logger.error("[supportChat] failed", err);
    res.status(500).json({
      error: "Support chat failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Nightly summary ─────────────────────────────────────────────────────────

interface NightlySummary {
  participantId: string;
  chatId: string;
  summary: string;
  issueCategory: "throne" | "apple_health" | "both" | "other" | "resolved";
  resolved: boolean;
  recommendedAction: string;
  // Study-context fields embedded so the dashboard can render a "morning
  // briefing" card without re-deriving from each participant's user doc.
  // All are derived in buildParticipantContext at chat time, then carried
  // forward into the nightly summary verbatim.
  firstName: string;
  pathwayKey: PathwayKey;
  pathwayLabel: string;
  currentPhase: string;
  consentSigned: boolean;
  consentStatus: string;
  urodynamicsDateRel: string | null;
  surgeryDateRel: string | null;
  daysToUrodynamics: number | null;
  daysToSurgery: number | null;
}

interface NightlyStudyCounts {
  totalActive: number;
  syncGaps48h: number;
  syncGaps5d: number;
  escalations: number;
  // Study-context aggregates — let the dashboard render a "things needing
  // attention this morning" panel at a glance.
  consentMissing: number;
  udsApproaching7d: number;
  surgeryApproaching7d: number;
  udsToday: number;
  surgeryToday: number;
  byPhase: Record<string, number>; // currentPhase → count
  byPathway: Record<PathwayKey, number>;
}

interface NightlyHighlight {
  level: "info" | "warn" | "alert";
  text: string;
}

/**
 * Compute the integer day-offset from now to a given ISO date. Used by the
 * nightly summarizer to bucket participants into "approaching this week" /
 * "due today" / "passed" cohorts.
 *
 * @param {string | null} iso ISO date string (YYYY-MM-DD) or null.
 * @return {number | null} Days until that date (negative if past), or null.
 */
function daysFromNow(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / (24 * 60 * 60 * 1000));
}

async function summarizeChat(
  participantContext: {firstName: string; currentPhase: string},
  messages: ChatMessage[],
): Promise<Pick<NightlySummary, "summary" | "issueCategory" | "resolved" | "recommendedAction">> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const transcript = messages
    .map((m) => `${m.role === "user" ? "Participant" : "Assistant"}: ${m.content}`)
    .join("\n");

  const systemIntro =
    "You summarize StreamSync support chats for researchers. " +
    "Output JSON ONLY — no prose, no markdown fences. Schema:";
  const systemSchema = [
    "{",
    "  \"summary\": \"1-2 sentence neutral summary of what the participant " +
      "reported and how it was addressed\",",
    "  \"issueCategory\": \"throne\" | \"apple_health\" | \"both\" | \"other\" | \"resolved\",",
    "  \"resolved\": boolean,",
    "  \"recommendedAction\": \"Short directive for the research team — e.g. " +
      "'Monitor', 'Call participant', 'Ship replacement device'\"",
    "}",
  ].join("\n");
  const systemRules = [
    "Rules:",
    "- Never include the participant's last name, email, phone, address, " +
      "or full clinical dates — even if they appear in the transcript.",
    "- Never speculate about medical conditions.",
    "- Keep summary under 240 characters.",
  ].join("\n");
  const system = `${systemIntro}\n${systemSchema}\n${systemRules}`;

  const userMsg =
    `Participant first name: ${participantContext.firstName}\n` +
    `Monitoring phase: ${participantContext.currentPhase}\n\n` +
    `Transcript:\n${transcript}\n\n` +
    "Return the JSON now.";

  const reply = await callAnthropic(system, [{role: "user", content: userMsg}]);
  const stripped = reply.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return {
      summary: "Summary unavailable (parse error)",
      issueCategory: "other",
      resolved: false,
      recommendedAction: "Review transcript",
    };
  }

  const allowedCategories = ["throne", "apple_health", "both", "other", "resolved"] as const;
  const issueCategory = (allowedCategories as readonly string[]).includes(parsed.issueCategory) ?
    parsed.issueCategory :
    "other";

  return {
    summary: String(parsed.summary ?? "").slice(0, 280),
    issueCategory: issueCategory as NightlySummary["issueCategory"],
    resolved: Boolean(parsed.resolved),
    recommendedAction: String(parsed.recommendedAction ?? "Review transcript").slice(0, 200),
  };
}

/**
 * Build the human-readable highlights array for the dashboard's "morning
 * briefing" card. Pulled out of runNightlySupportSummary so the prose is
 * easy to tweak without touching the aggregation logic.
 *
 * @param {NightlyStudyCounts} counts Aggregated study counts.
 * @return {NightlyHighlight[]} Highlight items, ordered by severity.
 */
function buildHighlights(counts: NightlyStudyCounts): NightlyHighlight[] {
  const out: NightlyHighlight[] = [];
  if (counts.udsToday > 0) {
    out.push({
      level: "alert",
      text: `${counts.udsToday} participant${counts.udsToday === 1 ? "" : "s"} have urodynamics TODAY.`,
    });
  }
  if (counts.surgeryToday > 0) {
    out.push({
      level: "alert",
      text: `${counts.surgeryToday} participant${counts.surgeryToday === 1 ? "" : "s"} have surgery TODAY.`,
    });
  }
  if (counts.udsApproaching7d > 0) {
    const n = counts.udsApproaching7d;
    out.push({
      level: "warn",
      text: `${n} participant${n === 1 ? "" : "s"} approaching UDS within 7 days.`,
    });
  }
  if (counts.surgeryApproaching7d > 0) {
    const n = counts.surgeryApproaching7d;
    out.push({
      level: "warn",
      text: `${n} participant${n === 1 ? "" : "s"} approaching surgery within 7 days.`,
    });
  }
  if (counts.consentMissing > 0) {
    const n = counts.consentMissing;
    out.push({
      level: "warn",
      text: `${n} active participant${n === 1 ? "" : "s"} without consent on file.`,
    });
  }
  if (counts.syncGaps5d > 0) {
    const n = counts.syncGaps5d;
    out.push({
      level: "warn",
      text: `${n} participant${n === 1 ? "" : "s"} with 5+ days of missing sync data.`,
    });
  }
  if (counts.syncGaps48h > 0) {
    const n = counts.syncGaps48h;
    out.push({
      level: "info",
      text: `${n} participant${n === 1 ? "" : "s"} with 48h+ sync gap.`,
    });
  }
  if (counts.escalations > 0) {
    const n = counts.escalations;
    out.push({
      level: "alert",
      text: `${n} chat${n === 1 ? " was" : "s were"} escalated and need follow-up.`,
    });
  }
  return out;
}

export async function runNightlySupportSummary(): Promise<void> {
  const db = admin.firestore();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const cutoffTs = admin.firestore.Timestamp.fromMillis(cutoff);

  const recentChats = await db
    .collection("supportChats")
    .where("lastActivity", ">=", cutoffTs)
    .get();

  if (recentChats.empty) {
    logger.info("[nightlySummary] no recent chat activity");
    return;
  }

  const summaries: NightlySummary[] = [];
  const counts: NightlyStudyCounts = {
    totalActive: 0,
    syncGaps48h: 0,
    syncGaps5d: 0,
    escalations: 0,
    consentMissing: 0,
    udsApproaching7d: 0,
    surgeryApproaching7d: 0,
    udsToday: 0,
    surgeryToday: 0,
    byPhase: {},
    byPathway: {uds: 0, surgery: 0, both: 0, unknown: 0},
  };
  const seenParticipants = new Set<string>();
  const thresholdHours = await getSyncThresholdHours();

  // Compute per-participant context only ONCE per participant — multiple
  // chats from the same participant share the same study/consent state, and
  // each context build hits Firestore for ~6 docs.
  const ctxCache = new Map<string, ParticipantContext>();

  for (const chatDoc of recentChats.docs) {
    const chat = chatDoc.data();
    const participantId = String(chat.participantId ?? "");
    if (!participantId) continue;

    try {
      const messagesSnap = await chatDoc.ref
        .collection("messages")
        .orderBy("timestamp", "asc")
        .limit(50)
        .get();
      if (messagesSnap.empty) continue;

      const messages: ChatMessage[] = messagesSnap.docs.map((d) => ({
        role: d.data().role === "assistant" ? "assistant" : "user",
        content: String(d.data().content ?? ""),
      }));

      let ctx = ctxCache.get(participantId);
      if (!ctx) {
        ctx = await buildParticipantContext(participantId, thresholdHours);
        ctxCache.set(participantId, ctx);
      }
      const result = await summarizeChat(
        {firstName: ctx.firstName, currentPhase: ctx.currentPhase},
        messages,
      );

      // The `*Rel` strings already encode a numeric offset, but keep an
      // unparsed integer in the summary doc so the dashboard can sort and
      // filter without re-parsing prose.
      const daysToUds = daysFromNow(
        await readClinicalDateRaw(db, participantId, "urodynamics_date", "urodynamicsDate"),
      );
      const daysToSurgery = daysFromNow(
        await readClinicalDateRaw(db, participantId, "surgery_date", "surgeryDate"),
      );

      summaries.push({
        participantId,
        chatId: chatDoc.id,
        ...result,
        firstName: ctx.firstName,
        pathwayKey: ctx.pathwayKey,
        pathwayLabel: ctx.pathwayLabel,
        currentPhase: ctx.currentPhase,
        consentSigned: ctx.consentStatus.startsWith("Signed"),
        consentStatus: ctx.consentStatus,
        urodynamicsDateRel: ctx.urodynamicsDateRel,
        surgeryDateRel: ctx.surgeryDateRel,
        daysToUrodynamics: daysToUds,
        daysToSurgery: daysToSurgery,
      });

      // Sync-related counts (legacy, kept for back-compat with existing readers)
      if (result.issueCategory !== "resolved" && !result.resolved) {
        if (ctx.consecutiveDaysWithoutSync >= 5) counts.syncGaps5d++;
        else if (ctx.throneIssue || ctx.appleIssue) counts.syncGaps48h++;
        if (/escalat/i.test(result.recommendedAction)) counts.escalations++;
      }

      // Participant-level counts only fire ONCE per participant even if they
      // had multiple chats today — the boolean check on seenParticipants is
      // the gate.
      if (!seenParticipants.has(participantId)) {
        seenParticipants.add(participantId);
        if (!ctx.consentStatus.startsWith("Signed")) counts.consentMissing++;
        if (daysToUds === 0) counts.udsToday++;
        else if (daysToUds != null && daysToUds > 0 && daysToUds <= 7) counts.udsApproaching7d++;
        if (daysToSurgery === 0) counts.surgeryToday++;
        else if (daysToSurgery != null && daysToSurgery > 0 && daysToSurgery <= 7) counts.surgeryApproaching7d++;

        const phaseKey = ctx.currentPhase || "unknown";
        counts.byPhase[phaseKey] = (counts.byPhase[phaseKey] || 0) + 1;
        counts.byPathway[ctx.pathwayKey]++;
      }
    } catch (err) {
      logger.error(`[nightlySummary] chat ${chatDoc.id} failed`, err);
      // continue — one bad chat must not break the whole job
    }
  }

  counts.totalActive = seenParticipants.size;
  const highlights = buildHighlights(counts);

  const today = new Date().toISOString().slice(0, 10);
  await db.collection("nightly_summaries").doc(today).set(
    {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      summaries,
      counts,
      highlights,
    },
    {merge: true},
  );
  logger.info(
    `[nightlySummary] wrote ${summaries.length} summaries + ` +
      `${highlights.length} highlights to nightly_summaries/${today}`,
  );
}

/**
 * Direct read of the participant's clinical date as an ISO string, without
 * the relative-phrase rendering. Used by the nightly summarizer so it can
 * compute exact day-offsets for sorting/filtering on the dashboard.
 *
 * @param {admin.firestore.Firestore} db Admin Firestore handle.
 * @param {string} participantId Firebase UID.
 * @param {string} subcollection e.g. "surgery_date" or "urodynamics_date".
 * @param {string} field Date field name inside that doc.
 * @return {Promise<string | null>} ISO date string (YYYY-MM-DD) or null.
 */
async function readClinicalDateRaw(
  db: admin.firestore.Firestore,
  participantId: string,
  subcollection: string,
  field: string,
): Promise<string | null> {
  const userSnap = await db.collection("users").doc(participantId).get();
  const fallback = userSnap.exists ?
    (typeof userSnap.data()?.[field] === "string" ? userSnap.data()?.[field] : null) :
    null;
  return readClinicalDate(db, participantId, subcollection, field, fallback);
}
