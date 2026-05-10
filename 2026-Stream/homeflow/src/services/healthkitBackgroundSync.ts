/**
 * HealthKit background sync — pushes new samples to Firestore when the user
 * isn't actively in the app.
 *
 * Two paths:
 *   1. `enableBackgroundDelivery` + `subscribeToChanges` — iOS wakes the app
 *      briefly whenever new samples land in HealthKit for the selected types.
 *   2. `expo-background-task` / BGTaskScheduler — OS-scheduled periodic wake-up
 *      (minimum effective interval ~15 minutes; iOS decides the cadence).
 *
 * Both paths run the same idempotent 7-day backfill
 * (`resyncHistoricalHealthKit({ lookbackDays: 7 })`) so nothing gets
 * overwritten and we catch up anything missed between launches.
 */

import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import {
  enableBackgroundDelivery,
  subscribeToChanges,
  UpdateFrequency,
} from "@kingstinct/react-native-healthkit";

import { resyncHistoricalHealthKit } from "./healthkitSync";

export const HEALTHKIT_BG_TASK_NAME = "streamsync-healthkit-7day-backfill";
const BG_MIN_INTERVAL_MINUTES = 60; // iOS treats this as a lower bound, not a promise

// Metrics that iOS will wake the app for. Keeping this tight so we don't burn
// background budget — heart rate / steps fire most often and cover the
// "something happened" signal for the broader sync.
const OBSERVED_TYPES = [
  "HKQuantityTypeIdentifierHeartRate",
  "HKQuantityTypeIdentifierStepCount",
  "HKCategoryTypeIdentifierSleepAnalysis",
] as const;

let observersRegistered = false;
let bgTaskRegistered = false;
const changeSubscriptions: { remove: () => boolean }[] = [];

async function runSevenDaySync(trigger: string): Promise<void> {
  try {
    const result = await resyncHistoricalHealthKit({ lookbackDays: 7 });
    if (__DEV__) {
      console.log(
        `[HealthKit BG:${trigger}] wrote=${result.totalWritten} skipped=${result.totalSkipped} ok=${result.ok}`,
      );
    }
  } catch (err) {
    console.warn(`[HealthKit BG:${trigger}] sync failed`, err);
  }
}

// TaskManager task definitions must live at module top level so they survive
// JS engine restarts when iOS wakes the app headless.
if (!TaskManager.isTaskDefined(HEALTHKIT_BG_TASK_NAME)) {
  TaskManager.defineTask(HEALTHKIT_BG_TASK_NAME, async () => {
    await runSevenDaySync("bgtask");
    return BackgroundTask.BackgroundTaskResult.Success;
  });
}

export async function registerHealthKitBackgroundSync(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await Promise.allSettled([registerObservers(), registerBgTask()]);
}

export async function unregisterHealthKitBackgroundSync(): Promise<void> {
  for (const sub of changeSubscriptions.splice(0)) {
    try {
      sub.remove();
    } catch {
      // best effort
    }
  }
  observersRegistered = false;

  try {
    const registered = await TaskManager.isTaskRegisteredAsync(HEALTHKIT_BG_TASK_NAME);
    if (registered) {
      await BackgroundTask.unregisterTaskAsync(HEALTHKIT_BG_TASK_NAME);
    }
  } catch (err) {
    console.warn("[HealthKit BG] unregister bg task failed", err);
  }
  bgTaskRegistered = false;
}

async function registerObservers(): Promise<void> {
  if (observersRegistered) return;

  for (const type of OBSERVED_TYPES) {
    try {
      await enableBackgroundDelivery(type as any, UpdateFrequency.immediate);
      const subscription = subscribeToChanges(type as any, () => {
        void runSevenDaySync("observer");
      });
      changeSubscriptions.push(subscription);
    } catch (err) {
      console.warn(`[HealthKit BG] enableBackgroundDelivery ${type} failed`, err);
    }
  }

  observersRegistered = true;
}

async function registerBgTask(): Promise<void> {
  if (bgTaskRegistered) return;

  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      console.warn("[HealthKit BG] BackgroundTask restricted by OS");
      return;
    }

    const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(HEALTHKIT_BG_TASK_NAME);
    if (!alreadyRegistered) {
      await BackgroundTask.registerTaskAsync(HEALTHKIT_BG_TASK_NAME, {
        minimumInterval: BG_MIN_INTERVAL_MINUTES,
      });
    }
    bgTaskRegistered = true;
  } catch (err) {
    console.warn("[HealthKit BG] registerTaskAsync failed", err);
  }
}
