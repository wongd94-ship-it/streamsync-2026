/**
 * Medical History Edit Service
 *
 * Read + write helpers for /users/{uid}/medical_history/current. The
 * onboarding screen seeds this doc; this module powers post-onboarding
 * edits made from the Health tab. We keep the full MedHistoryDocument
 * shape intact across edits so the research-team data pipeline (which
 * reads the same doc) doesn't drift.
 *
 * Audit fields:
 *   - lastEditedAt: serverTimestamp on every save
 *   - lastEditedBy: 'user' for participant edits via the iOS app
 *     (vs. 'fhir_sync' for automated EHR refreshes — not used yet)
 *
 * BPH classification helpers:
 *   - Medications: already classified at prefill time (groupKey field).
 *   - Procedures: already classified at prefill time (isBPH boolean).
 *   - Conditions: the saved MedHistoryCondition has only a `name`, so we
 *     classify on demand here using the same text patterns as the
 *     onboarding fhir/condition-mapper.
 */

import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '@/src/services/firestore';
import { CONDITION_TEXT_PATTERNS } from '@/lib/services/fhir/codes';
import type {
  MedHistoryCondition,
  MedHistoryDocument,
  MedHistoryMedication,
  MedHistoryProcedure,
} from '@/src/services/throneFirestore';

// ── BPH classification ─────────────────────────────────────────────

/**
 * Reuses the same BPH condition pattern list the onboarding prefill uses,
 * so the Health tab and onboarding agree on what "BPH-related" means.
 * Defined in lib/services/fhir/codes.ts; expand THERE if a new condition
 * needs to surface in this card.
 */
export function isBphCondition(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return CONDITION_TEXT_PATTERNS.bph.some((p) => lower.includes(p));
}

/**
 * Medication groupKey indicates a class of BPH-relevant medication.
 * `otherMedications` is the catch-all for non-BPH meds; everything
 * else is BPH-relevant by design (set during prefill classification).
 */
export function isBphMedication(med: MedHistoryMedication): boolean {
  return med.groupKey !== 'otherMedications';
}

// ── Read ───────────────────────────────────────────────────────────

export interface MedicalHistorySnapshot {
  exists: boolean;
  data: MedHistoryDocument | null;
}

/**
 * Live subscription to the participant's medical_history/current doc.
 * Calls `onUpdate` once on attach and again whenever the doc changes
 * (e.g. after `saveMedications` / `saveProcedures` / `saveConditions`).
 */
export function subscribeToMedicalHistory(
  uid: string,
  onUpdate: (snap: MedicalHistorySnapshot) => void,
  onError?: (err: Error) => void,
): () => void {
  const ref = doc(db, `users/${uid}/medical_history/current`);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onUpdate({ exists: false, data: null });
        return;
      }
      onUpdate({ exists: true, data: snap.data() as MedHistoryDocument });
    },
    (err) => {
      console.warn('[medHistoryEdit] subscribe error', err);
      onError?.(err);
    },
  );
}

// ── Write ──────────────────────────────────────────────────────────

interface AuditFields {
  lastEditedAt: ReturnType<typeof serverTimestamp>;
  lastEditedBy: 'user';
}

function audit(): AuditFields {
  return {
    lastEditedAt: serverTimestamp(),
    lastEditedBy: 'user',
  };
}

/**
 * Save just the medications array. The other fields (conditions,
 * procedures, demographics, labs, etc.) are preserved because we use
 * `merge: true` and only send `medications` + audit fields.
 *
 * Firestore arrays merge by full replacement (not element-by-element),
 * which is what we want here — caller passes the FULL post-edit array.
 */
export async function saveMedications(
  uid: string,
  medications: MedHistoryMedication[],
): Promise<void> {
  await setDoc(
    doc(db, `users/${uid}/medical_history/current`),
    { medications, ...audit() },
    { merge: true },
  );
}

export async function saveProcedures(
  uid: string,
  surgicalHistory: MedHistoryProcedure[],
): Promise<void> {
  await setDoc(
    doc(db, `users/${uid}/medical_history/current`),
    { surgicalHistory, ...audit() },
    { merge: true },
  );
}

export async function saveConditions(
  uid: string,
  conditions: MedHistoryCondition[],
): Promise<void> {
  await setDoc(
    doc(db, `users/${uid}/medical_history/current`),
    { conditions, ...audit() },
    { merge: true },
  );
}

/**
 * Read once (no listener). Used by the edit-card to seed local state
 * before we attach the live snapshot listener — avoids a flash of empty
 * state on first render.
 */
export async function readMedicalHistoryOnce(
  uid: string,
): Promise<MedHistoryDocument | null> {
  const snap = await getDoc(doc(db, `users/${uid}/medical_history/current`));
  return snap.exists() ? (snap.data() as MedHistoryDocument) : null;
}

// ── Display helpers ─────────────────────────────────────────────────

const MED_GROUP_LABELS: Record<string, string> = {
  alphaBlockers: 'Alpha-blocker',
  fiveARIs: '5-alpha reductase inhibitor',
  anticholinergics: 'Anticholinergic',
  beta3Agonists: 'Beta-3 agonist',
  otherBPH: 'Other BPH medication',
  otherMedications: 'Other medication',
};

export function medGroupLabel(groupKey: string): string {
  return MED_GROUP_LABELS[groupKey] ?? groupKey;
}

export const BPH_MED_GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: 'alphaBlockers', label: 'Alpha-blocker' },
  { value: 'fiveARIs', label: '5-alpha reductase inhibitor' },
  { value: 'anticholinergics', label: 'Anticholinergic' },
  { value: 'beta3Agonists', label: 'Beta-3 agonist' },
  { value: 'otherBPH', label: 'Other BPH medication' },
];
