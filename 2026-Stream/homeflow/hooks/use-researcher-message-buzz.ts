/**
 * Subscribes to the participant's most recent open support chat and fires a
 * **local** notification whenever a researcher message lands. Works while the
 * app is in the foreground OR backgrounded recently enough that iOS still
 * runs the Firestore snapshot listener (the OS reclaims background tasks
 * after a few minutes, so this is not a substitute for true remote push).
 *
 * Why not Expo/APNs remote push:
 *   The free/personal Apple Developer tier does NOT include the Push
 *   Notifications capability — adding `aps-environment` to entitlements
 *   makes Xcode refuse to build a provisioning profile. Once the team is
 *   upgraded to the $99/yr Apple Developer Program, the Cloud Function
 *   `notifyOnSupportMessage` + `useExpoPushRegistration` will start working
 *   end-to-end with no further code changes — both are already wired up.
 *
 * Until then, this hook + the floating support bubble's badge cover the
 * "live while the app is open" case, which is the common path.
 */

import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { Timestamp } from 'firebase/firestore';
import {
  subscribeToActiveChat,
  type ActiveChatStatus,
} from '@/lib/services/support-chat-service';
import { useAuth } from '@/hooks/use-auth';

// We only fire a buzz when the unread count *increases* — not on every
// rerender of the listener. Track the last seen count per chatId so a stale
// count of "3" coming back after a re-attach doesn't re-buzz the same
// messages.
const _lastSeenCount: Map<string, number> = new Map();

async function fireBuzz(chatId: string, body: string): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      identifier: `support-researcher-${chatId}-${Date.now()}`,
      content: {
        title: 'StreamSync Research Team',
        body,
        sound: 'default',
        data: {
          screen: 'support-chat',
          trigger: 'participant-initiated',
          chatId,
        },
      },
      trigger: null, // fire immediately
    });
  } catch (err) {
    console.warn('[researcher-buzz] notification fire failed', err);
  }
}

export function useResearcherMessageBuzz(active: boolean): void {
  const { isAuthenticated } = useAuth();
  // Track the FIRST status we receive — we want to ignore the count that
  // surfaces on initial attach (it represents existing unread state, not
  // a new message). Only deltas after that should buzz.
  const seenInitialRef = useRef(false);

  useEffect(() => {
    if (!active || !isAuthenticated) return;
    seenInitialRef.current = false;

    const unsub = subscribeToActiveChat(
      (status: ActiveChatStatus) => {
        const { chatId, unreadResearcherMessages: count } = status;
        if (!chatId) {
          seenInitialRef.current = true;
          return;
        }
        const previous = _lastSeenCount.get(chatId) ?? 0;
        _lastSeenCount.set(chatId, count);

        if (!seenInitialRef.current) {
          seenInitialRef.current = true;
          return;
        }
        if (count > previous) {
          // A researcher message arrived since the last snapshot. Fire a
          // single buzz with a generic body — we don't have the message
          // text in the ActiveChatStatus payload, and pulling it would
          // need another listener. The user opens the chat to read.
          const newCount = count - previous;
          const body = newCount === 1
            ? 'New message from the StreamSync research team. Tap to read.'
            : `${newCount} new messages from the research team. Tap to read.`;
          fireBuzz(chatId, body).catch(() => {});
        }
      },
      (err) => console.warn('[researcher-buzz] subscribe error', err.message),
    );
    return unsub;
  }, [active, isAuthenticated]);
}
