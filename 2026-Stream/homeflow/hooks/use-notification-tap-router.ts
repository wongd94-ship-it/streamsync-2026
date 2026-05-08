/**
 * Routes notification taps to the right in-app screen.
 *
 * The notification scheduler stamps a `data` payload onto each notification
 * (see notification-service.syncAlertData). When the user taps a notification,
 * iOS delivers it through addNotificationResponseReceivedListener; we read
 * `data.screen` and push the matching route.
 *
 * IMPORTANT: this hook ADDS a tap handler — it does NOT touch the foreground
 * presentation logic (NotificationHandler) or the scheduling code, so existing
 * sync-alert notifications keep firing exactly as before. Only the tap path
 * is new.
 *
 * Cold-start vs warm-tap:
 *   - Warm tap: addNotificationResponseReceivedListener fires immediately.
 *   - Cold start: getLastNotificationResponseAsync returns the launch tap
 *     once on mount, and we route from there.
 */

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';

type ScreenRoute = 'support-chat' | 'throne-setup-guide' | 'questionnaire/ipss';

interface NotificationData {
  screen?: ScreenRoute;
  trigger?: '48h-alert' | '5d-alert' | 'participant-initiated';
}

function readData(response: Notifications.NotificationResponse | null): NotificationData | null {
  if (!response) return null;
  const data = response.notification.request.content.data;
  if (!data || typeof data !== 'object') return null;
  return data as NotificationData;
}

function buildHref(data: NotificationData): Href | null {
  switch (data.screen) {
    case 'support-chat':
      return {
        pathname: '/support-chat',
        params: { trigger: data.trigger ?? '48h-alert' },
      } as unknown as Href;
    case 'throne-setup-guide':
      return '/throne-setup-guide' as unknown as Href;
    case 'questionnaire/ipss':
      return '/questionnaire/ipss' as unknown as Href;
    default:
      return null;
  }
}

/**
 * Wires the notification-tap router. Call once near the root of the
 * authenticated tree — after auth and onboarding are confirmed, so that
 * pushing a route doesn't fight with the redirect guards in _layout.tsx.
 */
export function useNotificationTapRouter(active: boolean): void {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    // Cold-start: did the app launch FROM a notification tap?
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (cancelled) return;
        const data = readData(response);
        const href = data ? buildHref(data) : null;
        if (href) router.push(href);
      })
      .catch(() => { /* ignore — best-effort */ });

    // Warm tap: user tapped a notification while the app was open.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = readData(response);
      const href = data ? buildHref(data) : null;
      if (href) router.push(href);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [active, router]);
}
