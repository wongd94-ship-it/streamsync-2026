/**
 * StreamSync Cloud Functions
 *
 * - throneIngestDaily:   Scheduled daily at 12 AM PT, syncs Throne data to Firestore
 * - syncThroneNow:       HTTP trigger for manual/dev sync (requires x-admin-token header)
 * - syncThroneUserMap:   Firestore trigger — keeps throneUserMap in sync when a user's
 *                        throneUserId field is set or changed by the study coordinator
 *
 * Required runtime config:
 *   THRONE_API_KEY, THRONE_BASE_URL, ADMIN_TOKEN
 * Optional:
 *   THRONE_TIMEZONE (defaults to America/Los_Angeles)
 *
 * Study identifier: the single approved studyId is exported from
 * ./studyConfig as STUDY_ID. THRONE_STUDY_ID(S) env vars are no longer
 * consulted — the constant is hardcoded to match the IRB/Throne approval.
 */

import {setGlobalOptions} from "firebase-functions/v2";
import {onRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import {
  runThroneBackfillForEmail,
  runThroneIngestion,
  ThroneConfig,
} from "./throneIngestion";
import {STUDY_ID, isApprovedStudyId} from "./studyConfig";
import {
  createParticipant as createParticipantImpl,
  claimParticipant as claimParticipantImpl,
  requestPathwayChange as requestPathwayChangeImpl,
  confirmPathwayChange as confirmPathwayChangeImpl,
  setParticipantThroneEmail as setParticipantThroneEmailImpl,
  withdrawParticipant as withdrawParticipantImpl,
  ValidationError,
} from "./participant";
import {
  migrateProdParticipants as migrateProdParticipantsImpl,
  defaultMigrationTargets,
} from "./migrateProdParticipants";
import {handleSupportChat, runNightlySupportSummary} from "./supportChat";
export {notifyOnSupportMessage} from "./notifyOnSupportMessage";
import {
  handleCoworkAdherence,
  verifyCoworkToken,
  CoworkValidationError,
} from "./coworkAdherence";
export {
  smartAuthorizeUrl,
  completeSmartConnection,
  syncSmartClinicalData,
} from "./smartOnFhir";

admin.initializeApp();

setGlobalOptions({maxInstances: 10});

const THRONE_RUNTIME_SECRETS = ["THRONE_API_KEY", "THRONE_BASE_URL"] as const;
const THRONE_ADMIN_RUNTIME_SECRETS = [...THRONE_RUNTIME_SECRETS, "ADMIN_TOKEN"] as const;

// ─── Config ──────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) throw new Error(`Missing required env var: ${name}`);
  if (val.toLowerCase() === "placeholder") {
    throw new Error(`Required env var ${name} is still set to placeholder`);
  }
  return val;
}

function getBearerToken(req: any): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

async function requireResearcherUid(req: any): Promise<string> {
  const bearer = getBearerToken(req);
  if (!bearer) throw new Error("Missing Firebase bearer token");
  const decoded = await admin.auth().verifyIdToken(bearer);
  const researcherDoc = await admin.firestore().collection("Researchers").doc(decoded.uid).get();
  if (!researcherDoc.exists) {
    throw new Error("Authenticated user is not approved for researcher access");
  }
  return decoded.uid;
}

function normalizeEnrollmentEmail(value: string): string {
  return value.trim().toLowerCase();
}

function looksLikeEmailIdentifier(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function setCorsHeaders(req: any, res: any): boolean {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

/**
 * Returns the single approved studyId. Retained as an array for API
 * compatibility with the ingestion dispatcher, but the plural/env-var
 * parsing is gone — only STUDY_ID is ever returned. Any inbound
 * `requestedStudyId` that doesn't match is rejected rather than silently
 * honored, so a stale HTTP caller can't reintroduce "streamsync-uds".
 *
 * @return {string[]} An array containing only the approved STUDY_ID.
 */
function getConfiguredStudyIds(): string[] {
  return [STUDY_ID];
}

function getThroneConfigs(requestedStudyId?: string): ThroneConfig[] {
  const baseConfig = {
    apiKey: requireEnv("THRONE_API_KEY"),
    baseUrl: requireEnv("THRONE_BASE_URL"),
    timezone: process.env.THRONE_TIMEZONE || "America/Los_Angeles",
  };
  if (requestedStudyId && !isApprovedStudyId(requestedStudyId)) {
    throw new Error(
      `Rejected studyId: "${requestedStudyId}". Only "${STUDY_ID}" is approved for this project.`,
    );
  }
  return [{...baseConfig, studyId: STUDY_ID}];
}

async function syncedWithinLastHour(studyId: string): Promise<boolean> {
  const db = admin.firestore();
  const syncDoc = await db.collection("throneSync").doc(studyId).get();
  if (!syncDoc.exists) return false;
  const lastRunAt = syncDoc.data()?.lastRunAt as string | undefined;
  if (!lastRunAt) return false;
  const elapsed = Date.now() - new Date(lastRunAt).getTime();
  return elapsed < 60 * 60 * 1000;
}

async function runConfiguredThroneIngestion(opts?: {
  fullSync?: boolean;
  requestedStudyId?: string;
  skipIfRecent?: boolean;
}): Promise<{
  sessionCount: number;
  metricCount: number;
  studyResults: Array<{studyId: string; sessionCount: number; metricCount: number; skipped?: boolean}>;
}> {
  const configs = getThroneConfigs(opts?.requestedStudyId);
  const studyResults: Array<{studyId: string; sessionCount: number; metricCount: number; skipped?: boolean}> = [];
  let sessionCount = 0;
  let metricCount = 0;

  for (const config of configs) {
    if (opts?.skipIfRecent && await syncedWithinLastHour(config.studyId)) {
      logger.info(`Skipping Throne ingestion for ${config.studyId}: synced within the last hour`);
      studyResults.push({studyId: config.studyId, sessionCount: 0, metricCount: 0, skipped: true});
      continue;
    }

    logger.info(`Starting Throne ingestion for study ${config.studyId}`);
    const result = await runThroneIngestion(config, {fullSync: opts?.fullSync});
    sessionCount += result.sessionCount;
    metricCount += result.metricCount;
    studyResults.push({...result, studyId: config.studyId});
  }

  return {sessionCount, metricCount, studyResults};
}

// ─── Scheduled Daily Ingestion ───────────────────────────────────────────────

export const throneIngestDaily = onSchedule(
  {
    schedule: "0 0 * * *",
    timeZone: "America/Los_Angeles",
    secrets: [...THRONE_RUNTIME_SECRETS],
  },
  async () => {
    logger.info("Starting scheduled Throne ingestion");
    const studyIds = getConfiguredStudyIds();

    try {
      const result = await runConfiguredThroneIngestion();
      logger.info("Throne ingestion complete", result);
    } catch (err) {
      logger.error("Throne ingestion failed", err);

      const db = admin.firestore();
      await Promise.all(studyIds.map((studyId) => db.collection("throneSync").doc(studyId).set({
        lastRunAt: new Date().toISOString(),
        lastStatus: "error",
        lastError: err instanceof Error ? err.message : String(err),
      }, {merge: true})));

      throw err;
    }
  },
);

// ─── Manual HTTP Trigger ─────────────────────────────────────────────────────

// ─── App-Open Sync Trigger ───────────────────────────────────────────────────

/**
 * Fires when the app writes to users/{uid}/sync_requests/latest on first open.
 * Runs ingestion immediately if the study hasn't synced in the last hour,
 * then lets the daily schedule take over afterward.
 */
export const onThroneSyncRequest = onDocumentWritten(
  {
    document: "users/{uid}/sync_requests/latest",
    secrets: [...THRONE_RUNTIME_SECRETS],
  },
  async () => {
    logger.info("App-open sync request received — starting ingestion");
    try {
      const result = await runConfiguredThroneIngestion({skipIfRecent: true});
      logger.info("App-open sync complete", result);
    } catch (err) {
      logger.error("App-open sync failed", err);
      throw err;
    }
  },
);

// ─── Manual HTTP Trigger ─────────────────────────────────────────────────────

export const syncThroneNow = onRequest({secrets: [...THRONE_ADMIN_RUNTIME_SECRETS]}, async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const expected = process.env.ADMIN_TOKEN?.trim() ?? "";
  const token = typeof req.headers["x-admin-token"] === "string" ?
    req.headers["x-admin-token"] :
    "";
  const validToken = expected.length > 0 &&
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  if (!validToken) {
    res.status(401).send("Unauthorized: invalid or missing x-admin-token");
    return;
  }

  logger.info("Manual Throne sync triggered");

  try {
    const fullSync = req.body?.fullSync === true;
    const requestedStudyId = typeof req.body?.studyId === "string" ?
      req.body.studyId.trim() :
      undefined;
    const result = await runConfiguredThroneIngestion({fullSync, requestedStudyId});
    res.status(200).json({status: "ok", fullSync, ...result});
  } catch (err) {
    logger.error("Manual Throne sync failed", err);
    res.status(500).json({
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export const syncThroneResearch = onRequest({secrets: [...THRONE_RUNTIME_SECRETS]}, async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const researcherUid = await requireResearcherUid(req);
    const requestedStudyId = typeof req.body?.studyId === "string" ?
      req.body.studyId.trim() :
      undefined;

    logger.info("Researcher-triggered Throne sync", {researcherUid, requestedStudyId});

    const result = await runConfiguredThroneIngestion({
      fullSync: false,
      requestedStudyId,
      skipIfRecent: false,
    });

    res.status(200).json({
      status: "ok",
      researcherUid,
      incrementalOnly: true,
      ...result,
    });
  } catch (err) {
    logger.error("Researcher-triggered Throne sync failed", err);
    res.status(500).json({
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export const backfillThroneParticipant = onRequest(
  {
    secrets: [...THRONE_RUNTIME_SECRETS],
    timeoutSeconds: 540,
  },
  async (req, res) => {
    if (setCorsHeaders(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    try {
      const researcherUid = await requireResearcherUid(req);
      const email = typeof req.body?.email === "string" ?
        normalizeEnrollmentEmail(req.body.email) :
        "";
      if (!looksLikeEmailIdentifier(email)) {
        throw new ValidationError("email must be a valid address");
      }

      const requestedStudyId = typeof req.body?.studyId === "string" ?
        req.body.studyId.trim() :
        undefined;
      const rawDays = Number(req.body?.days ?? 180);
      const days = Number.isFinite(rawDays) ?
        Math.min(Math.max(Math.floor(rawDays), 1), 365) :
        180;

      logger.info("Researcher-triggered Throne participant backfill", {
        researcherUid,
        email: email.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
        days,
        requestedStudyId,
      });

      const configs = getThroneConfigs(requestedStudyId);
      const result = await runThroneBackfillForEmail(configs[0], email, {days});

      res.status(200).json({
        status: "ok",
        researcherUid,
        ...result,
      });
    } catch (err) {
      logger.error("Researcher-triggered Throne participant backfill failed", err);
      sendValidationError(res, err);
    }
  },
);

export const enrollUdsParticipants = onRequest(async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const researcherUid = await requireResearcherUid(req);
    const rawEmails: unknown[] = Array.isArray(req.body?.emails) ? req.body.emails as unknown[] : [];
    const emails: string[] = Array.from(new Set(
      rawEmails
        .filter((value: unknown): value is string => typeof value === "string")
        .map((value: string) => normalizeEnrollmentEmail(value))
        .filter((value: string) => Boolean(value)),
    ));

    if (!emails.length) {
      res.status(400).json({status: "error", message: "No valid participant emails were provided"});
      return;
    }

    const db = admin.firestore();
    const authClient = admin.auth();
    const created: Array<{email: string; uid: string; throneAccountEmail: string; createdUser: boolean}> = [];
    const skipped: Array<{email: string; reason: string}> = [];

    for (const email of emails) {
      const existingPatientByEmail = await db.collection("patients")
        .where("email", "==", email)
        .where("studyKey", "==", "uds")
        .limit(1)
        .get();

      if (!existingPatientByEmail.empty) {
        skipped.push({email, reason: "already enrolled in UDS"});
        continue;
      }

      let userRecord: admin.auth.UserRecord;
      let createdUser = false;
      try {
        userRecord = await authClient.getUserByEmail(email);
      } catch (error: any) {
        if (error?.code !== "auth/user-not-found") {
          throw error;
        }
        userRecord = await authClient.createUser({
          email,
          emailVerified: false,
          password: crypto.randomBytes(24).toString("base64url"),
          displayName: email,
        });
        createdUser = true;
      }

      const userRef = db.collection("users").doc(userRecord.uid);
      const userSnap = await userRef.get();
      const existingThroneUserId = userSnap.exists ?
        String(userSnap.data()?.throneUserId || "").trim() :
        "";
      const existingThroneAccountEmail = userSnap.exists ?
        String(userSnap.data()?.throneAccountEmail || "").trim().toLowerCase() :
        "";

      if (existingThroneUserId && !looksLikeEmailIdentifier(existingThroneUserId)) {
        skipped.push({
          email,
          reason: `existing throneUserId (${existingThroneUserId}) is already linked to this Firebase account`,
        });
        continue;
      }

      const userPayload: Record<string, unknown> = {
        email,
        name: userSnap.data()?.name || email,
        displayName: userSnap.data()?.displayName || email,
        throneAccountEmail: existingThroneAccountEmail || email,
        studyKey: "uds",
        studyId: STUDY_ID,
        status: "active",
        enrolledAt: userSnap.data()?.enrolledAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdAt: userSnap.data()?.createdAt || new Date().toISOString(),
        enrollmentSource: "researcher_dashboard_uds",
      };

      if (looksLikeEmailIdentifier(existingThroneUserId)) {
        userPayload.throneAccountEmail = existingThroneUserId.toLowerCase();
        userPayload.throneUserId = admin.firestore.FieldValue.delete();
        userPayload.throneUserIdSetAt = admin.firestore.FieldValue.delete();
      }

      await userRef.set(userPayload, {merge: true});

      const patientRef = db.collection("patients").doc();
      await patientRef.set({
        email,
        name: userSnap.data()?.name || email,
        userId: userRecord.uid,
        studyKey: "uds",
        studyId: STUDY_ID,
        status: "active",
        throneAccountEmail: existingThroneAccountEmail || email,
        enrolledAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        createdBy: researcherUid,
      }, {merge: true});

      created.push({
        email,
        uid: userRecord.uid,
        throneAccountEmail: existingThroneAccountEmail || email,
        createdUser,
      });
    }

    res.status(200).json({
      status: "ok",
      created,
      skipped,
    });
  } catch (error) {
    logger.error("UDS participant enrollment failed", error);
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// ─── Cowork Adherence Sync ───────────────────────────────────────────────────

/**
 * Daily endpoint the Cowork / Claude Code routine calls. Reads the
 * tracker.csv on the Cowork side, POSTs the post-arrival rows, and
 * receives back enrollment + adherence data so the routine can update
 * the tracker and surface reminder flags. Authenticated with a single
 * bearer token (`COWORK_SYNC_TOKEN` secret) — no Firebase Auth flow
 * because the routine runs unattended.
 *
 * Build: 2026-05-11 (force revision refresh to rebind rotated secret)
 */
export const coworkAdherenceSync = onRequest(
  {secrets: ["COWORK_SYNC_TOKEN"], invoker: "public"},
  async (req, res) => {
    if (setCorsHeaders(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }
    if (!verifyCoworkToken(req.headers.authorization)) {
      res.status(401).json({
        status: "error",
        message: "Unauthorized: missing or invalid Cowork bearer token",
      });
      return;
    }
    try {
      const rawThreshold = Number(req.body?.staleVoidThresholdDays);
      const result = await handleCoworkAdherence(req.body, {
        staleThresholdDays: Number.isFinite(rawThreshold) ? rawThreshold : undefined,
      });
      res.status(200).json({status: "ok", ...result});
    } catch (err) {
      if (err instanceof CoworkValidationError) {
        res.status(400).json({status: "error", code: "validation", message: err.message});
        return;
      }
      logger.error("coworkAdherenceSync failed", err);
      res.status(500).json({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ─── Participant Lifecycle ───────────────────────────────────────────────────

async function requireAuthUid(req: any): Promise<{uid: string; email: string | null}> {
  const bearer = getBearerToken(req);
  if (!bearer) throw new Error("Missing Firebase bearer token");
  const decoded = await admin.auth().verifyIdToken(bearer);
  return {uid: decoded.uid, email: (decoded.email ?? null) as string | null};
}

async function isResearcher(uid: string): Promise<boolean> {
  const snap = await admin.firestore().collection("Researchers").doc(uid).get();
  return snap.exists;
}

function sendValidationError(res: any, err: unknown): void {
  if (err instanceof ValidationError) {
    res.status(400).json({status: "error", code: "validation", message: err.message});
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error("Participant callable error", err);
  res.status(500).json({status: "error", message});
}

/**
 * Researcher creates a pending participant record from the dashboard. No
 * writes happen client-side; all patients/* writes flow through here so
 * PHI validation + duplicate detection + the Throne-email invariant are
 * enforced in one place.
 */
export const createParticipant = onRequest(async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  try {
    const researcherUid = await requireResearcherUid(req);
    const result = await createParticipantImpl(
      admin.firestore(),
      req.body ?? {},
      {researcherUid},
    );
    res.status(200).json({status: "ok", ...result});
  } catch (err) {
    sendValidationError(res, err);
  }
});

/**
 * Called by the iOS app after sign-in. If a patients/* doc is pending
 * for the signed-in user's email, flips it to active and writes the
 * users/{uid} mirror. Hard-refuses when auth email doesn't match the
 * pending record's email (sacred invariant).
 */
export const claimParticipant = onRequest(async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  try {
    const {uid, email} = await requireAuthUid(req);
    const result = await claimParticipantImpl(admin.firestore(), uid, email);
    res.status(200).json({status: "ok", ...result});
  } catch (err) {
    sendValidationError(res, err);
  }
});

/**
 * Records a uds→bph transition request. Either the participant (app) or
 * a researcher (dashboard) may call it. Sets pendingPathwayChange but
 * does NOT mutate `pathway` — that only happens when the counterparty
 * calls confirmPathwayChange.
 */
export const requestPathwayChange = onRequest(async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  try {
    const {uid} = await requireAuthUid(req);
    const participantId = typeof req.body?.participantId === "string" ?
      req.body.participantId.trim() :
      "";
    const to = req.body?.to;
    if (!participantId) throw new ValidationError("participantId is required");
    if (to !== "bph") throw new ValidationError("to must be \"bph\"");
    const kind: "participant" | "researcher" = (await isResearcher(uid)) ?
      "researcher" :
      "participant";
    await requestPathwayChangeImpl(admin.firestore(), participantId, to, {uid, kind});
    res.status(200).json({status: "ok"});
  } catch (err) {
    sendValidationError(res, err);
  }
});

/**
 * Researcher-only correction of an enrolled participant's Throne account
 * email. Used when the contact email (`patients/{id}.email`) doesn't
 * match the email Throne returns on session exports — most commonly
 * because the participant signed up to Throne via Apple Hide-My-Email.
 *
 * Backfill is NOT triggered automatically; the dashboard caller should
 * follow up with backfillThroneParticipant against the new email to pull
 * any sessions already on Throne's side.
 */
export const setParticipantThroneEmail = onRequest(async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  try {
    const researcherUid = await requireResearcherUid(req);
    const result = await setParticipantThroneEmailImpl(admin.firestore(), req.body ?? {});
    logger.info("setParticipantThroneEmail: researcher updated", {researcherUid, ...result});
    res.status(200).json({status: "ok", ...result});
  } catch (err) {
    sendValidationError(res, err);
  }
});

/**
 * Researcher withdraws a participant from the study. Sets status="withdrawn"
 * on both patients/{id} and users/{uid} (when claimed), records actor + reason.
 * No data is deleted — voids, HK samples, IPSS scores all remain. Roster
 * cards move to the Withdrawn column on next dashboard refresh.
 */
export const withdrawParticipant = onRequest(async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  try {
    const researcherUid = await requireResearcherUid(req);
    const participantId = typeof req.body?.participantId === "string" ?
      req.body.participantId.trim() :
      "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
    const result = await withdrawParticipantImpl(
      admin.firestore(),
      participantId,
      reason,
      {researcherUid},
    );
    res.status(200).json({status: "ok", ...result});
  } catch (err) {
    sendValidationError(res, err);
  }
});

/**
 * Counterparty confirms a pending pathway change. The caller's role
 * (participant vs researcher) must be the OPPOSITE of the requester's;
 * otherwise the confirmation is rejected.
 */
export const confirmPathwayChange = onRequest(async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  try {
    const {uid} = await requireAuthUid(req);
    const participantId = typeof req.body?.participantId === "string" ?
      req.body.participantId.trim() :
      "";
    if (!participantId) throw new ValidationError("participantId is required");
    const kind: "participant" | "researcher" = (await isResearcher(uid)) ?
      "researcher" :
      "participant";
    await confirmPathwayChangeImpl(admin.firestore(), participantId, {uid, kind});
    res.status(200).json({status: "ok"});
  } catch (err) {
    sendValidationError(res, err);
  }
});

// ─── One-shot Production Migration ───────────────────────────────────────────

/**
 * Migrates legacy "streamsync-uds" users into the new patients/* schema.
 * Idempotent — skips records that already have a patients doc. Defaults
 * to the three known prod participants identified in the 2026-04-18 audit.
 * Pass {dryRun: true} to preview without writing.
 */
export const migrateProdParticipants = onRequest(async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  try {
    const researcherUid = await requireResearcherUid(req);
    const dryRun = req.body?.dryRun === true;
    const rawEmails: unknown[] = Array.isArray(req.body?.emails) ?
      req.body.emails as unknown[] :
      [];
    const emails = rawEmails
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    const targets = emails.length ? emails : defaultMigrationTargets();

    const result = await migrateProdParticipantsImpl(
      admin.firestore(),
      admin.auth(),
      {dryRun, emails: targets, researcherUid},
    );
    res.status(200).json({status: "ok", dryRun, ...result});
  } catch (err) {
    logger.error("migrateProdParticipants failed", err);
    res.status(500).json({
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// ─── AI Support Chat (Anthropic) ────────────────────────────────────────────

/**
 * Anthropic-backed support chat — opens with a device-specific greeting,
 * persists every turn to /supportChats/{chatId}/messages so the
 * researcher dashboard can watch in real time, and applies the PII
 * firewall (only firstName + study-logistics fields ever leave Firestore).
 *
 * Required secret: ANTHROPIC_API_KEY
 */
export const claudeSupportChat = onRequest(
  {secrets: ["ANTHROPIC_API_KEY"]},
  handleSupportChat,
);

/**
 * Nightly summarizer — runs at 2 AM Pacific, walks every supportChat
 * touched in the last 24h, and writes a JSON summary to
 * nightly_summaries/{YYYY-MM-DD}. Researcher dashboard reads from there.
 */
export const supportChatNightlySummary = onSchedule(
  {
    schedule: "0 2 * * *",
    timeZone: "America/Los_Angeles",
    secrets: ["ANTHROPIC_API_KEY"],
  },
  async () => {
    logger.info("Starting nightly support-chat summary");
    try {
      await runNightlySupportSummary();
    } catch (err) {
      logger.error("Nightly support-chat summary failed", err);
      throw err;
    }
  },
);
