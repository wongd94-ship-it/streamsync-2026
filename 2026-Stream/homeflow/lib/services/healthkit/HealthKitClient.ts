/**
 * HealthKit Client
 *
 * Clean abstraction over @kingstinct/react-native-healthkit.
 * Exposes functions for permissions, activity, sleep, and vitals queries.
 * iOS only — all functions return empty/default data on non-iOS platforms.
 */

import { Platform } from 'react-native';
import {
  requestAuthorization,
  queryQuantitySamples,
  queryCategorySamples,
  isHealthDataAvailable,
  getBiologicalSex as hkGetBiologicalSex,
  getDateOfBirth as hkGetDateOfBirth,
  BiologicalSex,
} from '@kingstinct/react-native-healthkit';
import type { QuantitySample } from '@kingstinct/react-native-healthkit';
import type { HealthKitDemographics } from '../fhir/types';

import {
  formatDateKey,
  getDateKeysInRange,
  bucketSamplesByDay,
  sumSamples,
  statsSamples,
  mapCategorySampleToSleepSample,
  getSleepNightDate,
  estimateSedentaryMinutes,
} from './mappers';

import {
  SleepStage,
  type DateRange,
  type DailyActivity,
  type SleepNight,
  type VitalsDay,
  type HealthPermissionResult,
} from './types';

const HK = {
  stepCount: 'HKQuantityTypeIdentifierStepCount' as const,
  activeEnergy: 'HKQuantityTypeIdentifierActiveEnergyBurned' as const,
  exerciseTime: 'HKQuantityTypeIdentifierAppleExerciseTime' as const,
  moveTime: 'HKQuantityTypeIdentifierAppleMoveTime' as const,
  standTime: 'HKQuantityTypeIdentifierAppleStandTime' as const,
  distance: 'HKQuantityTypeIdentifierDistanceWalkingRunning' as const,
  sleepAnalysis: 'HKCategoryTypeIdentifierSleepAnalysis' as const,
  heartRate: 'HKQuantityTypeIdentifierHeartRate' as const,
  restingHeartRate: 'HKQuantityTypeIdentifierRestingHeartRate' as const,
  hrv: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' as const,
  respiratoryRate: 'HKQuantityTypeIdentifierRespiratoryRate' as const,
  oxygenSaturation: 'HKQuantityTypeIdentifierOxygenSaturation' as const,
  bodyMass: 'HKQuantityTypeIdentifierBodyMass' as const,
  height: 'HKQuantityTypeIdentifierHeight' as const,
  walkingHeartRateAverage: 'HKQuantityTypeIdentifierWalkingHeartRateAverage' as const,
  walkingSpeed: 'HKQuantityTypeIdentifierWalkingSpeed' as const,
  walkingStepLength: 'HKQuantityTypeIdentifierWalkingStepLength' as const,
  appleWalkingSteadiness: 'HKQuantityTypeIdentifierAppleWalkingSteadiness' as const,
  sixMinuteWalkTestDistance: 'HKQuantityTypeIdentifierSixMinuteWalkTestDistance' as const,
  uvExposure: 'HKQuantityTypeIdentifierUVExposure' as const,
  vo2Max: 'HKQuantityTypeIdentifierVO2Max' as const,
  timeInDaylight: 'HKQuantityTypeIdentifierTimeInDaylight' as const,
};

const ALL_READ_TYPES = [
  HK.stepCount,
  HK.activeEnergy,
  HK.exerciseTime,
  HK.moveTime,
  HK.standTime,
  HK.distance,
  HK.sleepAnalysis,
  HK.heartRate,
  HK.restingHeartRate,
  HK.hrv,
  HK.respiratoryRate,
  HK.oxygenSaturation,
  HK.bodyMass,
  HK.height,
  HK.walkingHeartRateAverage,
  HK.walkingSpeed,
  HK.walkingStepLength,
  HK.appleWalkingSteadiness,
  HK.sixMinuteWalkTestDistance,
  HK.uvExposure,
  HK.vo2Max,
  HK.timeInDaylight,
];

const WRITE_TYPES = [
  HK.stepCount,
  HK.activeEnergy,
  HK.sleepAnalysis,
  HK.heartRate,
];

function isIOS(): boolean {
  return Platform.OS === 'ios';
}

async function queryQuantity(
  identifier: string,
  range: DateRange,
  unit: string,
): Promise<readonly QuantitySample[]> {
  return queryQuantitySamples(identifier as any, {
    limit: 0,
    unit,
    filter: {
      date: {
        startDate: range.startDate,
        endDate: range.endDate,
      },
    },
  });
}

export async function requestHealthPermissions(): Promise<HealthPermissionResult> {
  if (!isIOS()) {
    return {
      success: false,
      note: 'HealthKit is only available on iOS.',
    };
  }

  try {
    const available = isHealthDataAvailable();
    if (!available) {
      return {
        success: false,
        note: 'HealthKit is not available on this device.',
      };
    }

    await requestAuthorization({
      toRead: ALL_READ_TYPES as any,
      toShare: WRITE_TYPES as any,
    });

    // iOS only shows the permission dialog once per app install.  After that
    // first presentation (even if it happened during a prior test run and the
    // user dismissed without granting), requestAuthorization resolves silently
    // and we cannot read the granted/denied status (Apple privacy restriction).
    //
    // To confirm data is actually flowing, attempt a quick step-count query
    // for the last 7 days.  A non-empty result means HealthKit is sharing data.
    // An empty result is ambiguous (denied OR simply no data recorded), but at
    // a minimum it tells us the query path works without throwing.
    const dataVerified = await verifyHealthKitDataAccess();

    return {
      success: true,
      dataVerified,
      note: dataVerified
        ? 'HealthKit is connected and sharing data.'
        : 'Authorization requested. If no health data appears in the app, go to Settings → Health → Data Access & Devices → StreamSync and enable all categories.',
    };
  } catch (error) {
    return {
      success: false,
      note: `Permission request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Attempts a lightweight HealthKit query to verify data access is working.
 * Returns true if at least one step-count sample was returned for the last 7
 * days, false if the query returned empty (permissions denied or no data).
 *
 * Note: an empty result is ambiguous — it could mean denied permissions OR
 * that the user simply has no recorded steps.  Use this as a sanity-check,
 * not a definitive auth-status check.
 */
export async function verifyHealthKitDataAccess(): Promise<boolean> {
  if (!isIOS()) return false;
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    const samples = await queryQuantitySamples(HK.stepCount, {
      limit: 1,
      unit: 'count',
      filter: { date: { startDate, endDate } },
    });
    return Array.isArray(samples) && samples.length > 0;
  } catch {
    return false;
  }
}

export async function getDailyActivity(range: DateRange): Promise<DailyActivity[]> {
  if (!isIOS()) return [];

  const [steps, energy, exercise, move, stand, distance] = await Promise.all([
    queryQuantity(HK.stepCount, range, 'count').catch(() => [] as readonly QuantitySample[]),
    queryQuantity(HK.activeEnergy, range, 'kcal').catch(() => [] as readonly QuantitySample[]),
    queryQuantity(HK.exerciseTime, range, 'min').catch(() => [] as readonly QuantitySample[]),
    queryQuantity(HK.moveTime, range, 'min').catch(() => [] as readonly QuantitySample[]),
    queryQuantity(HK.standTime, range, 'min').catch(() => [] as readonly QuantitySample[]),
    queryQuantity(HK.distance, range, 'm').catch(() => [] as readonly QuantitySample[]),
  ]);

  const stepsByDay = bucketSamplesByDay(steps);
  const energyByDay = bucketSamplesByDay(energy);
  const exerciseByDay = bucketSamplesByDay(exercise);
  const moveByDay = bucketSamplesByDay(move);
  const standByDay = bucketSamplesByDay(stand);
  const distanceByDay = bucketSamplesByDay(distance);

  const dateKeys = getDateKeysInRange(range.startDate, range.endDate);
  return dateKeys.map((date) => {
    const exerciseMin = Math.round(sumSamples(exerciseByDay.get(date) ?? []));
    const moveMin = Math.round(sumSamples(moveByDay.get(date) ?? []));
    const standMin = Math.round(sumSamples(standByDay.get(date) ?? []));

    return {
      date,
      steps: Math.round(sumSamples(stepsByDay.get(date) ?? [])),
      exerciseMinutes: exerciseMin,
      moveMinutes: moveMin,
      standMinutes: standMin,
      sedentaryMinutes: estimateSedentaryMinutes(exerciseMin, moveMin, standMin),
      activeEnergyBurned: Math.round(sumSamples(energyByDay.get(date) ?? [])),
      distanceWalkingRunning: Math.round(sumSamples(distanceByDay.get(date) ?? [])),
    };
  });
}

export async function getSleep(range: DateRange): Promise<SleepNight[]> {
  if (!isIOS()) return [];

  const rawSamples = await queryCategorySamples(HK.sleepAnalysis, {
    limit: 0,
    filter: {
      date: {
        startDate: range.startDate,
        endDate: range.endDate,
      },
    },
  });

  if (!rawSamples || rawSamples.length === 0) return [];

  const nightMap = new Map<string, ReturnType<typeof mapCategorySampleToSleepSample>[]>();

  for (const raw of rawSamples) {
    const sample = mapCategorySampleToSleepSample(raw as any);
    const nightKey = getSleepNightDate(new Date(raw.startDate));
    const bucket = nightMap.get(nightKey) ?? [];
    bucket.push(sample);
    nightMap.set(nightKey, bucket);
  }

  const nights: SleepNight[] = [];
  for (const [date, samples] of nightMap) {
    let inBedMinutes = 0;
    let awakeMinutes = 0;
    let coreMinutes = 0;
    let deepMinutes = 0;
    let remMinutes = 0;
    let asleepUndifferentiated = 0;

    for (const s of samples) {
      switch (s.stage) {
        case SleepStage.InBed:
          inBedMinutes += s.durationMinutes;
          break;
        case SleepStage.Awake:
          awakeMinutes += s.durationMinutes;
          break;
        case SleepStage.Core:
          coreMinutes += s.durationMinutes;
          break;
        case SleepStage.Deep:
          deepMinutes += s.durationMinutes;
          break;
        case SleepStage.REM:
          remMinutes += s.durationMinutes;
          break;
        case SleepStage.AsleepUnspecified:
          asleepUndifferentiated += s.durationMinutes;
          break;
      }
    }

    // Total time asleep includes detailed stages (Core/Deep/REM) PLUS the
    // generic "asleepUndifferentiated" bucket that older iOS / non-Watch
    // sleep sources report. Keeping them separate lets us flag whether
    // detailed-stage data is present (Watch with iOS 16+) and downgrade
    // the UI gracefully when only InBed/AsleepUnspecified are available.
    const totalAsleepMinutes =
      coreMinutes + deepMinutes + remMinutes + asleepUndifferentiated;
    const totalInBedMinutes = Math.max(
      inBedMinutes,
      totalAsleepMinutes + awakeMinutes,
    );
    const sleepEfficiency =
      totalInBedMinutes > 0 ?
        Math.round((totalAsleepMinutes / totalInBedMinutes) * 100) :
        0;
    const hasDetailedStages = coreMinutes + deepMinutes + remMinutes > 0;

    nights.push({
      date,
      totalAsleepMinutes,
      totalInBedMinutes,
      sleepEfficiency,
      hasDetailedStages,
      stages: {
        awake: awakeMinutes,
        core: coreMinutes,
        deep: deepMinutes,
        rem: remMinutes,
        asleepUndifferentiated,
      },
      samples,
    });
  }

  nights.sort((a, b) => a.date.localeCompare(b.date));
  return nights;
}

export async function getVitals(range: DateRange): Promise<VitalsDay[]> {
  if (!isIOS()) return [];

  const [heartRate, restingHR, hrv, resp, oxygen] = await Promise.all([
    queryQuantity(HK.heartRate, range, 'count/min').catch(() => [] as readonly QuantitySample[]),
    queryQuantity(HK.restingHeartRate, range, 'count/min').catch(() => [] as readonly QuantitySample[]),
    queryQuantity(HK.hrv, range, 'ms').catch(() => [] as readonly QuantitySample[]),
    queryQuantity(HK.respiratoryRate, range, 'count/min').catch(() => [] as readonly QuantitySample[]),
    queryQuantity(HK.oxygenSaturation, range, '%').catch(() => [] as readonly QuantitySample[]),
  ]);

  const hrByDay = bucketSamplesByDay(heartRate);
  const restingByDay = bucketSamplesByDay(restingHR);
  const hrvByDay = bucketSamplesByDay(hrv);
  const respByDay = bucketSamplesByDay(resp);
  const oxygenByDay = bucketSamplesByDay(oxygen);

  const dateKeys = getDateKeysInRange(range.startDate, range.endDate);
  return dateKeys.map((date) => {
    const hrStats = statsSamples(hrByDay.get(date) ?? []);
    const restingStats = statsSamples(restingByDay.get(date) ?? []);
    const hrvStats = statsSamples(hrvByDay.get(date) ?? []);
    const respStats = statsSamples(respByDay.get(date) ?? []);
    const oxygenStats = statsSamples(oxygenByDay.get(date) ?? []);

    // Match the canonical VitalsDay shape — nested heartRate stats,
    // `hrv` (not `heartRateVariabilitySDNN`). The previous flat-field
    // implementation didn't match the type, so home-screen + Health-tab
    // consumers reading `vitals.heartRate.average` and `vitals.hrv` got
    // `undefined` and rendered "—". Same root-cause class as the sleep
    // NaN bug; both wedge silently because the build doesn't gate on TS
    // shape mismatches in this file.
    return {
      date,
      heartRate: {
        min: hrStats.min || 0,
        max: hrStats.max || 0,
        average: hrStats.average || 0,
        sampleCount: hrStats.sampleCount || 0,
      },
      restingHeartRate: restingStats.average || null,
      hrv: hrvStats.average || null,
      respiratoryRate: respStats.average || null,
      oxygenSaturation: oxygenStats.average || null,
    };
  });
}

export async function getBiologicalSex(): Promise<'male' | 'female' | 'other' | null> {
  if (!isIOS()) return null;

  try {
    const sex = await hkGetBiologicalSex();
    switch (sex) {
      case BiologicalSex.male:
        return 'male';
      case BiologicalSex.female:
        return 'female';
      case BiologicalSex.other:
        return 'other';
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export async function getDateOfBirth(): Promise<Date | null> {
  if (!isIOS()) return null;

  try {
    return await hkGetDateOfBirth();
  } catch {
    return null;
  }
}

export async function getDemographics(): Promise<HealthKitDemographics> {
  const [biologicalSex, dateOfBirth] = await Promise.all([
    getBiologicalSex(),
    getDateOfBirth(),
  ]);

  let age: number | null = null;
  if (dateOfBirth) {
    const now = new Date();
    age = now.getFullYear() - dateOfBirth.getFullYear();
    const hasHadBirthdayThisYear =
      now.getMonth() > dateOfBirth.getMonth() ||
      (now.getMonth() === dateOfBirth.getMonth() && now.getDate() >= dateOfBirth.getDate());
    if (!hasHadBirthdayThisYear) age -= 1;
  }

  return {
    age,
    dateOfBirth: dateOfBirth ? dateOfBirth.toISOString().split('T')[0] : null,
    biologicalSex,
  };
}
