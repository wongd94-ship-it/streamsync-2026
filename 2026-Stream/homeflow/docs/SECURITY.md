# StreamSync — Secrets & Credentials Handling

## TL;DR

| What | Where it lives | What you do locally |
|---|---|---|
| **Firebase Web SDK config** (apiKey, authDomain, projectId, etc.) | `.env` at `2026-Stream/homeflow/.env` — gitignored | Copy `.env.example` → `.env`, paste values from Firebase Console |
| **Anthropic API key** | Firebase Secret Manager (`firebase functions:secrets:set ANTHROPIC_API_KEY`) — never on disk | You don't see it; the Cloud Function reads it at runtime |
| **Throne API key + base URL + admin token** | Firebase Secret Manager (same pattern) | Same — server-side only |
| **OpenAI key** | Not used (legacy chat removed 2026-05-07). If you re-introduce, use Secret Manager. | n/a |
| **Apple Developer / signing certs** | Xcode keychain (managed by Apple Developer team) | Sign in to Xcode → Settings → Accounts |
| **Google OAuth client ID** | Hardcoded in source — these are **not secret** (Google docs) | Nothing — public by design |

## The one-page workflow for a new developer joining the project

1. **Clone the repo:** `git clone git@github.com:wongd94-ship-it/streamsync-2026.git`
2. **Install deps:** `cd 2026-Stream/homeflow && npm install`
3. **Set up `.env`:**
   ```bash
   cp .env.example .env
   ```
4. **Get the Firebase Web SDK config** from Firebase Console:
   - Open https://console.firebase.google.com/project/streamsync-8ae79/settings/general
   - Scroll to **Your apps** → select the web app
   - Under **SDK setup and configuration** → choose **Config**
   - Copy each field into your local `.env`:
     - `apiKey` → `EXPO_PUBLIC_FIREBASE_API_KEY=...`
     - `authDomain` → `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...`
     - `projectId` → `EXPO_PUBLIC_FIREBASE_PROJECT_ID=...`
     - `storageBucket` → `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...`
     - `messagingSenderId` → `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...`
     - `appId` → `EXPO_PUBLIC_FIREBASE_APP_ID=...`
5. **Start the app:** `npx expo start --clear` (or `npm run ios:device:release` for an on-phone Release build)

If you see `[Firebase] Missing required env var "EXPO_PUBLIC_FIREBASE_API_KEY"` at boot, your `.env` is missing or your values are blank.

## Why this layout

- **Firebase Web SDK config is public-by-design** ([Google docs](https://firebase.google.com/docs/projects/api-keys#api-keys-for-firebase-are-different)). Security comes from:
  1. **API key restrictions** in Google Cloud Console (HTTP referrers for web, iOS bundle ID for mobile)
  2. **Firestore security rules** (gating who can read/write what)
  3. **Firebase Auth** (gating who's signed in)
- We still keep these values out of source code so:
  - We can rotate them without touching the codebase (we did exactly this on 2026-05-10 after the original key leaked in git history)
  - Different deployment environments (dev / staging / prod) can use different keys with different restrictions
  - Forks of the public repo don't ship our specific project config
- **Server-side secrets** (Anthropic, Throne, admin tokens) **never touch disk on a developer machine**. They live in Firebase Secret Manager. The Cloud Functions read them at runtime via `process.env.ANTHROPIC_API_KEY` etc., backed by Google's KMS-encrypted secret store.

## Researcher dashboard (`dashboard-public/dashboard/index.html`)

The dashboard is a static HTML file served via Firebase Hosting. It does **not** embed the Firebase Web SDK config inline. Instead, it loads `/__/firebase/init.js` — an endpoint Firebase Hosting auto-serves with the project's config. The key never appears in source.

For local development against a static-file dev server (not Firebase Hosting), drop a non-gitignored file at `dashboard-public/dashboard/firebase-config.js` containing:

```javascript
firebase.initializeApp({
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
});
```

…and include it via a `<script>` tag before the inline init script. The recommended local-dev workflow is `firebase serve --only hosting` which emulates Hosting and serves `/__/firebase/init.js` correctly.

## Adding a new server-side secret

```bash
cd 2026-Stream/homeflow
firebase functions:secrets:set MY_NEW_SECRET --project streamsync-8ae79
# Paste the value when prompted; it goes to Secret Manager + grants the
# default Cloud Functions service account read access.
```

Reference it in a Cloud Function:

```typescript
export const myFn = onRequest(
  { secrets: ["MY_NEW_SECRET"] },
  async (req, res) => {
    const value = process.env.MY_NEW_SECRET;
    // …
  },
);
```

Then redeploy: `firebase deploy --only functions:myFn`.

## If a secret leaks

In order:

1. **Rotate immediately** — generate a new value via the issuing console (Google Cloud, Anthropic, Throne, etc.) and update wherever it's consumed.
2. **Delete or revoke the old value** so anyone who scraped it before you noticed can't use it.
3. **Restrict the new value** as appropriate (HTTP referrer + iOS bundle ID for Google API keys, IP allowlist for server-to-server keys, etc.).
4. **Verify the source code no longer contains it** (`git grep -E "PATTERN"`).
5. **Optional — git history rewrite** to scrub the old value from past commits. Use `git filter-repo --replace-text` and force-push. Note: this requires every collaborator to re-clone, and doesn't help if anyone scraped the public repo before you scrubbed. **Rotation does more than history rewrite.**

## What's already been audited (2026-05-10)

A comprehensive secret scan found:

| Pattern | Result |
|---|---|
| `AIzaSy*` (Google API keys) | One leaked, rotated, removed from source + this commit |
| `sk-ant-*` (Anthropic) | None in source — correctly in Secret Manager |
| `AKIA*` (AWS) | None |
| `xox[bpars]-*` (Slack) | None |
| `gh[oprsu]_*` (GitHub tokens) | None |
| `sk_live_*` (Stripe) | None |
| `SG.*` (SendGrid) | None |
| `AC*` (Twilio account SID) | None |
| Inline JWT tokens | None |
| `client_secret`-style real values | None |
| Private keys (RSA/EC/OPENSSH/etc.) | None in repo code (third-party `node_modules/` excluded) |
| Service-account JSON | None |
| `*.p8` / `*.p12` / `*.pem` | None |
| OAuth `*.apps.googleusercontent.com` IDs | Present in source — these are public identifiers, not secrets (per Google docs) |

Re-run the audit before each release:

```bash
git grep -nE "AIza[0-9A-Za-z_-]{35}|sk-ant-api[0-9]{2}-|AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]+|xox[bpars]-[0-9A-Za-z-]+" 2>/dev/null | grep -v node_modules
```

If anything comes back, treat as a fresh leak and follow the procedure above.
