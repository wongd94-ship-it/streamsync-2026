/**
 * Cowork Adherence Sync — daily Cowork-driven endpoint.
 *
 * Single bidirectional endpoint the Cowork / Claude Code routine calls once
 * a day. The routine sends the relevant rows from `tracker.csv` (post-arrival
 * participants only) and gets back, in the same response:
 *
 *   1. Enrollment results — which tracker rows just produced new
 *      Firebase users / patients docs, which were already enrolled.
 *   2. Adherence report — for every active UDS participant (whether
 *      enrolled in this run or earlier), how recent their last Throne
 *      void is, days until urodynamicsDate, and whether the routine
 *      should flag them for a reminder.
 *
 * Authentication: bearer token via `COWORK_SYNC_TOKEN` secret. Same model
 * as `syncThroneNow` — a single shared secret stored in Firebase Secret
 * Manager, never exposed to participants.
 *
 * Why a single endpoint:
 *   - The routine reads tracker → POSTs filtered rows → writes the
 *     response back into the tracker. One HTTP call per daily run.
 *   - Idempotent: re-sending the same row never creates duplicate
 *     patients/* documents. Already-enrolled participants are reported
 *     in the `skipped` array.
 *
 * Reminder semantics (kept on the server so the policy is one place):
 *   - `flagReminder` is true when the participant has uds dates set,
 *     today is before the urodynamicsDate, AND either no Throne void
 *     has been seen yet OR the last void is older than the configured
 *     stale threshold (default 2 days).
 *   - `daysUntilUds` is null if no urodynamicsDate is set on the
 *     patient/user mirror.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import {STUDY_ID} from "./studyConfig";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrackerParticipantInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  arrivalReminderSent?: string | null;
  urodynamicsDate?: string | null;
  inOfficeUroflowDate?: string | null;
  enrollmentNumber?: number | string | null;
}

interface NormalizedParticipant {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  urodynamicsDate: string | null;
  inOfficeUroflowDate: string | null;
  enrollmentNumber: string | null;
  arrivalReminderSent: string | null;
}

interface EnrollmentOutcome {
  email: string;
  firebaseUid: string;
  status: "created" | "already_enrolled" | "reactivated";
  patientId: string;
}

interface SkippedOutcome {
  email: string;
  reason: string;
}

interface AdherenceRow {
  email: string;
  firstName: string | null;
  lastName: string | null;
  firebaseUid: string;
  status: string | null;
  urodynamicsDate: string | null;
  daysUntilUds: number | null;
  lastVoidAt: string | null;
  daysSinceLastVoid: number | null;
  voids7Day: number;
  voidsTotal: number;
  flagReminder: boolean;
  reminderReason: string | null;
}

export interface CoworkAdherenceResponse {
  asOf: string;
  studyId: string;
  staleVoidThresholdDays: number;
  enrollment: {
    created: EnrollmentOutcome[];
    skipped: SkippedOutcome[];
  };
  adherence: AdherenceRow[];
  summary: {
    totalActive: number;
    flaggedCount: number;
    awaitingFirstVoid: number;
    onTrackCount: number;
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

class CoworkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoworkValidationError";
  }
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CoworkValidationError("email is required");
  }
  const lower = value.trim().toLowerCase();
  if (!EMAIL_REGEX.test(lower)) {
    throw new CoworkValidationError(`email is not a valid address: ${value}`);
  }
  return lower;
}

function normalizeIsoDate(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (!ISO_DATE_REGEX.test(trimmed)) {
    throw new CoworkValidationError(`${field} must be YYYY-MM-DD if provided (got ${value})`);
  }
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new CoworkValidationError(`${field} is not a valid date (${value})`);
  }
  return trimmed;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEnrollmentNumber(value: unknown): string | null {
  if (value == null) return null;
  const str = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!str) return null;
  // Keep as string — leading zeros and short strings are fine.
  return str;
}

function normalizeParticipantInput(raw: unknown): NormalizedParticipant {
  if (!raw || typeof raw !== "object") {
    throw new CoworkValidationError("participant entries must be objects");
  }
  const obj = raw as TrackerParticipantInput;
  return {
    email: normalizeEmail(obj.email),
    firstName: normalizeOptionalString(obj.firstName),
    lastName: normalizeOptionalString(obj.lastName),
    phoneNumber: normalizeOptionalString(obj.phone),
    urodynamicsDate: normalizeIsoDate(obj.urodynamicsDate, "urodynamicsDate"),
    inOfficeUroflowDate: normalizeIsoDate(obj.inOfficeUroflowDate, "inOfficeUroflowDate"),
    enrollmentNumber: normalizeEnrollmentNumber(obj.enrollmentNumber),
    arrivalReminderSent: normalizeIsoDate(obj.arrivalReminderSent, "arrivalReminderSent"),
  };
}

// ─── Bearer token check ─────────────────────────────────────────────────────

export function verifyCoworkToken(headerValue: unknown): boolean {
  const expected = process.env.COWORK_SYNC_TOKEN?.trim() ?? "";
  if (!expected) return false;
  if (typeof headerValue !== "string" || !headerValue.startsWith("Bearer ")) {
    return false;
  }
  const provided = headerValue.slice("Bearer ".length).trim();
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// ─── Enrollment side ────────────────────────────────────────────────────────

interface EnrollContext {
  db: admin.firestore.Firestore;
  authClient: admin.auth.Auth;
  nowIso: string;
}

async function ensureEnrolled(
  ctx: EnrollContext,
  participant: NormalizedParticipant,
): Promise<EnrollmentOutcome> {
  const {db, authClient, nowIso} = ctx;
  const email = participant.email;

  // Reuse existing patient if one exists for this email under the UDS study.
  const existing = await db.collection("patients")
    .where("email", "==", email)
    .where("studyId", "==", STUDY_ID)
    .limit(1)
    .get();

  // Look up or create the Firebase Auth user — keyed by email.
  let userRecord: admin.auth.UserRecord;
  let createdUser = false;
  try {
    userRecord = await authClient.getUserByEmail(email);
  } catch (error: unknown) {
    const code = (error as {code?: string})?.code;
    if (code !== "auth/user-not-found") {
      throw error;
    }
    userRecord = await authClient.createUser({
      email,
      emailVerified: false,
      password: crypto.randomBytes(24).toString("base64url"),
      displayName: [participant.firstName, participant.lastName].filter(Boolean).join(" ") || email,
    });
    createdUser = true;
  }

  const firebaseUid = userRecord.uid;
  const patientRef = existing.empty ? db.collection("patients").doc() : existing.docs[0].ref;
  const patientId = patientRef.id;
  const existingData = existing.empty ? null : existing.docs[0].data();

  // If a patient already exists and is active, this is a no-op enrollment —
  // we still refresh the dates so a tracker edit (e.g., updated UDS date)
  // propagates to Firestore.
  const isAlreadyActive = existingData?.status === "active";
  const isReactivation = !!existingData && existingData?.status === "withdrawn";

  // Preserve any researcher-set throneAccountEmail. The Cowork tracker
  // doesn't know the participant's Throne login email; it only has the
  // contact email. If we wrote `throneAccountEmail: email` unconditionally
  // we'd clobber corrections made by setParticipantThroneEmail every
  // daily sync. Only seed it on first enrollment.
  const existingThroneAccountEmail = typeof existingData?.throneAccountEmail === "string" ?
    existingData.throneAccountEmail.trim().toLowerCase() :
    "";
  const throneAccountEmail = existingThroneAccountEmail || email;

  const displayName = [participant.firstName, participant.lastName].filter(Boolean).join(" ").trim() || email;
  const upcomingVisit = participant.urodynamicsDate ?
    {
      type: "uds",
      date: `${participant.urodynamicsDate}T00:00:00.000Z`,
      ...(participant.inOfficeUroflowDate ?
        {inOfficeUroflowDate: `${participant.inOfficeUroflowDate}T00:00:00.000Z`} :
        {}),
    } :
    null;

  const patientPayload: Record<string, unknown> = {
    id: patientId,
    studyId: STUDY_ID,
    studyKey: "uds",
    pathway: "uds",
    email,
    throneAccountEmail,
    firebaseUid,
    userId: firebaseUid,
    firstName: participant.firstName,
    lastName: participant.lastName,
    phoneNumber: participant.phoneNumber,
    upcomingVisit,
    enrollmentSource: "cowork_tracker",
    enrollmentNumber: participant.enrollmentNumber,
    arrivalReminderSentAt: participant.arrivalReminderSent ?
      `${participant.arrivalReminderSent}T00:00:00.000Z` :
      null,
    status: "active",
    accountSource: existingData?.accountSource || "cowork_tracker",
    enrolledAt: existingData?.enrolledAt || nowIso,
    createdAt: existingData?.createdAt || nowIso,
    updatedAt: nowIso,
  };

  const userMirrorPayload: Record<string, unknown> = {
    studyId: STUDY_ID,
    studyKey: "uds",
    pathway: "uds",
    email,
    throneAccountEmail,
    throneAccountLinked: true,
    firstName: participant.firstName,
    lastName: participant.lastName,
    name: displayName,
    displayName,
    phoneNumber: participant.phoneNumber,
    upcomingVisit,
    accountSource: "cowork_tracker",
    enrollmentSource: "cowork_tracker",
    patientDocId: patientId,
    onboardingComplete: true,
    enrolledAt: nowIso,
    arrivalReminderSentAt: participant.arrivalReminderSent ?
      `${participant.arrivalReminderSent}T00:00:00.000Z` :
      null,
    updatedAt: nowIso,
    createdAt: nowIso,
  };

  const batch = db.batch();
  batch.set(patientRef, patientPayload, {merge: true});
  batch.set(db.collection("users").doc(firebaseUid), userMirrorPayload, {merge: true});
  // Always write the doc keyed by throneAccountEmail (the Throne join key).
  // If the throne email differs from the contact email, also write a
  // doc keyed by the contact email so the email → uid map remains
  // resolvable from either side.
  batch.set(
    db.collection("throne_research_participants").doc(throneAccountEmail),
    {
      email: throneAccountEmail,
      throneAccountEmail,
      firebaseUid,
      enrolledAt: nowIso,
      throneAccountCreated: true,
      lastSyncAt: existingData?.lastSyncAt ?? null,
      enrollmentSource: "cowork_tracker",
    },
    {merge: true},
  );
  if (throneAccountEmail !== email) {
    batch.set(
      db.collection("throne_research_participants").doc(email),
      {
        email,
        throneAccountEmail,
        firebaseUid,
        enrolledAt: nowIso,
        throneAccountCreated: true,
        lastSyncAt: existingData?.lastSyncAt ?? null,
        enrollmentSource: "cowork_tracker",
      },
      {merge: true},
    );
  }
  await batch.commit();

  let outcomeStatus: EnrollmentOutcome["status"];
  if (isAlreadyActive) {
    outcomeStatus = "already_enrolled";
  } else if (isReactivation) {
    outcomeStatus = "reactivated";
  } else if (createdUser || !existingData) {
    outcomeStatus = "created";
  } else {
    outcomeStatus = "already_enrolled";
  }

  return {email, firebaseUid, status: outcomeStatus, patientId};
}

// ─── Adherence side ─────────────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function diffDays(fromIso: string | null | undefined, toIso: string): number | null {
  if (!fromIso) return null;
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

async function buildAdherenceRow(
  db: admin.firestore.Firestore,
  patientDoc: admin.firestore.QueryDocumentSnapshot,
  nowIso: string,
  staleThresholdDays: number,
): Promise<AdherenceRow> {
  const data = patientDoc.data();
  const firebaseUid = (data.firebaseUid as string) || (data.userId as string) || patientDoc.id;
  const email = (data.email as string)?.toLowerCase() ?? "";
  const upcomingVisit = data.upcomingVisit as {date?: string; type?: string} | null | undefined;
  const udsDateIso = upcomingVisit?.type === "uds" && upcomingVisit?.date ?
    upcomingVisit.date :
    null;

  const syncSnap = await db.doc(`users/${firebaseUid}/throne_sync/state`).get();
  const lastVoidAt = syncSnap.exists ?
    ((syncSnap.data()?.lastVoidAt as string | null | undefined) ?? null) :
    null;
  const daysSinceLastVoid = lastVoidAt ?
    Math.floor((new Date(nowIso).getTime() - new Date(lastVoidAt).getTime()) / (24 * 60 * 60 * 1000)) :
    null;

  // Cheap void counts: full count + 7-day count via two indexed queries.
  // throne_sessions has many docs per user but `count()` is server-side.
  const sessionsCol = db.collection(`users/${firebaseUid}/throne_sessions`);
  const sevenDaysAgoIso = new Date(new Date(nowIso).getTime() - SEVEN_DAYS_MS).toISOString();
  const [totalAgg, sevenDayAgg] = await Promise.all([
    sessionsCol.count().get(),
    sessionsCol.where("startTs", ">=", sevenDaysAgoIso).count().get(),
  ]);
  const voidsTotal = totalAgg.data().count;
  const voids7Day = sevenDayAgg.data().count;

  let daysUntilUds: number | null = null;
  if (udsDateIso) {
    daysUntilUds = diffDays(nowIso, udsDateIso);
  }

  let flagReminder = false;
  let reminderReason: string | null = null;
  const beforeUds = daysUntilUds == null ? false : daysUntilUds >= 0;

  if (!beforeUds && daysUntilUds != null) {
    // UDS already passed — the routine handles post-UDS reminders separately;
    // not flagged here.
  } else if (!udsDateIso) {
    // No UDS date on file — leave unflagged but surface in the row so the
    // routine can prompt the user to set it.
  } else if (!lastVoidAt) {
    flagReminder = true;
    reminderReason = "no_voids_yet";
  } else if (daysSinceLastVoid != null && daysSinceLastVoid > staleThresholdDays) {
    flagReminder = true;
    reminderReason = `stale_${daysSinceLastVoid}_days`;
  }

  return {
    email,
    firstName: (data.firstName as string | null) ?? null,
    lastName: (data.lastName as string | null) ?? null,
    firebaseUid,
    status: (data.status as string | null) ?? null,
    urodynamicsDate: udsDateIso ? udsDateIso.slice(0, 10) : null,
    daysUntilUds,
    lastVoidAt,
    daysSinceLastVoid,
    voids7Day,
    voidsTotal,
    flagReminder,
    reminderReason,
  };
}

// ─── Public handler ─────────────────────────────────────────────────────────

export interface HandleCoworkAdherenceOpts {
  staleThresholdDays?: number;
}

export async function handleCoworkAdherence(
  body: unknown,
  opts?: HandleCoworkAdherenceOpts,
): Promise<CoworkAdherenceResponse> {
  const db = admin.firestore();
  const authClient = admin.auth();
  const nowIso = new Date().toISOString();
  const staleThresholdDays = Math.max(1, Math.floor(opts?.staleThresholdDays ?? 2));

  const rawList = (body as {participants?: unknown})?.participants;
  if (!Array.isArray(rawList)) {
    throw new CoworkValidationError("body.participants must be an array");
  }

  // Normalize + dedupe by email.
  const seen = new Set<string>();
  const participants: NormalizedParticipant[] = [];
  for (const raw of rawList) {
    const normalized = normalizeParticipantInput(raw);
    if (!normalized.arrivalReminderSent) {
      // Caller is expected to filter, but enforce server-side too.
      continue;
    }
    if (seen.has(normalized.email)) continue;
    seen.add(normalized.email);
    participants.push(normalized);
  }

  // Enroll each eligible participant.
  const created: EnrollmentOutcome[] = [];
  const skipped: SkippedOutcome[] = [];
  for (const participant of participants) {
    try {
      const outcome = await ensureEnrolled({db, authClient, nowIso}, participant);
      if (outcome.status === "already_enrolled") {
        skipped.push({email: participant.email, reason: "already_enrolled"});
      } else {
        created.push(outcome);
      }
    } catch (err) {
      logger.error("cowork enrollment failed for participant", {
        email: participant.email.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
        error: err instanceof Error ? err.message : String(err),
      });
      skipped.push({
        email: participant.email,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Build adherence report from ALL active UDS patients (covers participants
  // enrolled this run and earlier). Single read, then per-user sync lookups.
  const activePatientsSnap = await db.collection("patients")
    .where("studyId", "==", STUDY_ID)
    .where("status", "==", "active")
    .get();

  const adherence: AdherenceRow[] = [];
  for (const doc of activePatientsSnap.docs) {
    try {
      const row = await buildAdherenceRow(db, doc, nowIso, staleThresholdDays);
      adherence.push(row);
    } catch (err) {
      logger.error("adherence row build failed", {
        patientId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const flaggedCount = adherence.filter((row) => row.flagReminder).length;
  const awaitingFirstVoid = adherence.filter((row) => row.lastVoidAt == null).length;
  const onTrackCount = adherence.length - flaggedCount;

  return {
    asOf: nowIso,
    studyId: STUDY_ID,
    staleVoidThresholdDays: staleThresholdDays,
    enrollment: {created, skipped},
    adherence,
    summary: {
      totalActive: adherence.length,
      flaggedCount,
      awaitingFirstVoid,
      onTrackCount,
    },
  };
}

export {CoworkValidationError};
