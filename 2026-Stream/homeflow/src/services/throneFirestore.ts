/**
 * Firestore read/write service for Throne uroflow data.
 *
 * All Throne paths are scoped under users/{uid}:
 *   throne_sessions/{sessionId}
 *   throne_metrics/{metricId}
 *
 * Surgery date is stored at:
 *   users/{uid}/surgery_date/current  →  { surgeryDate: "YYYY-MM-DD" }
 */

import {
  collection,
  query,
  where,
  getDocs,
  QueryConstraint,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {db} from "./firebase";

export interface ThroneSession {
  id: string;
  studyId: string;
  tags: string[];
  created: string;
  updated: string;
  startTs: string;
  endTs: string;
  deviceId: string;
  userId: string;
  userEmail?: string | null;
  status: string;
  metricCount: number;
}

export interface ThroneMetric {
  id: string;
  studyId: string;
  sessionId: string;
  ts: string;
  created: string;
  updated: string;
  deleted: string | null;
  type: string;
  value: number | string;
  series: string;
  durationMicros: number;
}

function normalizeEmailLikeValue(value: string): string {
  return value.trim().toLowerCase();
}

export function looksLikeEmailIdentifier(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

/**
 * Fetch sessions for a user from Firestore.
 * Only returns sessions with at least one metric (metricCount > 0).
 * Date range filtering is applied client-side after the query.
 */
export async function fetchSessions(uid: string, opts?: {
  startDate?: Date;
  endDate?: Date;
}): Promise<ThroneSession[]> {
  const constraints: QueryConstraint[] = [
    where("metricCount", ">", 0),
  ];

  const q = query(collection(db, `users/${uid}/throne_sessions`), ...constraints);
  const snap = await getDocs(q);
  let sessions = snap.docs.map((d) => d.data() as ThroneSession);

  if (opts?.startDate || opts?.endDate) {
    const startMs = opts.startDate?.getTime() ?? 0;
    const endMs = opts.endDate?.getTime() ?? Infinity;
    sessions = sessions.filter((s) => {
      const ts = new Date(s.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }

  sessions.sort((a, b) => new Date(b.startTs).getTime() - new Date(a.startTs).getTime());
  return sessions;
}

/**
 * Batch-fetch metrics for multiple sessions.
 * Firestore "in" supports up to 30 values — large arrays are split into
 * parallel batches automatically.
 */
export async function fetchMetricsBatch(uid: string, sessionIds: string[]): Promise<ThroneMetric[]> {
  if (sessionIds.length === 0) return [];

  const BATCH_SIZE = 30;
  const batches: string[][] = [];
  for (let i = 0; i < sessionIds.length; i += BATCH_SIZE) {
    batches.push(sessionIds.slice(i, i + BATCH_SIZE));
  }

  const snapshots = await Promise.all(
    batches.map((batch) =>
      getDocs(query(
        collection(db, `users/${uid}/throne_metrics`),
        where("sessionId", "in", batch),
      )),
    ),
  );

  return snapshots.flatMap((snap) => snap.docs.map((d) => d.data() as ThroneMetric));
}

/**
 * Fetch all metrics for a single session, sorted ascending by timestamp.
 */
export async function fetchMetricsForSession(uid: string, sessionId: string): Promise<ThroneMetric[]> {
  const q = query(
    collection(db, `users/${uid}/throne_metrics`),
    where("sessionId", "==", sessionId),
  );
  const snap = await getDocs(q);
  const metrics = snap.docs.map((d) => d.data() as ThroneMetric);
  metrics.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  return metrics;
}

// ─── Surgery Date ─────────────────────────────────────────────────────────────

/**
 * Read surgery date from users/{uid}/surgery_date/current.
 * Returns an ISO date string (YYYY-MM-DD) or null if not set.
 */
export async function fetchSurgeryDate(uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, `users/${uid}/surgery_date/current`));
    if (snap.exists()) {
      const sd = snap.data()?.surgeryDate;
      if (typeof sd === "string" && sd) return sd.slice(0, 10);
      if (sd?.toDate) return (sd.toDate() as Date).toISOString().slice(0, 10);
    }
  } catch {
    // Document may not exist — return null
  }
  return null;
}

/**
 * Read urodynamics date from users/{uid}/urodynamics_date/current.
 * Returns an ISO date string (YYYY-MM-DD) or null if not set.
 */
export async function fetchUrodynamicsDate(uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, `users/${uid}/urodynamics_date/current`));
    if (snap.exists()) {
      const uds = snap.data()?.urodynamicsDate;
      if (typeof uds === 'string' && uds) return uds.slice(0, 10);
      if (uds?.toDate) return (uds.toDate() as Date).toISOString().slice(0, 10);
    }
  } catch {
    // Document may not exist — return null
  }
  return null;
}

/**
 * Persist the Throne User ID to the root users/{uid} document.
 *
 * The syncThroneUserMap Cloud Function trigger watches users/{uid} and
 * automatically creates the throneUserMap/{throneUserId} → { firebaseUid }
 * reverse-lookup entry, so the ingestion function can route sessions to
 * the correct user without any manual CRC steps.
 */
export async function saveThroneUserId(uid: string, throneUserId: string): Promise<void> {
  const normalizedId = String(throneUserId || '').trim();
  if (!normalizedId) {
    throw new Error('Throne User ID is required.');
  }
  if (looksLikeEmailIdentifier(normalizedId)) {
    await saveThroneAccountEmail(uid, normalizedId);
    throw new Error('Refusing to store an email-shaped value as throneUserId. Save throneAccountEmail instead.');
  }
  await setDoc(
    doc(db, `users/${uid}`),
    { throneUserId: normalizedId, throneUserIdSetAt: new Date().toISOString() },
    { merge: true },
  );
}

/**
 * Persist the participant's Throne account email separately from throneUserId.
 */
export async function saveThroneAccountEmail(uid: string, email: string): Promise<void> {
  const normalizedEmail = normalizeEmailLikeValue(email);
  await setDoc(
    doc(db, `users/${uid}`),
    { throneAccountEmail: normalizedEmail, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

// ─── Throne Research Participant Registry ────────────────────────────────────

export interface ThroneResearchParticipant {
  email: string;
  throneAccountEmail?: string;
  firebaseUid: string;
  enrolledAt: string;           // ISO timestamp
  throneAccountCreated: boolean;
  lastSyncAt: string | null;    // ISO timestamp
}

/**
 * Register a participant in the throne_research_participants collection.
 * Keyed by email so the Throne data access roster can be exported by email.
 * Called during account creation to add the participant to the registry.
 */
export async function registerThroneResearchParticipant(
  email: string,
  firebaseUid: string,
): Promise<void> {
  const normalizedEmail = normalizeEmailLikeValue(email);
  await setDoc(
    doc(db, `throne_research_participants/${normalizedEmail}`),
    {
      email: normalizedEmail,
      throneAccountEmail: normalizedEmail,
      firebaseUid,
      enrolledAt: new Date().toISOString(),
      throneAccountCreated: false,
      lastSyncAt: null,
    },
    { merge: true },
  );
}

/**
 * Mark that the participant's Throne account has been linked (data is flowing).
 */
export async function markThroneAccountLinked(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  await setDoc(
    doc(db, `throne_research_participants/${normalizedEmail}`),
    { throneAccountCreated: true },
    { merge: true },
  );
}

export interface UserProfileDocument {
  name?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  throneAccountEmail?: string;
  phoneNumber?: string;
  onboardingComplete?: boolean;
  onboardingCompletedAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

/**
 * Cross-device onboarding-complete signal. Writes both the boolean flag
 * and the completion timestamp to the root user doc so other devices
 * (or fresh app installs) can detect that this user has already
 * finished onboarding without having to re-run the flow.
 */
export async function markOnboardingCompleteInFirestore(uid: string): Promise<void> {
  const now = new Date().toISOString();
  await setDoc(
    doc(db, `users/${uid}`),
    { onboardingComplete: true, onboardingCompletedAt: now, updatedAt: now },
    { merge: true },
  );
}

/**
 * Returns true if Firestore has strong evidence this user has completed
 * onboarding on a previous device/build. Checked in priority order:
 *   1. Explicit `onboardingComplete === true` on users/{uid} (new signal).
 *   2. Presence of all three main onboarding artifacts — consent_response,
 *      ipss_scores/baseline, and medical_history/current — which together
 *      indicate the user got through every major step.
 * Either signal is sufficient.
 */
export async function isOnboardingCompleteInFirestore(uid: string): Promise<boolean> {
  try {
    // Signal 1: explicit flag.
    const userSnap = await getDoc(doc(db, `users/${uid}`));
    if (userSnap.exists() && userSnap.data()?.onboardingComplete === true) {
      return true;
    }

    // Signal 2: all three main onboarding artifacts present.
    const [consentSnap, ipssSnap, mhSnap] = await Promise.all([
      getDoc(doc(db, `users/${uid}/consent_response/current`)),
      getDoc(doc(db, `users/${uid}/ipss_scores/baseline`)),
      getDoc(doc(db, `users/${uid}/medical_history/current`)),
    ]);
    return consentSnap.exists() && ipssSnap.exists() && mhSnap.exists();
  } catch (err) {
    console.warn('[Onboarding] Firestore check failed:', err);
    return false;
  }
}

export interface StudyTimelineDocument {
  studyPathway?: 'surgery' | 'uds' | null;
  anchorDateType?: 'surgery' | 'uds' | null;
  surgeryDate?: string | null;
  urodynamicsDate?: string | null;
  updatedAt?: string;
}

/**
 * Persist app-collected profile fields to the root users/{uid} document.
 */
export async function saveUserProfile(uid: string, profile: UserProfileDocument): Promise<void> {
  const payload = Object.fromEntries(
    Object.entries({
      ...profile,
      updatedAt: profile.updatedAt ?? new Date().toISOString(),
    }).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(payload).length === 0) {
    return;
  }

  await setDoc(
    doc(db, `users/${uid}`),
    payload,
    { merge: true },
  );
}

/**
 * Persist study pathway metadata to users/{uid}/study_timeline/current.
 */
export async function saveStudyTimeline(uid: string, timeline: StudyTimelineDocument): Promise<void> {
  const payload = Object.fromEntries(
    Object.entries({
      ...timeline,
      updatedAt: timeline.updatedAt ?? new Date().toISOString(),
    }).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(payload).length === 0) {
    return;
  }

  await setDoc(
    doc(db, `users/${uid}/study_timeline/current`),
    payload,
    { merge: true },
  );
}

/**
 * Persist surgery date to users/{uid}/surgery_date/current.
 */
export async function saveSurgeryDate(uid: string, dateStr: string): Promise<void> {
  await setDoc(
    doc(db, `users/${uid}/surgery_date/current`),
    { surgeryDate: dateStr, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

/**
 * Persist urodynamics date to users/{uid}/urodynamics_date/current.
 */
export async function saveUrodynamicsDate(uid: string, dateStr: string): Promise<void> {
  await setDoc(
    doc(db, `users/${uid}/urodynamics_date/current`),
    { urodynamicsDate: dateStr, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

// ─── Medical History ──────────────────────────────────────────────────────────

export interface MedHistoryMedication {
  name: string;
  brandName?: string;
  groupKey: string;          // alphaBlockers | fiveARIs | anticholinergics | beta3Agonists | otherBPH | otherMedications
}

export interface MedHistoryProcedure {
  name: string;
  commonName?: string;
  date?: string;  // year only (YYYY) — HIPAA Safe Harbor identifier #3
  isBPH: boolean;
}

export interface MedHistoryCondition {
  name: string;
}

export interface MedHistoryLabValue {
  value: number;
  unit: string;
  date: string;  // year only (YYYY) — HIPAA Safe Harbor identifier #3
  referenceRange?: string;
}

export interface MedHistoryDocument {
  // User-entered demographics (HIPAA Safe Harbor de-identified)
  demographics: {
    // name omitted — HIPAA identifier #1
    ethnicity: string;
    race: string;
    // From HealthKit prefill (not user-entered)
    age: number | '90+' | null;  // ages ≥89 stored as '90+' per HIPAA Safe Harbor
    biologicalSex: string | null;
    dateOfBirth: string | null;  // always null — not exposed by HealthKit demographics API
  };
  // User-confirmed (possibly edited) from prefill
  medications: MedHistoryMedication[];
  surgicalHistory: MedHistoryProcedure[];
  conditions: MedHistoryCondition[];
  // From FHIR prefill only — not collected in user form
  labs: {
    psa: MedHistoryLabValue | null;
    hba1c: MedHistoryLabValue | null;
    urinalysis: MedHistoryLabValue | null;
  };
  clinicalMeasurements: {
    pvr: MedHistoryLabValue | null;
    uroflowQmax: MedHistoryLabValue | null;
    volumeVoided: MedHistoryLabValue | null;
    mobility: string | null;
  };
  savedAt: unknown;           // serverTimestamp()
}

/**
 * Write combined medical history (user form + FHIR prefill remainder)
 * to users/{uid}/medical_history/current.
 * Overwrites on every call — always reflects latest confirmed data.
 */
export async function saveMedicalHistory(
  uid: string,
  data: Omit<MedHistoryDocument, 'savedAt'>,
): Promise<void> {
  await setDoc(
    doc(db, `users/${uid}/medical_history/current`),
    { ...data, savedAt: serverTimestamp() },
    { merge: false },
  );
}

export interface ConfirmedDemographicsPrefillInput {
  fullName: string;
  age: number | null;
  biologicalSex: string | null;
  ethnicity: string;
  race: string;
}

/**
 * Merge user-confirmed demographics into medical_history_prefill/latest so the
 * dashboard and downstream workflows can access the same confirmed values.
 */
export async function saveConfirmedDemographicsPrefill(
  uid: string,
  demographics: ConfirmedDemographicsPrefillInput,
): Promise<void> {
  const source = {
    type: 'user_input',
    displayName: 'Confirmed in mobile app',
    matchMethod: 'direct_api' as const,
  };

  const entry = <T>(value: T | null) => {
    const hasValue = typeof value === 'string'
      ? value.trim().length > 0
      : value != null;

    return {
      value: hasValue ? value : null,
      confidence: hasValue ? 'high' : 'none',
      sources: hasValue ? [source] : [],
    };
  };

  await setDoc(
    doc(db, `users/${uid}/medical_history_prefill/latest`),
    {
      demographics: {
        fullName: entry(demographics.fullName || null),
        age: entry(demographics.age),
        biologicalSex: entry(demographics.biologicalSex),
        ethnicity: entry(demographics.ethnicity || null),
        race: entry(demographics.race || null),
      },
      confirmedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
