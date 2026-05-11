/**
 * Study + participant type definitions.
 *
 * These types describe the post-T3 participant model. The canonical
 * participant document lives at `patients/{participantId}` (researcher-
 * only, holds PHI). A non-PHI mirror lives at `users/{firebaseUid}` and
 * carries only the fields the iOS app needs at runtime (studyId, pathway,
 * upcomingVisit, throneAccountEmail, throneAccountLinked, currentPhase).
 */

/**
 * Study pathway. Immutable except for a two-sided confirmed uds→bph
 * transition — see `PendingPathwayChange`. No other transitions (bph→uds,
 * or starting mid-pathway) are permitted.
 */
export type Pathway = "uds" | "bph";

export const PATHWAY_VALUES: readonly Pathway[] = ["uds", "bph"] as const;

export function isPathway(value: unknown): value is Pathway {
  return value === "uds" || value === "bph";
}

/**
 * Type of the next scheduled visit for a participant. Drives the
 * dashboard's "upcoming visits" sort and the iOS dashboard's countdown.
 */
export type UpcomingVisitType = "uds" | "bph_surgery";

export interface UpcomingVisit {
  type: UpcomingVisitType;
  /** ISO-8601 timestamp (YYYY-MM-DDTHH:mm:ss.sssZ). */
  date: string;
  notes?: string;
}

/**
 * Pending pathway transition state. Set when either the participant
 * (app) or researcher (dashboard) requests a uds→bph switch. The field
 * is cleared (and `pathway` flipped) only when the counterparty calls
 * `confirmPathwayChange`. While this field is non-null, the participant
 * is still considered on the original pathway for every other purpose.
 */
export interface PendingPathwayChange {
  from: "uds";
  to: "bph";
  /** ISO-8601 timestamp. */
  requestedAt: string;
  requestedBy: "participant" | "researcher";
  /** Firebase uid of the initiator. */
  requestedByUid: string;
}

export type ParticipantStatus =
  | "pending_app_signup"
  | "active"
  | "withdrawn";

/**
 * The full, researcher-side participant record. Participants MUST NOT
 * read this — the iOS app reads `users/{firebaseUid}` instead.
 */
export interface Participant {
  /** Firestore document id (autogen). */
  id: string;

  studyId: string;                          // always STUDY_ID
  pathway: Pathway;

  // PHI fields — researcher-only
  firstName: string;
  lastName: string;
  /** ISO-8601 timestamp. Full DOB (not year-only) per study requirement. */
  dob: string;
  phoneNumber: string;
  email: string;
  // Email used at Throne One signup — the key Throne's API returns on each
  // session. Defaults to `email` but may differ when the participant signed
  // up to Throne with a different address (e.g. Apple Hide-My-Email). When
  // it differs, a researcher sets it via setParticipantThroneEmail; the
  // contact email (`email`) still drives Streamsync auth and claim flow.
  throneAccountEmail: string;

  throneUserId: string | null;              // null until Throne OAuth/link

  upcomingVisit: UpcomingVisit | null;
  pendingPathwayChange: PendingPathwayChange | null;

  firebaseUid: string | null;               // null until claimed by app
  status: ParticipantStatus;

  // Audit
  enrolledAt: string;                       // ISO-8601
  createdAt: string;                        // ISO-8601
  updatedAt: string;                        // ISO-8601
  enrolledBy: string;                       // researcher uid
  claimedAt?: string | null;                // set when firebaseUid attaches
}

/**
 * Non-PHI mirror written to `users/{firebaseUid}` on every patients
 * write. This is what the iOS app reads. Contains no name/DOB/phone.
 */
export interface UserMirror {
  studyId: string;
  pathway: Pathway;
  upcomingVisit: UpcomingVisit | null;
  throneAccountEmail: string;
  throneAccountLinked: boolean;
  currentPhase?: string;                    // app-managed
  updatedAt: string;
}

/**
 * Input to the `createParticipant` callable. All PHI fields required.
 */
export interface CreateParticipantInput {
  email: string;
  firstName: string;
  lastName: string;
  dob: string;                              // ISO-8601, must be plausible adult
  phoneNumber: string;
  pathway: Pathway;
  upcomingVisitDate: string;                // ISO-8601
  upcomingVisitNotes?: string;
  /** Must be true — UI checkbox confirming email matches Throne account. */
  confirmedThroneEmailMatch: true;
  /**
   * Optional. The email the participant used at Throne One signup, when it
   * differs from their contact email (e.g. Apple Hide-My-Email). When
   * omitted, the server uses `email` as the Throne account email.
   */
  throneAccountEmail?: string;
}

export interface CreateParticipantResult {
  participantId: string;
}

/**
 * Input to the `setParticipantThroneEmail` callable — researcher-only path
 * to correct an already-enrolled participant's Throne account email when
 * the contact email doesn't match Throne (typically because they signed
 * up via Apple Hide-My-Email).
 */
export interface SetParticipantThroneEmailInput {
  participantId: string;
  throneAccountEmail: string;
}

export interface SetParticipantThroneEmailResult {
  participantId: string;
  firebaseUid: string | null;
  throneAccountEmail: string;
  previousThroneAccountEmail: string | null;
}

export interface ClaimParticipantResult {
  claimed: boolean;
  participantId?: string;
  /** Populated when claim was refused — e.g. email mismatch. */
  reason?: string;
}

export interface PathwayChangeRequestInput {
  participantId: string;
  to: "bph";
}

/**
 * Sacred Throne-email invariant — tests and runtime guards call this to
 * verify that two putatively-equal emails really are equal after
 * normalization. If this returns false, there's a drift between the
 * Streamsync auth email and the Throne account email, which breaks the
 * uroflow data linkage.
 *
 * Normalization: trim + lowercase. This matches the server-side
 * normalization in functions/src/participant.ts.
 */
export function throneEmailsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Claim-path guard. Returns whether a sign-in user may claim a pending
 * participant record. The check is trivial — emails must match after
 * normalization — but we centralize it here so every claim site uses
 * the same rule.
 */
export function isClaimAuthorized(
  authEmail: string | null | undefined,
  patientEmail: string | null | undefined,
): boolean {
  return throneEmailsMatch(authEmail, patientEmail);
}
