/**
 * Notification Service
 *
 * Manages local push notifications that remind users to sync their
 * Apple Watch and Throne device if no new data is detected in 48 hours.
 */

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { STORAGE_KEYS } from '../constants';
import { getDailyActivity } from './healthkit/HealthKitClient';
import { ThroneService } from './throne-service';
import { db } from '@/src/services/firestore';

const HOURS_48 = 48 * 60 * 60 * 1000;
const HOURS_24 = 24 * 60 * 60 * 1000;
const HOURS_4 = 4 * 60 * 60 * 1000;
const DAYS_5 = 5 * 24 * 60 * 60 * 1000;
const DAYS_7 = 7 * 24 * 60 * 60 * 1000;

const NOTIFICATION_IDS = {
  healthkit: 'homeflow-healthkit-reminder',
  throne: 'homeflow-throne-reminder',
  throneArrival: 'homeflow-throne-arrival',
  throneSetupReminder: 'homeflow-throne-setup-reminder',
} as const;

// Quiet hours — no sync-reminder notifications fire between these clock hours
// in the user's local time zone. Earlier versions used a `repeats: true`
// TIME_INTERVAL trigger that fired every 4 hours regardless of clock time,
// which woke users up at 2am / 6am with stale reminders. We now pre-schedule
// a finite series of specific-datetime fires that all land inside the
// waking window; on each app foreground we cancel + reschedule using the
// freshest sync state.
const QUIET_START_HOUR = 22; // 10pm local
const QUIET_END_HOUR = 7; // 7am local
const REPEAT_INTERVAL_HOURS = 4;
// How many future stale-sync reminders to pre-schedule. With 4h spacing
// inside a 15h waking window (07:00–22:00), four entries cover one full
// daylight cycle. Each foreground re-evaluates and reschedules. Earlier
// versions pre-scheduled 12 (~3 days) but that meant a user who synced
// after the schedule was created could see multiple false-positive
// reminders before next app open — the bodies are baked in at schedule
// time and iOS won't refresh them. One-day horizon = at most a handful
// of false positives in the rare case the user goes a full day without
// opening the app while their devices recover.
const REPEAT_PRE_SCHEDULE_COUNT = 4;

function isQuietHour(hour: number): boolean {
  if (QUIET_START_HOUR > QUIET_END_HOUR) {
    // Wraps around midnight (the usual case: 22 → 7).
    return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
  }
  // Non-wrapping window (e.g. quiet 1pm–4pm — kept for completeness).
  return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
}

/**
 * Generate the next N specific-datetime fires during waking hours, starting
 * `intervalHours` from `now` and spaced `intervalHours` apart. Any candidate
 * that lands inside the quiet-hours window is bumped forward to the next
 * QUIET_END_HOUR. The series is purely additive — we never schedule into
 * the past.
 */
function nextWakingFires(now: Date, count: number, intervalHours: number): Date[] {
  const fires: Date[] = [];
  let candidate = new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
  while (fires.length < count) {
    const hour = candidate.getHours();
    if (isQuietHour(hour)) {
      // Bump candidate to QUIET_END_HOUR on the next eligible day.
      const next = new Date(candidate);
      if (hour >= QUIET_START_HOUR) next.setDate(next.getDate() + 1);
      next.setHours(QUIET_END_HOUR, 0, 0, 0);
      candidate = next;
      continue;
    }
    fires.push(new Date(candidate));
    candidate = new Date(candidate.getTime() + intervalHours * 60 * 60 * 1000);
  }
  return fires;
}

function repeatIdFor(source: StaleSyncSource, index: number): string {
  return `homeflow-${source}-repeat-${index}`;
}

// The two stale-sync sources that share notification copy. Other notification
// IDs (`throneArrival`, `throneSetupReminder`) compose their content inline
// and don't go through `NOTIFICATION_CONTENT`. Repeating reminders are tracked
// via dynamic IDs built by `repeatIdFor(source, index)`.
type StaleSyncSource = 'healthkit' | 'throne';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // Sound + banner so the phone actually buzzes when a researcher message
    // arrives, even with the app in the foreground. Without `shouldPlaySound`
    // the buzz is silent and easy to miss.
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Per-source notification copy.
 *
 * `immediateBody` carries actual elapsed time and is only used for the
 * one-shot "fire now" reminder, which we KNOW reflects current state at
 * fire time (it's about to fire immediately). `scheduledBody` is generic
 * and time-agnostic — used for any reminder pre-scheduled to fire later.
 *
 * The previous design baked an elapsed-time string into pre-scheduled
 * reminders too, but iOS won't refresh notification bodies after schedule
 * time. So a body that said "hasn't synced in 24 hours" would fire as-is
 * even if the user had synced their Watch in the intervening hours — the
 * notification lied about the user's actual state. The generic scheduled
 * body says "Sync check" and invites the user to open the app, where the
 * live banner shows the real freshness.
 */
export interface SyncBodyState {
  /** Actual elapsed time since last sync, in ms. Null if unknown / never synced. */
  elapsedMs: number | null;
  /** The researcher-configured threshold, in hours. Falls back to 48. */
  thresholdHours: number;
  /**
   * When false, the message is generated for a SCHEDULED reminder that
   * hasn't fired yet — use the threshold rather than `elapsedMs`. When
   * true, the message is generated for an immediate / past-threshold
   * fire — prefer `elapsedMs` if available.
   *
   * @deprecated Use `immediateBody` / `scheduledBody` directly instead.
   *   Kept for backward compat with any callers that still pass a state.
   */
  pastThreshold: boolean;
}

function formatElapsedHours(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalHours = Math.floor(ms / (60 * 60 * 1000));
  if (totalHours < 1) {
    const minutes = Math.max(1, Math.round(ms / (60 * 1000)));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (totalHours < 24) return `${totalHours} hour${totalHours === 1 ? '' : 's'}`;
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours - days * 24;
  if (remHours === 0) return `${days} day${days === 1 ? '' : 's'}`;
  return `${days} day${days === 1 ? '' : 's'}, ${remHours} hour${remHours === 1 ? '' : 's'}`;
}

interface SourceCopy {
  title: string;
  /** Body for `trigger: null` reminders that fire instantly. May reference elapsed. */
  immediateBody: (elapsedMs: number | null) => string;
  /** Body for any reminder scheduled to fire in the future. Time-agnostic. */
  scheduledBody: string;
}

const NOTIFICATION_CONTENT: Record<StaleSyncSource, SourceCopy> = {
  healthkit: {
    title: 'Apple Watch sync check',
    immediateBody: (elapsedMs) => {
      const phrase = formatElapsedHours(elapsedMs);
      if (phrase) return `Your Apple Watch was last seen syncing ${phrase} ago. Put it on to keep tracking — tap for help.`;
      return `We haven't seen your Apple Watch sync recently. Put it on to keep tracking — tap for help.`;
    },
    // Truthful regardless of when iOS actually fires this. Invites the
    // user into the app, where the live banner shows the real freshness.
    scheduledBody: `We haven't seen your Apple Watch sync recently. Tap to check your current sync status — we'll show you the most recent data inside the app.`,
  },
  throne: {
    title: 'Throne sync check',
    immediateBody: (elapsedMs) => {
      const phrase = formatElapsedHours(elapsedMs);
      if (phrase) return `Your Throne hasn't recorded a void in ${phrase}. Tap for help if you're stuck.`;
      return `We haven't seen your Throne record a void recently. Tap for help if you're stuck.`;
    },
    scheduledBody: `We haven't seen recent voids from your Throne. Tap to check your current sync status — we'll show you the most recent data inside the app.`,
  },
};

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Returns the current notification permission status without prompting.
 * Used by the permissions onboarding screen to render the card state.
 */
export async function getNotificationPermissionStatus(): Promise<
  'granted' | 'denied' | 'not_determined'
> {
  if (Platform.OS === 'web') return 'not_determined';
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'not_determined';
}

/**
 * Routing payload tucked into every sync-alert notification. The
 * notification-tap handler reads this and pushes the support chat with
 * the matching trigger reason. Keep the keys narrow — Expo serializes
 * the entire `data` blob into the iOS userInfo dict.
 */
function syncAlertData(triggerReason: '48h-alert' | '5d-alert') {
  return {
    screen: 'support-chat' as const,
    trigger: triggerReason,
  };
}

/**
 * Schedule a 4-hour-cadence series of local reminders for `source`, confined
 * to waking hours (07:00–22:00 local). Each entry is a discrete DATE-
 * triggered notification with a unique id (`homeflow-<source>-repeat-N`).
 * Idempotent: cancels every prior entry in the series before rescheduling,
 * so calling this on every foreground is safe.
 *
 * The earlier implementation used `TIME_INTERVAL` with `repeats: true`,
 * which fired every 4 hours regardless of clock time — including 2am and
 * 6am — and showed stale body text (the body was baked in at schedule
 * time). This version:
 *   - skips quiet hours entirely (no night-time buzzes), and
 *   - computes each fire's body with its OWN projected elapsed time, so
 *     "X hasn't synced in 30 hours" lands at hour 30, not hour 4.
 *
 * The user must still open the app eventually to refresh against live data
 * (we can't introspect sync recency from a background context), but the
 * pre-scheduled batch covers ~3 days of disuse before drying up.
 */
async function startRepeatingReminder(source: StaleSyncSource): Promise<void> {
  // Wipe any prior entries in the series — important when the user previously
  // had a different threshold or a different stale state.
  await stopRepeatingReminder(source);

  const fires = nextWakingFires(new Date(), REPEAT_PRE_SCHEDULE_COUNT, REPEAT_INTERVAL_HOURS);

  for (let i = 0; i < fires.length; i++) {
    const fireAt = fires[i];
    // Body is intentionally generic — iOS can't refresh it at fire time,
    // and a time-baked body would lie if the user syncs between schedule
    // and fire. The whole point of this notification is "open the app
    // and you'll see the real sync status."
    await Notifications.scheduleNotificationAsync({
      identifier: repeatIdFor(source, i),
      content: {
        title: NOTIFICATION_CONTENT[source].title,
        body: NOTIFICATION_CONTENT[source].scheduledBody,
        data: syncAlertData('48h-alert'),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
      },
    });
  }
}

/**
 * Cancel EVERY scheduled stale-sync notification iOS still holds for this
 * source, regardless of which version of the code created it:
 *
 *   - `homeflow-<source>-reminder`       — legacy safety-net (now removed)
 *   - `homeflow-<source>-repeat`         — legacy single-id repeating loop
 *   - `homeflow-<source>-repeat-N`       — current finite-series fires (N=0..)
 *
 * Called on every app foreground (regardless of current sync state) so
 * stale pre-scheduled fires from a previous foreground or a prior build
 * can't survive past one app open. If the data is still stale after the
 * sweep, `startRepeatingReminder` re-schedules a fresh series.
 */
async function cancelAllSyncReminders(source: StaleSyncSource): Promise<void> {
  const legacySafetyNet = NOTIFICATION_IDS[source];               // homeflow-<source>-reminder
  const legacyRepeatLoop = `homeflow-${source}-repeat`;            // single-id v1 (no index)
  // The v2 finite series; we cancel a generous range here (not just the
  // current REPEAT_PRE_SCHEDULE_COUNT) so that if we ever shorten the
  // window further, leftover entries from a longer-horizon prior install
  // are still wiped.
  const v2SeriesIds = Array.from({ length: 24 }, (_, i) => repeatIdFor(source, i));
  await Promise.all([
    Notifications.cancelScheduledNotificationAsync(legacySafetyNet).catch(() => {}),
    Notifications.cancelScheduledNotificationAsync(legacyRepeatLoop).catch(() => {}),
    ...v2SeriesIds.map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {}),
    ),
  ]);
}

// Kept as an alias so existing call sites compile; `startRepeatingReminder`
// uses it at the top to wipe before re-scheduling.
async function stopRepeatingReminder(source: StaleSyncSource): Promise<void> {
  await cancelAllSyncReminders(source);
}

async function fireImmediateReminder(
  source: StaleSyncSource,
  elapsedMs: number | null,
): Promise<void> {
  const storageKey = source === 'healthkit'
    ? STORAGE_KEYS.LAST_NOTIFICATION_HEALTHKIT
    : STORAGE_KEYS.LAST_NOTIFICATION_THRONE;

  const lastFiredStr = await AsyncStorage.getItem(storageKey);
  if (lastFiredStr) {
    const lastFired = parseInt(lastFiredStr, 10);
    if (Date.now() - lastFired < HOURS_24) return;
  }

  // `trigger: null` fires right now, so a time-aware body is safe — the
  // user reads it within seconds of the freshness check that produced it.
  const body = NOTIFICATION_CONTENT[source].immediateBody(elapsedMs);

  await Notifications.scheduleNotificationAsync({
    identifier: `${NOTIFICATION_IDS[source]}-immediate`,
    content: {
      title: NOTIFICATION_CONTENT[source].title,
      body,
      data: syncAlertData('48h-alert'),
    },
    trigger: null,
  });

  await AsyncStorage.setItem(storageKey, Date.now().toString());
}

/**
 * Read the researcher-tunable threshold from /config/support_chat. Cached
 * in-memory for the lifetime of this app session — researchers tweak it
 * rarely, so a one-shot read on first foreground is enough; the next cold
 * start picks up any change. Falls back to 48h on any error.
 */
let cachedThresholdHours: number | null = null;

export async function getSyncThresholdHours(): Promise<number> {
  if (cachedThresholdHours != null) return cachedThresholdHours;
  try {
    const snap = await getDoc(doc(db, 'config', 'support_chat'));
    const raw = snap.exists() ? snap.data()?.syncThresholdHours : null;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 720) {
      cachedThresholdHours = n;
      return n;
    }
  } catch (err) {
    // Patients lack read access to /config; that's expected. Default silently.
  }
  cachedThresholdHours = 48;
  return 48;
}

async function getSyncThresholdMs(): Promise<number> {
  const hours = await getSyncThresholdHours();
  return hours * 60 * 60 * 1000;
}

/**
 * Returns the iPhone's most recent HealthKit signal as ms-since-epoch, or
 * null if HealthKit returned nothing in the lookback window. We define a
 * "signal" as a day that recorded ANY of steps / active energy / exercise —
 * matches what we use to decide whether the watch is being worn. The lookback
 * is intentionally wider than the configured threshold so we can compute an
 * accurate "X days ago" elapsed string even when the threshold is short.
 */
async function getLastHealthKitSyncMs(): Promise<number | null> {
  if (Platform.OS !== 'ios') return Date.now();
  try {
    const now = new Date();
    // 14-day lookback gives us a rich enough horizon for the elapsed-time
    // strings ("12 days ago") without being so wide we burn HK query budget.
    const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const activity = await getDailyActivity({ startDate: cutoff, endDate: now });
    let latest: number | null = null;
    for (const day of activity) {
      if (day.steps <= 0 && day.activeEnergyBurned <= 0 && day.exerciseMinutes <= 0) continue;
      // `day.date` is a YYYY-MM-DD string for the local-day bucket. Use the
      // END of the day as the activity timestamp — this slightly under-
      // estimates the freshness of TODAY's sync (we don't know the exact
      // last-sample time without querying samples) but is fine for an
      // "X days ago" UX.
      const ts = new Date(`${day.date}T23:59:00`).getTime();
      if (latest == null || ts > latest) latest = ts;
    }
    return latest;
  } catch {
    return null;
  }
}

async function getLastThroneSyncMs(): Promise<number | null> {
  try {
    const latest = await ThroneService.getLatestMeasurement();
    if (!latest) return null;
    return new Date(latest.timestamp).getTime();
  } catch {
    return null;
  }
}

async function hasRecentHealthKitData(): Promise<{ ok: boolean; elapsedMs: number | null }> {
  const lastMs = await getLastHealthKitSyncMs();
  if (lastMs == null) return { ok: false, elapsedMs: null };
  const elapsedMs = Date.now() - lastMs;
  const thresholdMs = await getSyncThresholdMs();
  return { ok: elapsedMs < thresholdMs, elapsedMs };
}

async function hasRecentThroneData(): Promise<{ ok: boolean; elapsedMs: number | null }> {
  const lastMs = await getLastThroneSyncMs();
  if (lastMs == null) return { ok: false, elapsedMs: null };
  const elapsedMs = Date.now() - lastMs;
  const thresholdMs = await getSyncThresholdMs();
  return { ok: elapsedMs < thresholdMs, elapsedMs };
}

export async function triggerTestNotification(source: StaleSyncSource): Promise<void> {
  const thresholdHours = await getSyncThresholdHours();
  // Pretend it's been (threshold + 1)h since last sync — body shows the
  // immediate-fire copy with that elapsed.
  const fakeElapsedMs = (thresholdHours + 1) * 60 * 60 * 1000;
  await Notifications.scheduleNotificationAsync({
    identifier: `${NOTIFICATION_IDS[source]}-test`,
    content: {
      title: `[TEST] ${NOTIFICATION_CONTENT[source].title}`,
      body: NOTIFICATION_CONTENT[source].immediateBody(fakeElapsedMs),
    },
    trigger: null,
  });
}

/**
 * Schedule a notification ~5 days after enrollment to remind the patient
 * that their Throne One should be arriving. If the device hasn't produced
 * data after 7 days, fire a follow-up setup reminder.
 *
 * Call once after onboarding completes. Safe to call multiple times —
 * existing scheduled notifications are cancelled before re-scheduling.
 */
export async function scheduleThroneArrivalNotification(enrolledAt: Date): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const msSinceEnrollment = Date.now() - enrolledAt.getTime();

  // ~5 days post-enrollment: "Your Throne One should be arriving soon!"
  const arrivalDelay = DAYS_5 - msSinceEnrollment;
  if (arrivalDelay > 0) {
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.throneArrival).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_IDS.throneArrival,
      content: {
        title: 'Your Throne One is arriving soon!',
        body: 'Your Throne One smart toilet sensor should be arriving soon. Tap here for setup instructions.',
        data: { screen: 'throne-setup-guide' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.round(arrivalDelay / 1000),
      },
    });
  }

  // ~7 days post-enrollment: follow-up if no data yet
  const setupDelay = DAYS_7 - msSinceEnrollment;
  if (setupDelay > 0) {
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.throneSetupReminder).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_IDS.throneSetupReminder,
      content: {
        title: 'Have you set up your Throne One?',
        body: "If your device has arrived, make sure to set it up using the same email as your StreamSync account. Tap for instructions.",
        data: { screen: 'throne-setup-guide' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.round(setupDelay / 1000),
      },
    });
  }
}

/**
 * Schedule IPSS survey reminder notifications.
 *
 * For each due date, fires notifications at: 1 day before, day-of, and 1 day after.
 * Surgery pathway: 30, 60, 90 days post-surgery.
 * UDS pathway: 14 days post-urodynamics.
 */
export async function scheduleIPSSNotifications(
  pathway: 'surgery' | 'uds',
  anchorDateStr: string,
): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const allIds = [
    'ipss-1-month-pre',
    'ipss-1-month-due',
    'ipss-1-month-post',
    'ipss-2-month-pre',
    'ipss-2-month-due',
    'ipss-2-month-post',
    'ipss-3-month-pre',
    'ipss-3-month-due',
    'ipss-3-month-post',
    'ipss-post-uds-pre',
    'ipss-post-uds-due',
    'ipss-post-uds-post',
  ];

  await Promise.all(
    allIds.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})),
  );

  const anchor = new Date(anchorDateStr + 'T12:00:00');

  const dueDates: { label: string; dayOffset: number }[] =
    pathway === 'surgery'
      ? [
          { label: '1-Month', dayOffset: 30 },
          { label: '2-Month', dayOffset: 60 },
          { label: '3-Month', dayOffset: 90 },
        ]
      : [
          { label: 'Post-UDS', dayOffset: 14 },
        ];

  for (const { label, dayOffset } of dueDates) {
    const dueDate = new Date(anchor);
    dueDate.setDate(dueDate.getDate() + dayOffset);

    // Schedule notifications at -1, 0, +1 day offsets from due date
    const offsets = [
      { suffix: 'pre', daysFromDue: -1, title: 'IPSS Survey Due Tomorrow', body: `Your ${label} IPSS questionnaire is due tomorrow. Tap to complete it.` },
      { suffix: 'due', daysFromDue: 0, title: 'IPSS Survey Due Today', body: `Your ${label} IPSS questionnaire is due today. Tap to complete it now.` },
      { suffix: 'post', daysFromDue: 1, title: 'IPSS Survey Reminder', body: `Your ${label} IPSS questionnaire was due yesterday. Please complete it as soon as possible.` },
    ];

    for (const { suffix, daysFromDue, title, body } of offsets) {
      const notifDate = new Date(dueDate);
      notifDate.setDate(notifDate.getDate() + daysFromDue);
      notifDate.setHours(9, 0, 0, 0); // Fire at 9 AM local

      const delayMs = notifDate.getTime() - Date.now();
      if (delayMs <= 0) continue; // Skip past dates

      const id = `ipss-${label.toLowerCase().replace(/\s+/g, '-')}-${suffix}`;
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title,
          body,
          data: { screen: 'questionnaire/ipss' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.round(delayMs / 1000),
        },
      });
    }
  }
}

export async function checkAndScheduleReminders(): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // Re-read the threshold each foreground so a researcher's tweak in the
  // dashboard takes effect within one app-resume.
  cachedThresholdHours = null;
  await getSyncThresholdHours(); // populates cache for the freshness checks

  // STEP 1 — wipe every still-scheduled stale-sync notification for both
  // sources, regardless of which build of the code put them there. This
  // is the key change vs. the prior version: even when the data is
  // currently healthy we don't keep a "safety net" reminder lurking. If
  // pre-scheduled fires are already on iOS's queue with stale bodies
  // (because the user synced after we scheduled), they get cleared here.
  await Promise.all([
    cancelAllSyncReminders('healthkit'),
    cancelAllSyncReminders('throne'),
  ]);

  // STEP 2 — read the live freshness of both data sources.
  const [healthKitState, throneState] = await Promise.all([
    hasRecentHealthKitData(),
    hasRecentThroneData(),
  ]);

  // STEP 3 — for each source, fire ONLY if currently stale.
  // We deliberately do NOT pre-schedule a "haven't seen sync in N hours"
  // reminder when data is healthy; that's what produced the false-positive
  // notifications the user reported on 2026-05-13 (notification body said
  // "hasn't synced in 24 hours" while the chat banner correctly showed
  // a fresh sync). When the user does go stale, they'll see the immediate
  // fire on next app foreground AND a follow-up series during waking hours.
  if (!healthKitState.ok) {
    await fireImmediateReminder('healthkit', healthKitState.elapsedMs);
    await startRepeatingReminder('healthkit');
  }

  if (!throneState.ok) {
    await fireImmediateReminder('throne', throneState.elapsedMs);
    await startRepeatingReminder('throne');
  }
}
