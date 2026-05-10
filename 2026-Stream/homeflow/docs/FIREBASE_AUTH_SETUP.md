# Firebase Auth Setup

## The Problem

When running the app in the iOS Simulator (or any React Native context) against
the production Firebase project, account creation fails with:

```
auth/requests-from-referer-<empty>-are-blocked
```

This happens because the Firebase JS SDK sends requests with an empty HTTP
Referer header, and the production API key (the value of
`EXPO_PUBLIC_FIREBASE_API_KEY` in `.env`) has "HTTP referrers" restrictions
set in Google Cloud Console → APIs & Services → Credentials.

There are two supported fixes — pick one based on whether you're doing local
development or testing against real Firebase resources.

---

## Option A — Local development (recommended)

Run the Firebase Emulator Suite locally. The emulator ignores API-key referer
restrictions entirely, so no console changes are needed.

1. **Install the Firebase CLI** (one-time, if you don't already have it):

   ```bash
   npm install -g firebase-tools
   firebase login
   ```

2. **Start the emulators** from the `homeflow/` directory:

   ```bash
   firebase emulators:start --only auth,firestore --project streamsync-8ae79
   ```

   This starts Auth on `127.0.0.1:9099` and Firestore on `127.0.0.1:8080`.

3. **Enable emulator mode in the app** — copy `.env.example` to `.env` if you
   haven't already, and set:

   ```
   EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true
   ```

4. **Restart Expo** (`npx expo start --clear`). The Metro console should log:

   ```
   [Firebase] Connected to emulator suite: { auth: http://127.0.0.1:9099, firestore: 127.0.0.1:8080 }
   ```

Accounts created in the emulator do **not** persist between restarts and do
**not** hit the production project. Perfect for simulator testing.

---

## Option B — Real Firebase (TestFlight / on-device QA)

Fix the API-key restriction in Google Cloud Console so React Native requests
are accepted.

1. Open https://console.cloud.google.com/apis/credentials?project=streamsync-8ae79
2. Find the API key used by the iOS app (the value of
   `EXPO_PUBLIC_FIREBASE_API_KEY` in your local `.env`) and click **Edit**.
3. Under **Application restrictions**:
   - **Current requirement for this app:** choose **None**.
     StreamSync currently uses the Firebase JavaScript SDK inside React Native,
     and these auth requests do not reliably satisfy Google Cloud's
     `iOS apps` application restriction checks. In practice that still causes
     account creation to fail even on a real iPhone build.
   - Keep **API restrictions** enabled so the key is still limited to Firebase
     services only.
   - If you later migrate auth to the native Firebase iOS SDK, re-evaluate
     whether an `iOS apps` restriction can be reintroduced safely.
4. Under **API restrictions**: ensure **Identity Toolkit API** and
   **Cloud Firestore API** are in the allow-list.
5. Click **Save**. Changes propagate within ~5 minutes.

If you prefer not to change the existing key, create a separate mobile-testing
key with **Application restrictions = None** and export it via
`EXPO_PUBLIC_FIREBASE_API_KEY` in `.env`.

---

## Verifying the fix

1. Run through onboarding in the simulator until the **Create Account** screen.
2. Enter any test email/password and tap **Create Account**.
3. Expected: the app advances to Permissions (no `auth/...` alert).
4. In the Firebase console (or emulator UI at http://127.0.0.1:4000) you
   should see the new user and a `users/{uid}` Firestore document.
