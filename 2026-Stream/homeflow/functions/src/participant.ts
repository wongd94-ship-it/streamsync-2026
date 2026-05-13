/**
 * Participant lifecycle Cloud Functions.
 *
 * Ships four callable-style HTTPs endpoints:
 *   createParticipant       — researcher creates a dashboard-owned participant
 *   claimParticipant        — iOS app links a signed-in user to their pending record
 *   requestPathwayChange    — either side requests a uds→bph transition
 *   confirmPathwayChange    — counterparty confirms and the pathway flips
 *
 * Policy decisions (see plan tidy-scribbling-pudding.md):
 *   - ALL writes to patients/{id} go through a callable (no direct client
 *     writes). Clients cannot read patients/{id} either — they read the
 *     non-PHI mirror at users/{firebaseUid}.
 *   - The contact email (`email`) drives Streamsync auth + the claim
 *     flow. The Throne join key (`throneAccountEmail`) defaults to it but
 *     can diverge when a participant signed up to Throne with a different
 *     address (typically Apple Hide-My-Email). createParticipant accepts
 *     an optional throneAccountEmail input; setParticipantThroneEmail
 *     corrects an already-enrolled participant.
 *   - DOB is stored as a full ISO-8601 timestamp (user answered "Full
 *     date (Timestamp)" during the plan-approval flow).
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {STUDY_ID} from "./studyConfig";

// ─── Shared types (kept in sync with lib/types/study.ts) ─────────────────────

type Pathway = "uds" | "bph";

function isPathway(value: unknown): value is Pathway {
  return value === "uds" || value === "bph";
}

interface CreateParticipantInput {
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  dob?: unknown;
  phoneNumber?: unknown;
  pathway?: unknown;
  upcomingVisitDate?: unknown;
  upcomingVisitNotes?: unknown;
  confirmedThroneEmailMatch?: unknown;
  throneAccountEmail?: unknown;
}

// ─── Validation helpers ──────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Permissive US-ish phone check: 10+ digits after stripping formatting.
// We accept E.164 as well; Twilio-level validation lives in the UI.
function isPlausiblePhone(value: string): boolean {
  const digits = value.replace(/[^\d]/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function parseDobOrThrow(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError("dob must be a valid ISO-8601 date");
  }
  const now = new Date();
  const ageYears = (now.getTime() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (ageYears < 18 || ageYears > 120) {
    throw new ValidationError(`dob implies an age of ${ageYears.toFixed(1)} years; participants must be at least 18`);
  }
  return parsed;
}

function parseUpcomingVisitDateOrThrow(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError("upcomingVisitDate must be a valid ISO-8601 date");
  }
  return parsed;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${field} is required`);
  }
  return value.trim();
}

function normalizeEmail(value: unknown): string {
  const str = asNonEmptyString(value, "email").toLowerCase();
  if (!EMAIL_REGEX.test(str)) {
    throw new ValidationError("email is not a valid address");
  }
  return str;
}

// ─── createParticipant ───────────────────────────────────────────────────────

export interface CreateParticipantContext {
  researcherUid: string;
}

export async function createParticipant(
  db: admin.firestore.Firestore,
  input: CreateParticipantInput,
  ctx: CreateParticipantContext,
): Promise<{participantId: string; firebaseUid: string}> {
  // ── Input validation ──────────────────────────────────────────────────────
  // The dashboard form simplified down to email-only enrollment — the
  // researcher uses the Create Participant form purely to start tracking
  // adherence, and PHI (name, DOB, phone, upcoming visit) gets filled in
  // later from the participant's detail page or by the participant's app
  // claim flow. Only email is required here; everything else is optional.
  const email = normalizeEmail(input.email);
  const firstName = typeof input.firstName === "string" && input.firstName.trim() ?
    input.firstName.trim() :
    null;
  const lastName = typeof input.lastName === "string" && input.lastName.trim() ?
    input.lastName.trim() :
    null;
  const dobStr = typeof input.dob === "string" && input.dob.trim() ?
    input.dob.trim() :
    null;
  const phoneRaw = typeof input.phoneNumber === "string" && input.phoneNumber.trim() ?
    input.phoneNumber.trim() :
    null;
  const pathwayRaw = input.pathway;
  const upcomingVisitDateStr =
    typeof input.upcomingVisitDate === "string" && input.upcomingVisitDate.trim() ?
      input.upcomingVisitDate.trim() :
      null;
  const upcomingVisitNotes = typeof input.upcomingVisitNotes === "string" ?
    input.upcomingVisitNotes.trim() :
    undefined;
  const confirmedThroneEmailMatch = input.confirmedThroneEmailMatch;
  // Optional override — when provided, this is the email the participant
  // used at Throne One signup (e.g. Apple Hide-My-Email). Defaults to the
  // contact email when omitted.
  const throneAccountEmail = input.throneAccountEmail == null || input.throneAccountEmail === "" ?
    email :
    normalizeEmail(input.throneAccountEmail);

  if (confirmedThroneEmailMatch !== true) {
    throw new ValidationError(
      "confirmedThroneEmailMatch must be true — researcher must confirm email matches Throne account",
    );
  }
  if (!isPathway(pathwayRaw)) {
    throw new ValidationError("pathway must be \"uds\" or \"bph\"");
  }
  if (phoneRaw !== null && !isPlausiblePhone(phoneRaw)) {
    throw new ValidationError("phoneNumber does not look like a valid phone number");
  }
  const dob = dobStr ? parseDobOrThrow(dobStr) : null;
  const upcomingVisitDate = upcomingVisitDateStr ?
    parseUpcomingVisitDateOrThrow(upcomingVisitDateStr) :
    null;
  const pathway: Pathway = pathwayRaw;

  // ── Duplicate detection ───────────────────────────────────────────────────
  const existing = await db.collection("patients")
    .where("email", "==", email)
    .get();
  const activeConflict = existing.docs.find((d) => {
    const status = d.data()?.status;
    return status !== "withdrawn";
  });
  if (activeConflict) {
    throw new ValidationError(
      `Email ${email} is already enrolled (patients/${activeConflict.id}, status=${activeConflict.data()?.status})`,
    );
  }

  // ── Writes ────────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const upcomingVisitType = pathway === "uds" ? "uds" : "bph_surgery";
  const participantRef = db.collection("patients").doc();
  const participantId = participantRef.id;
  const dashboardUid = participantId;
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || email;
  const upcomingVisit = upcomingVisitDate ?
    {
      type: upcomingVisitType,
      date: upcomingVisitDate.toISOString(),
      ...(upcomingVisitNotes ? {notes: upcomingVisitNotes} : {}),
    } :
    null;

  const participantDoc = {
    id: participantId,
    studyId: STUDY_ID,
    pathway,
    // PHI — researcher-only. All optional during email-only enrollment;
    // nulls let the dashboard detail page prompt for them later.
    firstName,
    lastName,
    dob: dob ? dob.toISOString() : null,
    phoneNumber: phoneRaw,
    email,
    // Defaults to email; researcher can supply a different address when
    // the participant signed up to Throne with a separate email.
    throneAccountEmail,
    throneUserId: null,
    upcomingVisit,
    pendingPathwayChange: null,
    firebaseUid: dashboardUid,
    userId: dashboardUid,
    status: "active" as const,
    accountSource: "dashboard" as const,
    dashboardCreated: true,
    enrolledAt: now,
    claimedAt: now,
    createdAt: now,
    updatedAt: now,
    enrolledBy: ctx.researcherUid,
    // Legacy field retained for compatibility with older dashboard filters
    // that key by studyKey. Mirrors `pathway`.
    studyKey: pathway === "uds" ? "uds" : "bladder",
  };
  const userMirror = {
    studyId: STUDY_ID,
    pathway,
    studyKey: pathway === "uds" ? "uds" : "bladder",
    upcomingVisit,
    throneAccountEmail,
    throneAccountLinked: true,
    email,
    firstName,
    lastName,
    name: displayName,
    displayName,
    phoneNumber: phoneRaw,
    accountSource: "dashboard",
    dashboardCreated: true,
    patientDocId: participantId,
    onboardingComplete: true,
    createdAt: now,
    updatedAt: now,
  };

  const batch = db.batch();
  batch.set(participantRef, participantDoc);
  batch.set(db.collection("users").doc(dashboardUid), userMirror, {merge: true});
  // Key by throneAccountEmail — that's the email Throne returns on every
  // session, and what the ingestion router uses to route sessions to a
  // Firebase user. When the contact email differs (Hide-My-Email case),
  // we also write a doc keyed by `email` so a future researcher who only
  // knows the contact email can still resolve to the same firebaseUid.
  batch.set(
    db.collection("throne_research_participants").doc(throneAccountEmail),
    {
      email: throneAccountEmail,
      throneAccountEmail,
      firebaseUid: dashboardUid,
      enrolledAt: now,
      throneAccountCreated: true,
      lastSyncAt: null,
    },
    {merge: true},
  );
  if (throneAccountEmail !== email) {
    batch.set(
      db.collection("throne_research_participants").doc(email),
      {
        email,
        throneAccountEmail,
        firebaseUid: dashboardUid,
        enrolledAt: now,
        throneAccountCreated: true,
        lastSyncAt: null,
      },
      {merge: true},
    );
  }
  await batch.commit();

  logger.info("createParticipant: created dashboard-owned participant", {
    participantId,
    dashboardUid,
    email,
    throneAccountEmail,
    pathway,
  });
  return {participantId, firebaseUid: dashboardUid};
}

// ─── claimParticipant ────────────────────────────────────────────────────────

export async function claimParticipant(
  db: admin.firestore.Firestore,
  authUid: string,
  authEmail: string | null | undefined,
): Promise<{claimed: boolean; participantId?: string; reason?: string}> {
  if (!authEmail) {
    return {claimed: false, reason: "Signed-in user has no email claim on their Firebase token"};
  }
  const normalized = authEmail.trim().toLowerCase();

  const pending = await db.collection("patients")
    .where("email", "==", normalized)
    .where("status", "==", "pending_app_signup")
    .limit(1)
    .get();

  if (pending.empty) {
    return {claimed: false, reason: "No pending participant matched this email"};
  }

  const doc = pending.docs[0];
  const data = doc.data();

  // Sacred invariant guard: patients/{id}.email MUST equal the auth email.
  // The query above already filters by email, but we re-check to make the
  // invariant explicit in the claim path itself.
  // Sacred invariant guard, same rule as lib/types/study.ts#isClaimAuthorized.
  const authMatchesPatient = typeof data.email === "string" &&
    data.email.trim().toLowerCase() === normalized;
  if (!authMatchesPatient) {
    logger.warn("claimParticipant: email mismatch after query", {
      authEmail: normalized,
      docEmail: data.email,
    });
    return {claimed: false, reason: "Email mismatch after lookup"};
  }

  const now = new Date().toISOString();

  // Writes: flip patients doc to active + write users/{uid} mirror. Both
  // in one batch so either both land or neither does.
  const userMirror = {
    studyId: STUDY_ID,
    pathway: data.pathway,
    upcomingVisit: data.upcomingVisit ?? null,
    throneAccountEmail: data.throneAccountEmail,
    throneAccountLinked: false,
    updatedAt: now,
  };

  const batch = db.batch();
  batch.update(doc.ref, {
    firebaseUid: authUid,
    status: "active",
    claimedAt: now,
    updatedAt: now,
  });
  batch.set(db.collection("users").doc(authUid), userMirror, {merge: true});
  batch.set(
    db.collection("throne_research_participants").doc(normalized),
    {firebaseUid: authUid},
    {merge: true},
  );
  await batch.commit();

  logger.info("claimParticipant: claimed", {participantId: doc.id, authUid, email: normalized});
  return {claimed: true, participantId: doc.id};
}

// ─── requestPathwayChange ────────────────────────────────────────────────────

export async function requestPathwayChange(
  db: admin.firestore.Firestore,
  participantId: string,
  to: Pathway,
  initiator: {uid: string; kind: "participant" | "researcher"},
): Promise<void> {
  if (to !== "bph") {
    throw new ValidationError("Only uds→bph transitions are supported; `to` must be \"bph\"");
  }
  const ref = db.collection("patients").doc(participantId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new ValidationError(`patients/${participantId} does not exist`);
  }
  const data = snap.data() ?? {};
  if (data.pathway !== "uds") {
    throw new ValidationError(
      `Cannot transition to bph: current pathway is ${data.pathway}`,
    );
  }
  // If participant-initiated, they must own the record.
  if (initiator.kind === "participant" && data.firebaseUid !== initiator.uid) {
    throw new ValidationError("Participant may only request a pathway change on their own record");
  }

  const now = new Date().toISOString();
  await ref.update({
    pendingPathwayChange: {
      from: "uds",
      to: "bph",
      requestedAt: now,
      requestedBy: initiator.kind,
      requestedByUid: initiator.uid,
    },
    updatedAt: now,
  });
  logger.info("requestPathwayChange: pending set", {participantId, initiator});
}

// ─── confirmPathwayChange ────────────────────────────────────────────────────

export async function confirmPathwayChange(
  db: admin.firestore.Firestore,
  participantId: string,
  confirmer: {uid: string; kind: "participant" | "researcher"},
): Promise<void> {
  const ref = db.collection("patients").doc(participantId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new ValidationError(`patients/${participantId} does not exist`);
  }
  const data = snap.data() ?? {};
  const pending = data.pendingPathwayChange;
  if (!pending) {
    throw new ValidationError("No pending pathway change on this participant");
  }
  if (pending.requestedBy === confirmer.kind) {
    // Counterparty rule: the confirmer must be the OTHER side from the
    // requester. Without this check, a single actor could both request
    // and confirm in two calls.
    throw new ValidationError(
      `Pathway change was requested by ${pending.requestedBy}; confirmation must come from the counterparty`,
    );
  }
  if (confirmer.kind === "participant" && data.firebaseUid !== confirmer.uid) {
    throw new ValidationError("Participant may only confirm on their own record");
  }

  const now = new Date().toISOString();
  const newPathway: Pathway = pending.to;

  const batch = db.batch();
  batch.update(ref, {
    pathway: newPathway,
    pendingPathwayChange: null,
    updatedAt: now,
    // studyKey mirror for legacy filters.
    studyKey: newPathway === "uds" ? "uds" : "bladder",
  });

  // Mirror to users/{uid} if claimed.
  if (data.firebaseUid) {
    batch.set(db.collection("users").doc(data.firebaseUid), {
      pathway: newPathway,
      updatedAt: now,
    }, {merge: true});
  }
  await batch.commit();
  logger.info("confirmPathwayChange: applied", {participantId, newPathway, confirmer});
}

// ─── setParticipantThroneEmail ───────────────────────────────────────────────

export interface SetParticipantThroneEmailInput {
  participantId?: unknown;
  throneAccountEmail?: unknown;
}

/**
 * Researcher-only correction path. Updates an already-enrolled
 * participant's Throne account email (the email the Throne API returns on
 * each session). Use this when the participant signed up to Throne with a
 * different address than their Streamsync contact email — most commonly
 * Apple Hide-My-Email, where Throne sees `<random>@privaterelay.appleid.com`
 * but Streamsync was enrolled with the contact email.
 *
 * Writes:
 *   patients/{id}.throneAccountEmail        — the canonical join key
 *   users/{firebaseUid}.throneAccountEmail  — mirrored to the iOS app
 *   throne_research_participants/{newEmail} — uid map for the ingestion router
 *
 * Does NOT trigger a Throne backfill — the caller is expected to invoke
 * backfillThroneParticipant afterward to pull any historical sessions.
 *
 * @param {admin.firestore.Firestore} db The Firestore client.
 * @param {SetParticipantThroneEmailInput} input participantId + new throneAccountEmail.
 * @return {Promise<object>} The participant id, firebase uid, the new throne email,
 *   and the previous value (null if unset).
 */
export async function setParticipantThroneEmail(
  db: admin.firestore.Firestore,
  input: SetParticipantThroneEmailInput,
): Promise<{
  participantId: string;
  firebaseUid: string | null;
  throneAccountEmail: string;
  previousThroneAccountEmail: string | null;
}> {
  const participantId = asNonEmptyString(input.participantId, "participantId");
  const throneAccountEmail = normalizeEmail(input.throneAccountEmail);

  const ref = db.collection("patients").doc(participantId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new ValidationError(`patients/${participantId} does not exist`);
  }
  const data = snap.data() ?? {};
  const firebaseUid = typeof data.firebaseUid === "string" ? data.firebaseUid : null;
  const contactEmail = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const previous = typeof data.throneAccountEmail === "string" ?
    data.throneAccountEmail.trim().toLowerCase() :
    null;

  if (previous === throneAccountEmail) {
    logger.info("setParticipantThroneEmail: no-op (already set)", {
      participantId,
      throneAccountEmail,
    });
    return {participantId, firebaseUid, throneAccountEmail, previousThroneAccountEmail: previous};
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  batch.update(ref, {throneAccountEmail, updatedAt: now});
  if (firebaseUid) {
    batch.set(
      db.collection("users").doc(firebaseUid),
      {throneAccountEmail, updatedAt: now},
      {merge: true},
    );
  }
  // The ingestion router reads users/{uid}.throneAccountEmail directly, but
  // we still write the throne_research_participants entry so the email →
  // firebaseUid map stays queryable from the dashboard and admin scripts.
  batch.set(
    db.collection("throne_research_participants").doc(throneAccountEmail),
    {
      email: throneAccountEmail,
      throneAccountEmail,
      firebaseUid: firebaseUid ?? null,
      throneAccountCreated: true,
      updatedAt: now,
    },
    {merge: true},
  );
  if (contactEmail && contactEmail !== throneAccountEmail) {
    batch.set(
      db.collection("throne_research_participants").doc(contactEmail),
      {
        email: contactEmail,
        throneAccountEmail,
        firebaseUid: firebaseUid ?? null,
        updatedAt: now,
      },
      {merge: true},
    );
  }
  await batch.commit();

  logger.info("setParticipantThroneEmail: updated", {
    participantId,
    firebaseUid,
    contactEmail,
    previous,
    throneAccountEmail,
  });
  return {
    participantId,
    firebaseUid,
    throneAccountEmail,
    previousThroneAccountEmail: previous,
  };
}

// ─── withdrawParticipant ─────────────────────────────────────────────────────
//
// Researcher-initiated withdrawal of a participant from a study. Flips
// `status` to "withdrawn" on both patients/{id} and users/{uid} (when the
// account has been claimed) and records who withdrew them and why. Idempotent —
// re-calling on an already-withdrawn record updates `withdrawnAt` and reason
// rather than erroring. We deliberately do NOT delete any data: throne_sessions,
// hk_*, ipss_scores etc. all remain readable for the research record.

export interface WithdrawParticipantContext {
  researcherUid: string;
}

export async function withdrawParticipant(
  db: admin.firestore.Firestore,
  participantId: string,
  reason: string | null,
  ctx: WithdrawParticipantContext,
): Promise<{participantId: string; firebaseUid: string | null; participantStatus: string}> {
  if (!participantId) throw new ValidationError("participantId is required");
  const trimmedReason = typeof reason === "string" ? reason.trim().slice(0, 500) : null;

  const ref = db.collection("patients").doc(participantId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new ValidationError(`patients/${participantId} does not exist`);
  }
  const data = snap.data() ?? {};
  const firebaseUid: string | null = (typeof data.userId === "string" && data.userId) ?
    data.userId :
    (typeof data.firebaseUid === "string" && data.firebaseUid ? data.firebaseUid : null);

  const now = new Date().toISOString();
  const batch = db.batch();
  batch.set(ref, {
    status: "withdrawn",
    withdrawnAt: now,
    withdrawnBy: ctx.researcherUid,
    withdrawalReason: trimmedReason,
    updatedAt: now,
  }, {merge: true});

  // Mirror to users/{uid} so the participant detail surface in the dashboard
  // reflects the withdrawal even if the dashboard reads from users first.
  if (firebaseUid) {
    batch.set(db.collection("users").doc(firebaseUid), {
      status: "withdrawn",
      withdrawnAt: now,
      withdrawnBy: ctx.researcherUid,
      updatedAt: now,
    }, {merge: true});
  }
  await batch.commit();
  logger.info("withdrawParticipant: applied", {
    participantId, firebaseUid, researcherUid: ctx.researcherUid, hasReason: !!trimmedReason,
  });
  return {participantId, firebaseUid, participantStatus: "withdrawn"};
}

// ─── Exports for onRequest wrappers (see index.ts) ───────────────────────────

export {ValidationError};
