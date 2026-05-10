/**
 * Firebase Client SDK initialization for StreamSync.
 *
 * Config is read from EXPO_PUBLIC_FIREBASE_* env vars at build time. No
 * hardcoded fallbacks — a missing var fails the build loudly. The literal-
 * string default that used to live here was removed on 2026-05-10 after a
 * deleted Firebase Web API key was found in git history; the canonical
 * implementation lives in lib/firebase.ts and the rationale + the static-
 * access pitfall are documented there.
 *
 * STATIC access required: Metro/Babel only inline EXPO_PUBLIC_* env vars
 * when the access is a literal property name on `process.env`. Don't
 * refactor these to use a dynamic key (e.g. `process.env[name]`) — the
 * bundler can't inline that and the value will be undefined at runtime.
 */

import {initializeApp, getApps, getApp} from "firebase/app";
import {getFirestore} from "firebase/firestore";

const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const authDomain = process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN;
const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;
const messagingSenderId = process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID;

function assertConfigured(name: string, value: string | undefined): string {
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
  projectId: assertConfigured("EXPO_PUBLIC_FIREBASE_PROJECT_ID", projectId),
  appId: assertConfigured("EXPO_PUBLIC_FIREBASE_APP_ID", appId),
  storageBucket: assertConfigured("EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET", storageBucket),
  apiKey: assertConfigured("EXPO_PUBLIC_FIREBASE_API_KEY", apiKey),
  authDomain: assertConfigured("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", authDomain),
  messagingSenderId: assertConfigured("EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", messagingSenderId),
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
console.log("[Firebase] Active projectId:", getApp().options.projectId);
export const db = getFirestore(app);
