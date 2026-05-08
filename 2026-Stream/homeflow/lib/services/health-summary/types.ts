/**
 * Health Summary View-Model Types
 *
 * Derived types for presenting HealthKit data in the Daily Check-In screen.
 * These sit between raw HealthKit types and UI components.
 */

import type { SleepNight, DailyActivity, VitalsDay } from '@/lib/services/healthkit';

export type InsightStatus = 'steady' | 'above-typical' | 'below-typical' | 'no-data';

export interface SleepInsight {
  headline: string;
  supportingText: string;
  status: InsightStatus;
  totalHours: number;
  baselineHours: number;
  barFill: number;
  efficiency: number;
  stages: { deep: number; core: number; rem: number; awake: number } | null;
}

export interface ActivityInsight {
  headline: string;
  supportingText: string;
  status: InsightStatus;
  activeMinutes: number;
  steps: number;
  energyBurned: number;
  distance: number;
  /** Optional caption shown under the headline, e.g. "3-day average". */
  windowLabel?: string;
}

export interface VitalItem {
  label: string;
  value: string;
  status: InsightStatus;
}

export interface VitalsInsight {
  headline: string;
  supportingText?: string;
  status: InsightStatus;
  items: VitalItem[];
  /** Optional caption shown under the headline, e.g. "3-day average". */
  windowLabel?: string;
}

export interface HealthSummaryDay {
  date: string;
  dateLabel: string;
  greeting: string;
  sleep: SleepInsight | null;
  activity: ActivityInsight | null;
  vitals: VitalsInsight | null;
  raw: {
    sleep: SleepNight | null;
    activity: DailyActivity | null;
    vitals: VitalsDay | null;
  };
}
