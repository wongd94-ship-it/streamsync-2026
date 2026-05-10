/**
 * useHealthKitAuthMatrix
 *
 * Per-type HealthKit authorization + data-access probe for the Data
 * Permissions screen.
 *
 * Why probe as well as query authorizationStatusFor?
 *   iOS does NOT expose read-permission denials (Apple privacy rule).
 *   authorizationStatusFor always returns `sharingAuthorized` for read
 *   scopes — even when the user explicitly denied read access in Settings.
 *   The only reliable signal is to run a small query: a 7-day window with
 *   limit=1 costs nothing and tells us whether data is actually flowing.
 *   Authorized + 0 samples is ambiguous (could be denied read OR simply no
 *   data recorded). The UI renders both signals so researchers can diagnose.
 */
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import {
  authorizationStatusFor,
  queryQuantitySamples,
  queryCategorySamples,
} from '@kingstinct/react-native-healthkit';

export type HKAuthRowKind = 'quantity' | 'category';

export interface HKAuthRowSpec {
  /** Stable key used as React list key and Firestore path fragment. */
  key: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** HKKit string identifier. */
  identifier: string;
  /** Which query shape this type uses. */
  kind: HKAuthRowKind;
  /** Unit string for quantity types (ignored for category types). */
  unit?: string;
}

export interface HKAuthRowState extends HKAuthRowSpec {
  /** authorizationStatusFor result; unreliable for reads but logged for completeness. */
  authStatus: string;
  /** Whether the probe query returned samples. null = probe not yet run. */
  probeSamples: number | null;
  /** Probe error message, if any. */
  probeError?: string;
  /** Timestamp of the last probe run (ms epoch). */
  lastCheckedAt?: number;
  /** Derived: UI summary ("granted" / "no-data" / "denied" / "unknown"). */
  uiStatus: 'authorized-with-data' | 'authorized-no-data' | 'denied' | 'not-determined' | 'unknown';
}

/**
 * The set of HealthKit types the app reads, in display order. Mirrors
 * HealthKitClient.ALL_READ_TYPES; keep in sync when adding/removing types.
 */
export const HK_AUTH_ROWS: HKAuthRowSpec[] = [
  { key: 'stepCount', label: 'Step Count', identifier: 'HKQuantityTypeIdentifierStepCount', kind: 'quantity', unit: 'count' },
  { key: 'activeEnergy', label: 'Active Energy', identifier: 'HKQuantityTypeIdentifierActiveEnergyBurned', kind: 'quantity', unit: 'kcal' },
  { key: 'exerciseTime', label: 'Exercise Time', identifier: 'HKQuantityTypeIdentifierAppleExerciseTime', kind: 'quantity', unit: 'min' },
  { key: 'moveTime', label: 'Move Time', identifier: 'HKQuantityTypeIdentifierAppleMoveTime', kind: 'quantity', unit: 'min' },
  { key: 'standTime', label: 'Stand Time', identifier: 'HKQuantityTypeIdentifierAppleStandTime', kind: 'quantity', unit: 'min' },
  { key: 'distance', label: 'Walking + Running Distance', identifier: 'HKQuantityTypeIdentifierDistanceWalkingRunning', kind: 'quantity', unit: 'm' },
  { key: 'sleepAnalysis', label: 'Sleep', identifier: 'HKCategoryTypeIdentifierSleepAnalysis', kind: 'category' },
  { key: 'heartRate', label: 'Heart Rate', identifier: 'HKQuantityTypeIdentifierHeartRate', kind: 'quantity', unit: 'count/min' },
  { key: 'restingHeartRate', label: 'Resting Heart Rate', identifier: 'HKQuantityTypeIdentifierRestingHeartRate', kind: 'quantity', unit: 'count/min' },
  { key: 'hrv', label: 'Heart Rate Variability', identifier: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', kind: 'quantity', unit: 'ms' },
  { key: 'respiratoryRate', label: 'Respiratory Rate', identifier: 'HKQuantityTypeIdentifierRespiratoryRate', kind: 'quantity', unit: 'count/min' },
  { key: 'oxygenSaturation', label: 'Blood Oxygen', identifier: 'HKQuantityTypeIdentifierOxygenSaturation', kind: 'quantity', unit: '%' },
  { key: 'vo2Max', label: 'VO₂ Max', identifier: 'HKQuantityTypeIdentifierVO2Max', kind: 'quantity', unit: 'ml/(kg*min)' },
];

const PROBE_LOOKBACK_DAYS = 7;

function deriveUiStatus(
  authStatus: string,
  probeSamples: number | null,
): HKAuthRowState['uiStatus'] {
  if (probeSamples !== null && probeSamples > 0) return 'authorized-with-data';
  if (authStatus.toLowerCase().includes('sharingdenied')) return 'denied';
  if (authStatus.toLowerCase().includes('notdetermined')) return 'not-determined';
  if (probeSamples === 0) return 'authorized-no-data';
  return 'unknown';
}

async function probeOne(spec: HKAuthRowSpec): Promise<HKAuthRowState> {
  const now = Date.now();
  const startDate = new Date(now - PROBE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const endDate = new Date(now);

  let authStatus = 'unknown';
  try {
    authStatus = String(authorizationStatusFor(spec.identifier as any));
  } catch {
    // Unavailable for some types in simulator — leave as 'unknown'.
  }

  let probeSamples: number | null = null;
  let probeError: string | undefined;

  try {
    if (spec.kind === 'quantity') {
      const samples = await queryQuantitySamples(spec.identifier as any, {
        limit: 1,
        unit: spec.unit ?? 'count',
        filter: { date: { startDate, endDate } },
      });
      probeSamples = samples.length;
    } else {
      const samples = await queryCategorySamples(spec.identifier as any, {
        limit: 1,
        filter: { date: { startDate, endDate } },
      });
      probeSamples = samples?.length ?? 0;
    }
  } catch (err) {
    probeError = err instanceof Error ? err.message : String(err);
  }

  return {
    ...spec,
    authStatus,
    probeSamples,
    probeError,
    lastCheckedAt: now,
    uiStatus: deriveUiStatus(authStatus, probeSamples),
  };
}

export interface UseHealthKitAuthMatrixResult {
  rows: HKAuthRowState[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useHealthKitAuthMatrix(): UseHealthKitAuthMatrixResult {
  const [rows, setRows] = useState<HKAuthRowState[]>(
    HK_AUTH_ROWS.map((spec) => ({
      ...spec,
      authStatus: 'unknown',
      probeSamples: null,
      uiStatus: 'unknown' as const,
    })),
  );
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    // Sequential to avoid hammering HealthKit; each probe is a 1-sample,
    // 7-day query so total ≈ 13 * ~50ms = well under a second on a warm
    // device.
    const next: HKAuthRowState[] = [];
    for (const spec of HK_AUTH_ROWS) {
      // eslint-disable-next-line no-await-in-loop
      const row = await probeOne(spec);
      next.push(row);
    }
    setRows(next);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, isLoading, refresh };
}
