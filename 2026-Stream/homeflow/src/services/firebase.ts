/**
 * Firebase Client SDK initialization for StreamSync.
 *
 * Config is read from EXPO_PUBLIC_FIREBASE_* env vars at build time. No
 * hardcoded fallbacks — a missing var fails the build loudly. The literal-
 * string default that used to live here was removed on 2026-05-10 after a
 * deleted Firebase Web API key was found in git history; the canonical
 * implementation now lives in lib/firebase.ts and the rationale is
 * documented there. This file deliberately mirrors that pattern so the
 * dual-init path (lib/firebase initializes auth, src/services/firebase
 * initializes Firestore) stays consistent.
 */

import {initializeApp, getApps, getApp} from "firebase/app";
import {getFirestore} from "firebase/firestore";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("YOUR_FIREBASE_")) {
    throw new Error(
      `[Firebase] Missing required env var "${name}". Copy ` +
        ".env.example to .env at 2026-Stream/homeflow/ and fill in your " +
        "Firebase Web SDK config (Project settings → Your apps → Firebase " +
        "SDK snippet (Config) in the Firebase Console).",
    );
  }
  return value;
}

const firebaseConfig = {
  projectId: requireEnv("EXPO_PUBLIC_FIREBASE_PROJECT_ID"),
  appId: requireEnv("EXPO_PUBLIC_FIREBASE_APP_ID"),
  storageBucket: requireEnv("EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET"),
  apiKey: requireEnv("EXPO_PUBLIC_FIREBASE_API_KEY"),
  authDomain: requireEnv("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  messagingSenderId: requireEnv("EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
console.log("[Firebase] Active projectId:", getApp().options.projectId);
export const db = getFirestore(app);
