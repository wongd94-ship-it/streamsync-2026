/**
 * Firebase Initialization
 *
 * Initializes Firebase app and auth for the Expo managed workflow.
 * Uses the JS SDK with AsyncStorage persistence (no native Firebase SDK needed).
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
// @ts-expect-error - getReactNativePersistence exists at runtime but is missing from some type defs
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Firebase config is read from EXPO_PUBLIC_FIREBASE_* env vars at build time.
 * No hardcoded fallbacks — a missing var fails the build loudly so we never
 * accidentally ship the literal-string default that was previously checked in
 * (see git history pre-2026-05-10 for the deletion). Local dev: copy
 * .env.example → .env and fill in your Firebase Web SDK config from
 * https://console.firebase.google.com/project/<project-id>/settings/general.
 *
 * Even though Google documents Web SDK config as "not strictly secret"
 * (security comes from referrer/bundle-id restrictions + Firestore rules),
 * we keep the key out of source so:
 *   1. We can rotate it without touching the codebase.
 *   2. Different deployment environments (dev / staging / prod) can use
 *      different keys with different restrictions.
 *   3. Forks of the public repo don't ship our specific project config.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith('YOUR_FIREBASE_')) {
    throw new Error(
      `[Firebase] Missing required env var "${name}". ` +
        'Copy .env.example to .env at 2026-Stream/homeflow/ and fill in your ' +
        'Firebase Web SDK config from console.firebase.google.com → Project ' +
        'settings → General → Your apps → Firebase SDK snippet (Config).',
    );
  }
  return value;
}

const firebaseConfig = {
  apiKey: requireEnv('EXPO_PUBLIC_FIREBASE_API_KEY'),
  authDomain: requireEnv('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'),
  projectId: requireEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
  storageBucket: requireEnv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requireEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
  appId: requireEnv('EXPO_PUBLIC_FIREBASE_APP_ID'),
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Auth persistence — MUST be initialized with getReactNativePersistence so
// the session survives force-quit. The previous "only initializeAuth on
// first-app-init" pattern was racing with src/services/firebase.ts which
// calls initializeApp earlier: by the time lib/firebase.ts evaluated,
// getApps().length was already 1, we'd skip initializeAuth, and Firebase
// Auth would auto-initialize with default in-memory persistence on the
// first getAuth() call. Sessions then vanished on app relaunch.
//
// The correct pattern is to always call initializeAuth; it throws if
// already initialized (e.g. Fast Refresh in dev), in which case we fall
// back to getAuth to retrieve the existing instance (which by then has
// whatever persistence the first initializeAuth set).
function initializeAuthWithPersistence() {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (err) {
    // Typically "already-initialized-auth" from a hot reload. Use the
    // existing instance — its persistence was set by the first call.
    console.info('[Firebase] initializeAuth already done, reusing existing instance.');
    return getAuth(app);
  }
}

export const auth = initializeAuthWithPersistence();

export default app;
