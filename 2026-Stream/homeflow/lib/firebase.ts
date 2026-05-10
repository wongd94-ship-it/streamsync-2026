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

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCA2UXlewWfadoemw4EinfMLyif6PgPyj4',
  authDomain: 'streamsync-8ae79.firebaseapp.com',
  projectId: 'streamsync-8ae79',
  storageBucket: 'streamsync-8ae79.firebasestorage.app',
  messagingSenderId: '295202330543',
  appId: '1:295202330543:web:9088db3e1f27518597015a',
};

function fromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value || value.startsWith('YOUR_FIREBASE_')) {
    return fallback;
  }
  return value;
}

const firebaseConfig = {
  apiKey: fromEnv('EXPO_PUBLIC_FIREBASE_API_KEY', DEFAULT_FIREBASE_CONFIG.apiKey),
  authDomain: fromEnv('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', DEFAULT_FIREBASE_CONFIG.authDomain),
  projectId: fromEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID', DEFAULT_FIREBASE_CONFIG.projectId),
  storageBucket: fromEnv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', DEFAULT_FIREBASE_CONFIG.storageBucket),
  messagingSenderId: fromEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', DEFAULT_FIREBASE_CONFIG.messagingSenderId),
  appId: fromEnv('EXPO_PUBLIC_FIREBASE_APP_ID', DEFAULT_FIREBASE_CONFIG.appId),
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
