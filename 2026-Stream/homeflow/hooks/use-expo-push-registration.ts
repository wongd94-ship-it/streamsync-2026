/**
 * Registers the iPhone for Expo push notifications and saves the resulting
 * token to /users/{uid}.expoPushTokens. The Cloud Function `notifyOnSupportMessage`
 * reads that array and POSTs to https://exp.host/--/api/v2/push/send when a
 * researcher writes into a chat — that's what makes the phone buzz live.
 *
 * Why Expo Push and not raw APNs/FCM:
 *   - The project is EAS-managed (projectId set in app.config.js → extra.eas).
 *   - Expo handles APNs key + cert rotation; we only need a token.
 *   - One HTTP call per push, no Firebase Admin Messaging dance.
 *
 * Tokens are stored as an array (one user can install on multiple devices).
 * Stale tokens are pruned by the Cloud Function the first time it sees a
 * "DeviceNotRegistered" error from Expo's response.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  arrayRemove,
  arrayUnion,
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import Constants from 'expo-constants';
import { db, getAuth } from '@/src/services/firestore';

// Module-level guard — survives Fast Refresh + multiple mounts. We only need
// to register once per uid per session.
const _registeredUids = new Set<string>();

function getEasProjectId(): string | null {
  // EAS project id lives in `extra.eas.projectId` in app.config.js. Constants
  // exposes it via expoConfig.extra (or manifestExtra in older versions).
  const fromExpoConfig = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof fromExpoConfig === 'string' && fromExpoConfig) return fromExpoConfig;
  const fromManifest = (Constants as { manifest?: { extra?: { eas?: { projectId?: string } } } })
    .manifest?.extra?.eas?.projectId;
  if (typeof fromManifest === 'string' && fromManifest) return fromManifest;
  return null;
}

async function registerOnce(uid: string): Promise<void> {
  if (_registeredUids.has(uid)) return;
  _registeredUids.add(uid);

  if (Platform.OS === 'web') return;
  // Push tokens require a real device. On simulators, getExpoPushTokenAsync
  // either throws or returns an unusable token — we let the try/catch below
  // handle that path rather than dragging in expo-device just for a check.

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const { status: requested } = await Notifications.requestPermissionsAsync();
    status = requested;
  }
  if (status !== 'granted') {
    console.info('[push] permission denied, no token will be registered');
    return;
  }

  const projectId = getEasProjectId();
  if (!projectId) {
    console.warn('[push] no EAS projectId configured — push tokens unavailable');
    return;
  }

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch (err) {
    console.warn('[push] getExpoPushTokenAsync failed', err);
    return;
  }

  if (!token || !token.startsWith('ExponentPushToken')) {
    console.warn('[push] unexpected token shape, skipping save');
    return;
  }

  try {
    // Append-only — multiple devices per user. The Cloud Function prunes
    // tokens that come back as DeviceNotRegistered.
    await setDoc(
      doc(db, 'users', uid),
      {
        expoPushTokens: arrayUnion(token),
        expoPushTokenUpdatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.warn('[push] failed to save token to /users', err);
  }
}

/**
 * Hook entry point. Mount once near the root of the authenticated tree.
 * No-ops while signed out so this can sit in the same useEffect tree as
 * the other auth-gated hooks.
 */
export function useExpoPushRegistration(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    registerOnce(uid).catch((err) => {
      console.warn('[push] registration error', err);
    });
  }, [active]);
}

/**
 * Best-effort cleanup. Called from the sign-out flow so a previously
 * registered token isn't left attached to a user that's signed out.
 *
 * Note: Expo will keep delivering pushes to the device until the OS rotates
 * the token, so this is a UX nicety (don't notify a previous user's account)
 * not a security boundary.
 */
export async function unregisterExpoPushToken(uid: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const projectId = getEasProjectId();
    if (!projectId) return;
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = result.data;
    if (!token) return;
    await setDoc(
      doc(db, 'users', uid),
      { expoPushTokens: arrayRemove(token) },
      { merge: true },
    );
  } catch {
    // best-effort
  }
}
