/**
 * Health Summary Hook
 *
 * Fetches HealthKit data and derives a HealthSummaryDay view model
 * for the Daily Check-In + Health screens.
 *
 * Activity + vitals are AVERAGED over the most recent 3 days that have
 * any data. Rationale: "today" data is often empty in early morning
 * before HealthKit has caught up, and a participant with a Watch that
 * died last night would otherwise see no metrics. A 3-day window is
 * short enough to reflect current state, long enough that one bad
 * sync doesn't blank the screen.
 *
 * Sleep stays per-night because sleep data is only meaningful per
 * night; the SleepSection already shows a 7-day baseline beside it.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getDailyActivity,
  getSleep,
  getVitals,
  getDateRange,
} from '@/lib/services/healthkit';
import type { DailyActivity, VitalsDay } from '@/lib/services/healthkit';
import { buildHealthSummaryDay } from '@/lib/services/health-summary';
import { formatDateKey } from '@/lib/services/healthkit/mappers';
import type { HealthSummaryDay } from '@/lib/services/health-summary';

const ROLLING_WINDOW_DAYS = 3;

/**
 * Pick the most recent N days that have any meaningful data, then
 * average the numeric fields. Returns null if every candidate is empty.
 */
function averageActivityWindow(
  data: DailyActivity[],
  todayKey: string,
): DailyActivity | null {
  if (data.length === 0) return null;

  // Sort newest-first, prefer days at or before today, drop fully-empty days.
  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date));
  const nonEmpty = sorted.filter((d) => {
    const hasMovement = d.steps > 0 || d.activeEnergyBurned > 0 || d.exerciseMinutes > 0;
    return d.date <= todayKey && hasMovement;
  });
  const window = nonEmpty.slice(0, ROLLING_WINDOW_DAYS);
  if (window.length === 0) return null;

  const sum = window.reduce(
    (acc, d) => ({
      steps: acc.steps + d.steps,
      exerciseMinutes: acc.exerciseMinutes + d.exerciseMinutes,
      moveMinutes: acc.moveMinutes + d.moveMinutes,
      standMinutes: acc.standMinutes + d.standMinutes,
      sedentaryMinutes: acc.sedentaryMinutes + d.sedentaryMinutes,
      activeEnergyBurned: acc.activeEnergyBurned + d.activeEnergyBurned,
      distanceWalkingRunning: acc.distanceWalkingRunning + d.distanceWalkingRunning,
    }),
    {
      steps: 0,
      exerciseMinutes: 0,
      moveMinutes: 0,
      standMinutes: 0,
      sedentaryMinutes: 0,
      activeEnergyBurned: 0,
      distanceWalkingRunning: 0,
    },
  );
  const n = window.length;

  return {
    date: window[0].date, // most recent
    steps: Math.round(sum.steps / n),
    exerciseMinutes: Math.round(sum.exerciseMinutes / n),
    moveMinutes: Math.round(sum.moveMinutes / n),
    standMinutes: Math.round(sum.standMinutes / n),
    sedentaryMinutes: Math.round(sum.sedentaryMinutes / n),
    activeEnergyBurned: Math.round(sum.activeEnergyBurned / n),
    distanceWalkingRunning: Math.round(sum.distanceWalkingRunning / n),
  };
}

/**
 * Average each vital metric across the last N days that REPORTED that
 * metric. Different vitals have different sampling cadences (HRV is
 * nightly, heart rate is continuous), so we compute per-field rather
 * than dropping a day if any one metric is missing.
 */
function averageVitalsWindow(
  data: VitalsDay[],
  todayKey: string,
): VitalsDay | null {
  if (data.length === 0) return null;

  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date));
  const window = sorted.filter((d) => d.date <= todayKey).slice(0, ROLLING_WINDOW_DAYS);
  if (window.length === 0) return null;

  const avgNullable = (pick: (d: VitalsDay) => number | null): number | null => {
    const values = window.map(pick).filter((v): v is number => v != null && v > 0);
    if (values.length === 0) return null;
    const sum = values.reduce((a, b) => a + b, 0);
    return Math.round((sum / values.length) * 10) / 10;
  };

  const hrAverages = window.map((d) => d.heartRate?.average ?? 0).filter((v) => v > 0);
  const hrMins = window.map((d) => d.heartRate?.min ?? 0).filter((v) => v > 0);
  const hrMaxes = window.map((d) => d.heartRate?.max ?? 0).filter((v) => v > 0);
  const hrSampleCount = window.reduce((acc, d) => acc + (d.heartRate?.sampleCount ?? 0), 0);

  const heartRate = hrAverages.length > 0
    ? {
        average: Math.round(hrAverages.reduce((a, b) => a + b, 0) / hrAverages.length),
        min: hrMins.length > 0 ? Math.round(Math.min(...hrMins)) : 0,
        max: hrMaxes.length > 0 ? Math.round(Math.max(...hrMaxes)) : 0,
        sampleCount: hrSampleCount,
      }
    : { average: 0, min: 0, max: 0, sampleCount: 0 };

  return {
    date: window[0].date,
    heartRate,
    restingHeartRate: avgNullable((d) => d.restingHeartRate),
    hrv: avgNullable((d) => d.hrv),
    respiratoryRate: avgNullable((d) => d.respiratoryRate),
    oxygenSaturation: avgNullable((d) => d.oxygenSaturation),
  };
}

export function useHealthSummary(): {
  summary: HealthSummaryDay | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [summary, setSummary] = useState<HealthSummaryDay | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      try {
        // 8-day window so 3-day rolling average has headroom AND sleep's
        // 7-day baseline still works.
        const range = getDateRange(8);
        const [activityData, sleepData, vitalsData] = await Promise.all([
          getDailyActivity(range),
          getSleep(range),
          getVitals(range),
        ]);

        if (cancelled) return;

        const today = formatDateKey(new Date());

        // Sleep: stays per-night (most recent night with data).
        const todaySleep = sleepData.length > 0 ? sleepData[sleepData.length - 1] : null;
        const recentSleep = todaySleep
          ? sleepData.filter((n) => n.date !== todaySleep.date)
          : sleepData.slice(1);

        // Activity + vitals: 3-day rolling average — robust to a single
        // day with sparse / missing data (the original "today only"
        // logic showed nothing if today's HealthKit hadn't synced yet).
        const todayActivity = averageActivityWindow(activityData, today);
        const todayVitals = averageVitalsWindow(vitalsData, today);

        const result = buildHealthSummaryDay(
          today,
          todaySleep,
          recentSleep,
          todayActivity,
          todayVitals,
        );

        // Annotate the insights so the UI can show a "3-day average"
        // caption — the participant should know they're seeing a window,
        // not literally "today."
        if (result.activity && todayActivity) {
          result.activity.windowLabel = '3-day average';
        }
        if (result.vitals && todayVitals && result.vitals.items.length > 0) {
          result.vitals.windowLabel = '3-day average';
        }

        if (!cancelled) {
          setSummary(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load health data');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { summary, isLoading, error, refresh };
}
