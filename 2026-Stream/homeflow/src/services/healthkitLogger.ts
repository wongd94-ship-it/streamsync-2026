/**
 * Structured logger for HealthKit sync pipeline.
 *
 * Emits a single-line JSON-shaped console event per stage so that future
 * resync regressions can be diagnosed from device logs without re-running
 * with a debugger attached.
 *
 * Stages align with the sync pipeline:
 *   auth-check        — pre-query authorization probe
 *   query-start       — HealthKit query dispatched
 *   query-result      — HealthKit query returned (samples found, source devices)
 *   firestore-write   — Firestore batch committed
 *   error             — unrecoverable error (non-auth)
 *   skip-auth-error   — auth error caught, metric silently skipped (iOS quirk)
 */

export type HKLogStage =
  | "auth-check"
  | "query-start"
  | "query-result"
  | "firestore-write"
  | "error"
  | "skip-auth-error";

export interface HKLogEvent {
  stage: HKLogStage;
  metric: string;
  windowStart?: string;
  windowEnd?: string;
  samplesFound?: number;
  samplesWritten?: number;
  samplesSkipped?: number;
  durationMs?: number;
  authStatus?: string;
  sourceNames?: string[];
  deviceNames?: string[];
  error?: string;
}

export function logHKEvent(event: HKLogEvent): void {
  console.info("[HKSync]", JSON.stringify(event));
}

/**
 * Helper for timing a stage. Returns a function that, when called, logs
 * the event with the elapsed durationMs.
 */
export function startHKTimer(
  metric: string,
  stage: HKLogStage,
): (partial: Omit<HKLogEvent, "stage" | "metric" | "durationMs">) => void {
  const startedAt = Date.now();
  return (partial) => {
    logHKEvent({
      stage,
      metric,
      durationMs: Date.now() - startedAt,
      ...partial,
    });
  };
}
