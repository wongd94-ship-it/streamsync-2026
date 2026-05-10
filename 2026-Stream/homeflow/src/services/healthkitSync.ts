/**
 * HealthKit → Firestore incremental sync pipeline.
 */

import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import {
  doc,
  getDoc,
  setDoc,
  writeBatch,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import {
  queryQuantitySamples,
  queryCategorySamples,
  authorizationStatusFor,
} from "@kingstinct/react-native-healthkit";
import type { QuantitySample } from "@kingstinct/react-native-healthkit";
import { mapCategorySampleToSleepSample, getSleepNightDate } from "@/lib/services/healthkit/mappers";

import { db, getAuth } from "./firestore";
import { syncClinicalNotes } from "./clinicalNotesSync";
import { syncFhirPrefill } from "./fhirPrefillSync";
import { logHKEvent } from "./healthkitLogger";

const METRIC_CONFIG = {
  heartRate: {
    identifier: "HKQuantityTypeIdentifierHeartRate" as const,
    unit: "count/min",
  },
  stepCount: {
    identifier: "HKQuantityTypeIdentifierStepCount" as const,
    unit: "count",
  },
  heartRateVariabilitySDNN: {
    identifier: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN" as const,
    unit: "ms",
  },
  respiratoryRate: {
    identifier: "HKQuantityTypeIdentifierRespiratoryRate" as const,
    unit: "count/min",
  },
  walkingHeartRateAverage: {
    identifier: "HKQuantityTypeIdentifierWalkingHeartRateAverage" as const,
    unit: "count/min",
  },
  walkingSpeed: {
    identifier: "HKQuantityTypeIdentifierWalkingSpeed" as const,
    unit: "m/s",
  },
  walkingStepLength: {
    identifier: "HKQuantityTypeIdentifierWalkingStepLength" as const,
    unit: "cm",
  },
  appleWalkingSteadiness: {
    identifier: "HKQuantityTypeIdentifierAppleWalkingSteadiness" as const,
    unit: "%",
  },
  sixMinuteWalkTestDistance: {
    identifier: "HKQuantityTypeIdentifierSixMinuteWalkTestDistance" as const,
    unit: "m",
  },
  uvExposure: {
    identifier: "HKQuantityTypeIdentifierUVExposure" as const,
    unit: "count",
  },
  oxygenSaturation: {
    identifier: "HKQuantityTypeIdentifierOxygenSaturation" as const,
    unit: "%",
  },
  vo2Max: {
    identifier: "HKQuantityTypeIdentifierVO2Max" as const,
    // HKUnit parses left-to-right, so "ml/kg*min" = (ml/kg)*min.
    // Apple's canonical VO2Max unit is ml/(kg*min).
    unit: "ml/(kg*min)",
  },
  appleStandTime: {
    identifier: "HKQuantityTypeIdentifierAppleStandTime" as const,
    unit: "min",
  },
  appleMoveTime: {
    identifier: "HKQuantityTypeIdentifierAppleMoveTime" as const,
    unit: "min",
  },
  activeEnergyBurned: {
    identifier: "HKQuantityTypeIdentifierActiveEnergyBurned" as const,
    unit: "kcal",
  },
  distanceWalkingRunning: {
    identifier: "HKQuantityTypeIdentifierDistanceWalkingRunning" as const,
    unit: "m",
  },
  timeInDaylight: {
    identifier: "HKQuantityTypeIdentifierTimeInDaylight" as const,
    unit: "min",
  },
} as const;

export type MetricType = keyof typeof METRIC_CONFIG;

interface SyncState {
  lastSyncedAt: Timestamp | null;
  lastRunAt: Timestamp;
  lastStatus: "ok" | "error";
  lastError?: string;
}

interface FirestoreSampleData {
  value: number;
  unit: string;
  startDate: Timestamp;
  endDate: Timestamp;
  sourceName?: string;
  deviceName?: string;
  metadata?: Record<string, unknown>;
  createdAt: FieldValue;
  updatedAt: FieldValue;
}

export interface SyncMetricResult {
  ok: boolean;
  written: number;
  skipped: number;
  error?: string;
}

export interface SyncAllResult {
  ok: boolean;
  results: Record<MetricType, SyncMetricResult>;
}

export interface SyncSleepResult {
  ok: boolean;
  written: number;
  error?: string;
}

const OVERLAP_WINDOW_MS = 5 * 60 * 1_000;
const DEFAULT_LOOKBACK_DAYS = 90;
const BATCH_SIZE = 400;

/**
 * HealthKit throws for reads on types the user hasn't authorized. When that
 * happens during a backfill we want to skip the metric quietly (per-sample
 * "authorization not determined" is the same signal as "no data shared") —
 * not bubble it up as a hard failure.
 */
function isHealthKitAuthError(err: unknown): boolean {
  const message =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : "";
  return /authoriz|HKError ?Code\s*(4|5)|permission|not.*determined|not.*allowed/i.test(message);
}

async function buildSampleId(
  metricType: MetricType,
  sample: QuantitySample,
): Promise<string> {
  if (sample.uuid) return sample.uuid;

  const toDate = (d: unknown): Date =>
    d instanceof Date ? d : new Date(String(d));

  const startISO = toDate(sample.startDate).toISOString();
  const endISO = toDate(sample.endDate).toISOString();
  const sourceName = sample.sourceRevision?.source?.name ?? "";
  const unit = METRIC_CONFIG[metricType].unit;
  const input = [metricType, startISO, endISO, String(sample.quantity), unit, sourceName].join("|");

  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA1,
    input,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
}

function toFirestoreSample(
  metricType: MetricType,
  sample: QuantitySample,
): Omit<FirestoreSampleData, "createdAt" | "updatedAt"> {
  const toDate = (d: unknown): Date =>
    d instanceof Date ? d : new Date(String(d));

  const result: Omit<FirestoreSampleData, "createdAt" | "updatedAt"> = {
    value: sample.quantity,
    unit: METRIC_CONFIG[metricType].unit,
    startDate: Timestamp.fromDate(toDate(sample.startDate)),
    endDate: Timestamp.fromDate(toDate(sample.endDate)),
  };

  const sourceName = sample.sourceRevision?.source?.name;
  if (sourceName) result.sourceName = sourceName;

  const deviceName = sample.device?.name;
  if (deviceName) result.deviceName = deviceName;

  if (sample.metadata && Object.keys(sample.metadata).length > 0) {
    result.metadata = sample.metadata as Record<string, unknown>;
  }

  return result;
}

async function fetchHealthKitSamples(
  metricType: MetricType,
  sinceDate: Date,
): Promise<readonly QuantitySample[]> {
  if (Platform.OS !== "ios") return [];

  const config = METRIC_CONFIG[metricType];
  const startDate = new Date(sinceDate.getTime() - OVERLAP_WINDOW_MS);
  const endDate = new Date();

  return queryQuantitySamples(config.identifier as any, {
    limit: 0,
    unit: config.unit,
    filter: { date: { startDate, endDate } },
  });
}

async function writeSamplesBatch(
  uid: string,
  metricType: MetricType,
  entries: { id: string; data: FirestoreSampleData }[],
): Promise<void> {
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    const collectionPath = `users/${uid}/hk_${metricType}`;

    for (const { id, data } of chunk) {
      batch.set(doc(db, `${collectionPath}/${id}`), data);
    }

    await batch.commit();
  }
}

export async function getLastSync(
  uid: string,
  metricType: string,
): Promise<Date | null> {
  const ref = doc(db, `users/${uid}/hk_sync/${metricType}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const state = snap.data() as Partial<SyncState>;
  return state.lastSyncedAt?.toDate() ?? null;
}

export async function setSyncState(
  uid: string,
  metricType: string,
  patch: {
    lastSyncedAt?: Timestamp;
    lastStatus: "ok" | "error";
    lastError?: string;
  },
): Promise<void> {
  const ref = doc(db, `users/${uid}/hk_sync/${metricType}`);
  await setDoc(
    ref,
    { ...patch, lastRunAt: serverTimestamp() },
    { merge: true },
  );
}

export async function syncMetric(
  metricType: MetricType,
  options?: { dryRun?: boolean },
): Promise<SyncMetricResult> {
  const uid = getAuth().currentUser?.uid;
  if (!uid) {
    return { ok: false, written: 0, skipped: 0, error: "no-auth: user is not signed in" };
  }

  try {
    const lastSync = await getLastSync(uid, metricType);
    const sinceDate =
      lastSync ??
      new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);

    const hkSamples = await fetchHealthKitSamples(metricType, sinceDate);
    if (hkSamples.length === 0) {
      return { ok: true, written: 0, skipped: 0 };
    }

    let maxEndDate = sinceDate;
    const entries = await Promise.all(
      hkSamples.map(async (sample) => {
        const id = await buildSampleId(metricType, sample);
        const data = {
          ...toFirestoreSample(metricType, sample),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        const endDate = sample.endDate instanceof Date
          ? sample.endDate
          : new Date(String(sample.endDate));
        if (endDate > maxEndDate) maxEndDate = endDate;

        return { id, data };
      }),
    );

    if (!options?.dryRun) {
      await writeSamplesBatch(uid, metricType, entries);
      await setSyncState(uid, metricType, {
        lastSyncedAt: Timestamp.fromDate(maxEndDate),
        lastStatus: "ok",
        lastError: "",
      });
    }

    return { ok: true, written: entries.length, skipped: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isHealthKitAuthError(error)) {
      return { ok: true, written: 0, skipped: 0 };
    }
    if (uid) {
      await setSyncState(uid, metricType, {
        lastStatus: "error",
        lastError: message,
      }).catch(() => {});
    }
    return { ok: false, written: 0, skipped: 0, error: message };
  }
}

export async function syncAllHealthKit(): Promise<SyncAllResult> {
  // Sequential, not parallel — HealthKit serializes queries on a single
  // internal thread; launching 17 Promise.all reads floods that queue
  // and keeps the JS bridge busy handling results, which starves the
  // UI thread and causes the tab bar / dashboard to feel unresponsive
  // after a cold start. Serial takes longer in wall clock but keeps
  // the UI thread free for touches.
  const metricTypes = Object.keys(METRIC_CONFIG) as MetricType[];
  const results: Record<string, SyncMetricResult> = {};
  let allOk = true;
  for (const metricType of metricTypes) {
    const r = await syncMetric(metricType);
    results[metricType] = r;
    if (!r.ok) allOk = false;
  }
  return {
    ok: allOk,
    results: results as Record<MetricType, SyncMetricResult>,
  };
}

export async function syncSleep(
  options?: { dryRun?: boolean },
): Promise<SyncSleepResult> {
  const uid = getAuth().currentUser?.uid;
  if (!uid) {
    return { ok: false, written: 0, error: "no-auth: user is not signed in" };
  }

  if (Platform.OS !== "ios") {
    return { ok: true, written: 0 };
  }

  try {
    const lastSync = await getLastSync(uid, "sleep");
    const sinceDate =
      lastSync ??
      new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);
    const startDate = new Date(sinceDate.getTime() - OVERLAP_WINDOW_MS);
    const endDate = new Date();

    const rawSamples = await queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
      limit: 0,
      filter: { date: { startDate, endDate } },
    });

    if (!rawSamples || rawSamples.length === 0) {
      return { ok: true, written: 0 };
    }

    const nightMap = new Map<string, ReturnType<typeof mapCategorySampleToSleepSample>[]>();
    let maxEndDate = sinceDate;

    for (const raw of rawSamples) {
      const sample = mapCategorySampleToSleepSample(raw as any);
      const nightKey = getSleepNightDate(new Date(raw.startDate));
      const bucket = nightMap.get(nightKey) ?? [];
      bucket.push(sample);
      nightMap.set(nightKey, bucket);

      const rawEnd = raw.endDate instanceof Date ? raw.endDate : new Date(String(raw.endDate));
      if (rawEnd > maxEndDate) maxEndDate = rawEnd;
    }

    if (!options?.dryRun) {
      const batch = writeBatch(db);
      for (const [date, samples] of nightMap) {
        batch.set(doc(db, `users/${uid}/hk_sleep/${date}`), {
          date,
          samples,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      await setSyncState(uid, "sleep", {
        lastSyncedAt: Timestamp.fromDate(maxEndDate),
        lastStatus: "ok",
        lastError: "",
      });
    }

    return { ok: true, written: nightMap.size };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isHealthKitAuthError(error)) {
      return { ok: true, written: 0 };
    }
    await setSyncState(uid, "sleep", {
      lastStatus: "error",
      lastError: message,
    }).catch(() => {});
    return { ok: false, written: 0, error: message };
  }
}

export interface BackfillProgress {
  metric: MetricType | "sleep";
  scanned: number;
  written: number;
  skipped: number;
  done: boolean;
  error?: string;
}

export interface BackfillResult {
  ok: boolean;
  totalWritten: number;
  totalSkipped: number;
  perMetric: Record<string, { written: number; skipped: number; error?: string }>;
}

const BACKFILL_DEFAULT_LOOKBACK_DAYS = 365;

async function backfillMetric(
  uid: string,
  metricType: MetricType,
  lookbackDays: number,
  onProgress?: (p: BackfillProgress) => void,
): Promise<{ written: number; skipped: number; error?: string }> {
  if (Platform.OS !== "ios") return { written: 0, skipped: 0 };

  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1_000);
    const config = METRIC_CONFIG[metricType];

    // Best-effort auth probe. iOS reports read-permission denials as
    // `sharingAuthorized` (privacy quirk), so this only reliably catches
    // `notDetermined`. Still useful for log correlation when 0 samples come
    // back — a known-authorized status + 0 samples hints at denied reads.
    let authStatus: string = "unknown";
    try {
      authStatus = String(authorizationStatusFor(config.identifier as any));
    } catch {
      // authorizationStatusFor can throw on simulator for uncommon types.
    }
    logHKEvent({
      stage: "auth-check",
      metric: metricType,
      authStatus,
    });

    const queryStartedAt = Date.now();
    logHKEvent({
      stage: "query-start",
      metric: metricType,
      windowStart: startDate.toISOString(),
      windowEnd: endDate.toISOString(),
    });

    const hkSamples = await queryQuantitySamples(config.identifier as any, {
      limit: 0,
      unit: config.unit,
      filter: { date: { startDate, endDate } },
    });

    // Aggregate unique source names + device names so we can tell whether the
    // Apple Watch is actually contributing (vs iPhone motion coprocessor for
    // activity data).
    const sourceNames = Array.from(new Set(
      hkSamples.map((s) => s.sourceRevision?.source?.name).filter(Boolean) as string[],
    ));
    const deviceNames = Array.from(new Set(
      hkSamples.map((s) => s.device?.name).filter(Boolean) as string[],
    ));
    logHKEvent({
      stage: "query-result",
      metric: metricType,
      samplesFound: hkSamples.length,
      durationMs: Date.now() - queryStartedAt,
      authStatus,
      sourceNames,
      deviceNames,
    });

    if (hkSamples.length === 0) {
      onProgress?.({ metric: metricType, scanned: 0, written: 0, skipped: 0, done: true });
      return { written: 0, skipped: 0 };
    }

    const collectionPath = `users/${uid}/hk_${metricType}`;
    let written = 0;
    let skipped = 0;

    for (let i = 0; i < hkSamples.length; i += BATCH_SIZE) {
      const chunk = hkSamples.slice(i, i + BATCH_SIZE);
      const entries = await Promise.all(
        chunk.map(async (sample) => ({
          id: await buildSampleId(metricType, sample),
          sample,
        })),
      );

      // Parallel existence checks — only write samples not already in Firestore.
      const existenceSnaps = await Promise.all(
        entries.map(({ id }) => getDoc(doc(db, `${collectionPath}/${id}`))),
      );
      const newEntries = entries.filter((_, idx) => !existenceSnaps[idx].exists());
      skipped += entries.length - newEntries.length;

      if (newEntries.length > 0) {
        const batch = writeBatch(db);
        for (const { id, sample } of newEntries) {
          batch.set(doc(db, `${collectionPath}/${id}`), {
            ...toFirestoreSample(metricType, sample),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
        written += newEntries.length;
      }

      onProgress?.({
        metric: metricType,
        scanned: Math.min(i + chunk.length, hkSamples.length),
        written,
        skipped,
        done: i + chunk.length >= hkSamples.length,
      });
    }

    logHKEvent({
      stage: "firestore-write",
      metric: metricType,
      samplesWritten: written,
      samplesSkipped: skipped,
    });
    return { written, skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isHealthKitAuthError(error)) {
      logHKEvent({ stage: "skip-auth-error", metric: metricType, error: message });
      onProgress?.({ metric: metricType, scanned: 0, written: 0, skipped: 0, done: true });
      return { written: 0, skipped: 0 };
    }
    logHKEvent({ stage: "error", metric: metricType, error: message });
    onProgress?.({ metric: metricType, scanned: 0, written: 0, skipped: 0, done: true, error: message });
    return { written: 0, skipped: 0, error: message };
  }
}

async function backfillSleep(
  uid: string,
  lookbackDays: number,
  onProgress?: (p: BackfillProgress) => void,
): Promise<{ written: number; skipped: number; error?: string }> {
  if (Platform.OS !== "ios") return { written: 0, skipped: 0 };

  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1_000);

    let authStatus: string = "unknown";
    try {
      authStatus = String(authorizationStatusFor("HKCategoryTypeIdentifierSleepAnalysis" as any));
    } catch {
      // authorizationStatusFor can throw on simulator for uncommon types.
    }
    logHKEvent({ stage: "auth-check", metric: "sleep", authStatus });

    const queryStartedAt = Date.now();
    logHKEvent({
      stage: "query-start",
      metric: "sleep",
      windowStart: startDate.toISOString(),
      windowEnd: endDate.toISOString(),
    });

    const rawSamples = await queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
      limit: 0,
      filter: { date: { startDate, endDate } },
    });

    logHKEvent({
      stage: "query-result",
      metric: "sleep",
      samplesFound: rawSamples?.length ?? 0,
      durationMs: Date.now() - queryStartedAt,
      authStatus,
    });

    if (!rawSamples || rawSamples.length === 0) {
      onProgress?.({ metric: "sleep", scanned: 0, written: 0, skipped: 0, done: true });
      return { written: 0, skipped: 0 };
    }

    const nightMap = new Map<string, ReturnType<typeof mapCategorySampleToSleepSample>[]>();
    for (const raw of rawSamples) {
      const sample = mapCategorySampleToSleepSample(raw as any);
      const nightKey = getSleepNightDate(new Date(raw.startDate));
      const bucket = nightMap.get(nightKey) ?? [];
      bucket.push(sample);
      nightMap.set(nightKey, bucket);
    }

    // Sleep docs are keyed by night date and merge per-night samples;
    // skip nights already present to avoid clobbering existing records.
    let written = 0;
    let skipped = 0;
    let batch = writeBatch(db);
    let batchOps = 0;

    for (const [date, samples] of nightMap) {
      const ref = doc(db, `users/${uid}/hk_sleep/${date}`);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        skipped += 1;
        continue;
      }
      batch.set(ref, {
        date,
        samples,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      batchOps += 1;
      written += 1;

      if (batchOps >= BATCH_SIZE) {
        await batch.commit();
        batch = writeBatch(db);
        batchOps = 0;
      }
    }

    if (batchOps > 0) {
      await batch.commit();
    }

    logHKEvent({
      stage: "firestore-write",
      metric: "sleep",
      samplesWritten: written,
      samplesSkipped: skipped,
    });
    onProgress?.({ metric: "sleep", scanned: nightMap.size, written, skipped, done: true });
    return { written, skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isHealthKitAuthError(error)) {
      logHKEvent({ stage: "skip-auth-error", metric: "sleep", error: message });
      onProgress?.({ metric: "sleep", scanned: 0, written: 0, skipped: 0, done: true });
      return { written: 0, skipped: 0 };
    }
    logHKEvent({ stage: "error", metric: "sleep", error: message });
    // Also record the error in hk_sync/sleep so the incremental sync cursor
    // reflects failures (previously only syncSleep wrote this state; the
    // backfill path was silent, making diagnosis harder).
    await setSyncState(uid, "sleep", {
      lastStatus: "error",
      lastError: message,
    }).catch(() => {});
    onProgress?.({ metric: "sleep", scanned: 0, written: 0, skipped: 0, done: true, error: message });
    return { written: 0, skipped: 0, error: message };
  }
}

/**
 * Pull historical HealthKit samples that are missing from Firestore.
 *
 * Unlike the incremental `syncAllHealthKit`, this walks a wider window
 * (default 365 days) and does an existence check per sample so records
 * that already landed from a prior daily sync are left untouched.
 *
 * Intended to be user-triggered (e.g. a "Re-sync historical data" button)
 * — it does not update the `hk_sync/{metric}.lastSyncedAt` cursor, so the
 * normal incremental sync continues on its existing cadence afterward.
 */
export async function resyncHistoricalHealthKit(options?: {
  lookbackDays?: number;
  onProgress?: (p: BackfillProgress) => void;
}): Promise<BackfillResult> {
  const uid = getAuth().currentUser?.uid;
  if (!uid) {
    return {
      ok: false,
      totalWritten: 0,
      totalSkipped: 0,
      perMetric: { _auth: { written: 0, skipped: 0, error: "no-auth" } },
    };
  }

  const lookbackDays = options?.lookbackDays ?? BACKFILL_DEFAULT_LOOKBACK_DAYS;
  const metricTypes = Object.keys(METRIC_CONFIG) as MetricType[];
  const perMetric: BackfillResult["perMetric"] = {};
  let totalWritten = 0;
  let totalSkipped = 0;

  for (const metricType of metricTypes) {
    const result = await backfillMetric(uid, metricType, lookbackDays, options?.onProgress);
    perMetric[metricType] = result;
    totalWritten += result.written;
    totalSkipped += result.skipped;
  }

  const sleepResult = await backfillSleep(uid, lookbackDays, options?.onProgress);
  perMetric.sleep = sleepResult;
  totalWritten += sleepResult.written;
  totalSkipped += sleepResult.skipped;

  const ok = Object.values(perMetric).every((r) => !r.error);
  return { ok, totalWritten, totalSkipped, perMetric };
}

export async function bootstrapHealthKitSync(): Promise<void> {
  // 1. Ensure HealthKit read authorization is in place on this install.
  //    Idempotent — iOS shows the permission dialog only on the first
  //    request per app install; subsequent calls resolve silently. This
  //    covers the "user logs back in on a fresh install / new device"
  //    case where the onboarding permissions step was skipped because
  //    the backfill flagged their onboarding complete.
  try {
    const { requestHealthPermissions } = await import('@/lib/services/healthkit/HealthKitClient');
    await requestHealthPermissions();
  } catch (err) {
    console.warn('[HKSync] bootstrap requestHealthPermissions failed:', err);
  }

  // 2. Run the syncs SEQUENTIALLY. HealthKit queues all queries on a
  //    single internal thread; running 17+ quantity-metric syncs plus
  //    sleep + clinical notes + FHIR prefill in parallel starves the
  //    bridge and causes the tab bar / activity rings to feel
  //    unresponsive on the first post-launch render. Serial execution
  //    is slower in wall time but keeps the JS bridge + UI thread free.
  await syncAllHealthKit().catch((e) => console.warn('[HKSync] syncAllHealthKit:', e));
  await syncSleep().catch((e) => console.warn('[HKSync] syncSleep:', e));
  await syncClinicalNotes().catch((e) => console.warn('[HKSync] syncClinicalNotes:', e));
  await syncFhirPrefill().catch((e) => console.warn('[HKSync] syncFhirPrefill:', e));
}
