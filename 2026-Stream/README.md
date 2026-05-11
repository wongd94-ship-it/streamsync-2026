# Streamsync

A multi-center digital-health research app. Streamsync helps men with BPH (benign prostatic hyperplasia) passively track their voiding patterns, sleep, and activity before and after bladder outlet surgery, so researchers can measure real-world functional improvement and use rich digital data to predict patients most likely to benefit from intervention.

The app is institutionally agnostic and is being piloted across multiple academic medical centers participating in the BPH Research Consortium.

---

## What it does

Right now, when a patient has bladder outlet surgery, the main outcome measure is a questionnaire they fill out in a waiting room. Streamsync replaces that with continuous, passive data collection at home using hardware and sensors the patient already has.

The study has **two pathways** and the app adapts to whichever one a participant is on:

- **Pathway A — Urodynamics:** ≥2 weeks of pre-UDS monitoring → urodynamics → 2 weeks post-UDS monitoring. Some patients proceed to surgery and transition into Pathway B.
- **Pathway B — BPH Surgery:** ≥2 weeks of pre-surgery monitoring → surgery (HoLEP, TURP, UroLift, Rezum, etc.) → 12 weeks of post-surgery monitoring with IPSS surveys at baseline, 1, 2, and 3 months.

Concretely, the app:

- Records every void from a **Throne One smart toilet** (flow rate, volume, flow-curve shape), pulled via the Throne API on a daily Cloud Function schedule and on app open
- Pulls **activity, sleep, resting heart rate, HRV, and other vitals** from Apple Watch and HealthKit on a once-per-day sync
- Collects a **baseline IPSS** at enrollment, then follow-up IPSS at 1, 2, and 3 months post-surgery (or a post-UDS IPSS for the urodynamics-only pathway)
- Walks participants through **8-step in-clinic onboarding** with research staff present — welcome → eligibility + pathway selection → informed consent + digital signature → account creation → permissions → medical history → baseline IPSS → complete
- Links Throne accounts to study accounts by **shared email** (no manual device IDs to type), and prompts the participant ~5 days after enrollment to set up their Throne One when it arrives by mail
- Surfaces a **pathway-aware dashboard** with phase indicators, surgery/UDS countdowns, recovery-week counter, IPSS milestones, and an adaptive Throne status card
- Lets participants view and edit their **BPH-related medications, conditions, and procedures**, pre-filled from Apple Health Clinical Records and SMART on FHIR
- Provides an **AI Support chat** (powered by Anthropic's Claude) accessible from any screen via a floating bubble. The chat is study-aware (knows the participant's pathway, consent state, UDS/surgery date, current sync recency) and answers questions about the study, troubleshoots Throne/Watch setup, and routes researcher-initiated threads back to the participant
- Runs **adherence monitoring** in the background: when Throne or HealthKit data goes stale past a researcher-tunable threshold (12–168h, default 48h), the app schedules a local reminder that repeats every 4 hours until sync is restored
- Pushes everything to a **Firebase backend** (Firestore, Cloud Functions, Storage) for the research team to analyze, with a hosted researcher dashboard for thread management, sync-threshold tuning, and Morning Briefings

Once onboarding is done, the participant doesn't need to do anything — passive collection runs in the background.

---

## The participant journey

Onboarding is **in-person at the urology clinic** with research staff present. The Apple Watch is handed over at the visit; the Throne One ships separately and arrives by mail in ~4 business days. Target onboarding time: under 15 minutes.

```
Enrollment visit at the clinic
    ↓
1. Welcome           — what the study is, what data is collected, how long
    ↓
2. Eligibility       — confirm BPH diagnosis, pick pathway (UDS / surgery / both),
                       collect anchor date(s)
    ↓
3. Consent           — IRB-reviewed consent doc, digital signature canvas
    ↓
4. Account           — email/password or Apple/Google SSO
                       (callout: use the same email for the Throne account)
    ↓
5. Permissions       — HealthKit (required), Clinical Records (optional),
                       SMART on FHIR (optional), notifications (required)
                       — no Throne setup yet; device hasn't arrived
    ↓
6. Medical history   — review pre-filled meds, conditions, procedures, labs
    ↓
7. Baseline IPSS     — 8-question IPSS, score + severity shown to participant
    ↓
8. Complete          — summary of what happens next, IPSS follow-up tasks scheduled

Leave the clinic with the Apple Watch on.

~5 days later  → in-app notification: "Your Throne One should arrive soon — tap here"
                → in-app Throne setup guide reminds them to use the same email

Passive collection runs in the background.
Notifications and AI Support chat handle adherence + questions.

Pathway A (Urodynamics):  pre-UDS monitoring → UDS → 2 wk post-UDS → optional transition to Pathway B
Pathway B (Surgery):      pre-surgery monitoring → surgery → 12 wk recovery + IPSS at 1, 2, 3 mo
```

---

## Tech stack

| Layer | What we use |
|---|---|
| App framework | React Native 0.81 + Expo 54 + React 19, TypeScript |
| Navigation | Expo Router (file-based) |
| Auth | Firebase Auth with email/password and Google Sign-In |
| Health data | Apple HealthKit via `@kingstinct/react-native-healthkit` |
| Clinical records | Apple Health clinical records + SMART on FHIR provider connections |
| Uroflow data | Throne Research API via Firebase Cloud Functions + Firestore |
| Backend | Firebase (Firestore, Storage, Hosting, Cloud Functions) |
| Notifications | Expo Notifications |
| Forms and validation | Formik + Yup |
| Study workflows | `@spezivibe/scheduler`, `@spezivibe/questionnaire`, `@spezivibe/chat` |
| Native modules | Custom `expo-clinical-records` module for iOS clinical record access |

---

## Project structure

```text
homeflow/
  app/
    (onboarding)/              # 8-step onboarding (welcome → eligibility → consent → account → permissions → history → IPSS → complete)
    (auth)/                    # Login and signup
    (tabs)/                    # Home (pathway-aware dashboard), voiding, health, profile
    questionnaire/             # IPSS + eligibility questionnaire modal routes
    support-chat.tsx           # Full-screen AI Support chat modal
    _layout.tsx                # Root navigation, auth/onboarding guards, sync bootstrap, global support-chat bubble

  components/
    onboarding/                # Consent UI, progress, permission cards, continue buttons
    health/                    # Health summary cards (incl. BPH Clinical Records edit UI)
    home/                      # Pathway-aware dashboard cards (phase indicator, Throne status, IPSS due, etc.)
    support-chat/              # Floating chat bubble (SupportChatBubble) + message list components
    ui/                        # Shared primitives such as SignaturePad and loading states

  hooks/
    use-onboarding-status.ts   # Route gating based on onboarding completion
    use-ipss-task-setup.ts     # Seeds post-surgery IPSS follow-up tasks
    use-data-sync-check.ts     # Foreground adherence tick — detects Throne/HK staleness
    use-researcher-message-buzz.ts  # Foreground listener that buzzes on researcher chat replies
    use-health-summary.ts      # 3-day rolling averages for activity + vitals

  lib/
    auth/                      # Auth context over the selected account service
    consent/                   # Consent document source content
    questionnaires/            # Eligibility and IPSS definitions
    services/
      standard-context.tsx     # Standard pattern (use this — don't import backends directly)
      backend-factory.ts       # 'firebase' or 'local' backend selection
      account-service.ts       # Auth (login, register, SSO, password reset)
      onboarding-service.ts    # Onboarding step state machine
      throne-service.ts        # Throne integration
      notification-service.ts  # Local notifications, IPSS reminders, repeating sync nudges
      support-chat-service.ts  # Support chat client (startChat, send, subscribe, markRead)
      medical-history-edit.ts  # BPH clinical record edit + save with audit fields
      healthkit/               # HealthKit query + sync layer
      smart/                   # SMART on FHIR OAuth + sync
      fhir/                    # FHIR R4 parsing + condition/medication pattern matching
    tasks/                     # Scheduler task definitions

  src/services/
    clinicalNotesSync.ts       # Apple Health clinical note parsing + upload
    consentPdfSync.ts          # Signed consent PDF generation + Firebase sync
    fhirPrefillSync.ts         # HealthKit/SMART structured data prefill for medical history
    healthkitSync.ts           # Health metrics → Firestore sync (writes hk_sync/{metric})
    ipssScoreSync.ts           # Baseline/follow-up IPSS writes to Firestore
    throneFirestore.ts         # Throne reads plus root user / surgery / history writes
    firebase.ts                # Firebase init — env-only config, static process.env access (see SECURITY.md)

  functions/
    src/index.ts                       # Function entry points
    src/throneIngestion.ts             # Throne export normalization and Firestore fanout
    src/smartOnFhir.ts                 # SMART auth, token storage, clinical sync
    src/supportChat.ts                 # Anthropic-backed AI Support chat + PII firewall + study-context prompts
    src/notifyOnSupportMessage.ts      # Firestore trigger — pushes to participant on researcher reply
    src/throneSupportKnowledge.ts      # Throne support KB embedded in the system prompt
    src/appleHealthKnowledge.ts        # Apple Health / Watch / Clinical Records KB

  packages/
    chat/                      # Shared SpeziVibe chat package (forked from Stanford Spezi — MIT)
    questionnaire/             # Shared questionnaire package
    scheduler/                 # Shared scheduler package (forked from Stanford Spezi — MIT)

  dashboard-public/            # Firebase Hosting researcher dashboard (AI Support threads, sync-threshold slider, Morning Briefings)
  modules/expo-clinical-records/  # Local Expo module for Apple Health Clinical Records access
  docs/
    PRD.md                     # Product requirements
    SECURITY.md                # Secrets handling + .env workflow
    APPLE_DEVELOPER_HANDOFF.md # Push + Clinical Records entitlement handoff to UNR institutional team
  scripts/
    ios-device-release.sh      # Canonical Release build + install + launch (also `npm run ios:device:release`)
```

---

## Getting started

You'll need:
- macOS with Xcode installed
- A physical iPhone for the real HealthKit / clinical records flow (HealthKit data isn't available on the iOS Simulator)
- Node.js 18+
- Firebase CLI for deploys: `npm install -g firebase-tools`
- A `.env` file at `2026-Stream/homeflow/.env` — copy `.env.example` and fill in your Firebase Web SDK config. **See [docs/SECURITY.md](homeflow/docs/SECURITY.md) for the full secrets-handling workflow** (env vars are required; the app fails loudly at boot if any are missing).

```bash
# Install dependencies
cd 2026-Stream/homeflow
npm install

# Set up local env
cp .env.example .env
# …then fill in EXPO_PUBLIC_FIREBASE_* values from your Firebase Console

# Start the dev server (Metro)
npx expo start --clear

# Run typecheck / lint / tests
npm run typecheck
npm run lint
npm test

# Run on a physical iPhone — canonical command
# (Release build with the JS bundle embedded — works without a running Metro server)
npm run ios:device:release

# Build and run Cloud Functions locally
cd functions
npm install
npm run build

# Deploy Firebase resources from the app root
cd ..
firebase deploy --only firestore,storage,functions,hosting
```

Useful notes:
- **Always use `npm run ios:device:release` for on-device builds.** `expo run:ios --device` produces a Debug build that throws "no script URL provided" the moment Metro stops. The Release script (in `scripts/ios-device-release.sh`) handles signing, embeds the JS bundle, installs, and launches.
- `expo-notifications`, HealthKit, Google Sign-In, and the custom clinical records module require a native iOS build. Expo Go is not enough.
- The app has native `ios/` and `android/` folders checked in, plus EAS profiles in `eas.json`.
- Cloud Functions live in their own Node 20 workspace under `homeflow/functions`. Server-side secrets (Anthropic, Throne) live in Firebase Secret Manager — see SECURITY.md.

### Main scripts

```bash
npm start                   # expo start
npm run ios                 # expo run:ios (Debug — needs Metro running)
npm run ios:device:release  # Release build + install + launch on connected iPhone (use this)
npm run android             # expo run:android
npm run web                 # expo start --web
npm run lint
npm run typecheck
npm test
```

### Environment variables

**Canonical source: `2026-Stream/homeflow/.env.example`.** Copy it to `.env` and fill in the values. The app fails loudly at boot if any required value is missing — no hardcoded fallbacks.

Client / Expo app — required:

```text
# Backend selection ('firebase' for real auth + Firestore; 'local' is offline-only stub)
EXPO_PUBLIC_BACKEND_TYPE=firebase

# Firebase Web SDK — copy from Firebase Console → Project settings → Your apps
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
```

Client / Expo app — optional:

```text
EXPO_PUBLIC_FUNCTIONS_BASE_URL=                # Override Cloud Functions base URL (default: us-central1-<projectId>)
EXPO_PUBLIC_SMART_HEALTH_SYSTEMS_JSON=         # Inline SMART systems config for client-side launch
EXPO_PUBLIC_EPIC_CLIENT_ID=                    # Epic SMART client ID
EXPO_PUBLIC_USE_FIREBASE_EMULATOR=false        # Point Auth + Firestore at local emulators
EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=http://127.0.0.1:9099
EXPO_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

Server-side secrets — these **never touch disk on a dev machine**. They live in Firebase Secret Manager and are wired to Cloud Functions at runtime:

```text
ANTHROPIC_API_KEY        # AI Support chat
THRONE_API_KEY           # Throne uroflow API
THRONE_BASE_URL
THRONE_STUDY_ID
THRONE_TIMEZONE
ADMIN_TOKEN              # Researcher dashboard write operations
SMART_HEALTH_SYSTEMS_JSON
```

Set them with `firebase functions:secrets:set NAME --project <projectId>`. See [docs/SECURITY.md](homeflow/docs/SECURITY.md) for the full secrets-handling workflow, the audit log, and the leak-response procedure.

---

## Data model

Per-participant data, scoped under `users/{uid}/`:

| Collection | What's in it |
|---|---|
| (root doc) | Profile (firstName/lastName/email), `studyPathway`, `surgeryDate`, `urodynamicsDate`, `currentPhase`, `throneAccountLinked`, `expoPushTokens`, etc. |
| `throne_sessions/` | Normalized void sessions from the Throne ingestion function |
| `throne_metrics/` | Flow metrics and curves associated with each session |
| `throne_sync/state` | Per-user Throne sync status + latest void timestamp (read by AI Support chat for context) |
| `sync_requests/latest` | App-open trigger document that requests a Throne sync |
| `hk_quantity_samples/` and `hk_sleep/` | HealthKit-derived quantity and sleep summaries |
| `hk_sync/{metric}` | Per-metric HealthKit sync cursors + `lastSyncedAt` (also read by AI Support chat) |
| `medical_history/current` | User-confirmed demographics, medications, conditions, procedures, labs |
| `medical_history_prefill/latest` | Deterministic HealthKit/SMART prefill before user confirmation |
| `clinical_notes/` | Parsed clinical notes synced from Apple Health or SMART providers |
| `surgery_date/current` | Participant's scheduled surgery date |
| `consent_response/current` | Consent record + storage path of signed PDF |
| `ipss_scores/{period}` | `baseline`, `1month`, `2month`, `3month`, `post_uds` — IPSS results |
| `provider_connections/{providerId}` | Non-secret SMART connection metadata for the app UI |
| `provider_connections_private/{providerId}` | Access/refresh tokens and private SMART connection details |
| `smart_clinical_data/{providerId}` | Latest SMART sync summary for a connected provider |

Study-level and cross-cutting data:

| Path | What's in it |
|---|---|
| `supportChats/{chatId}` | AI Support chat threads (one per participant per conversation) |
| `supportChats/{chatId}/messages/{messageId}` | Individual messages with `role: 'user' \| 'assistant' \| 'researcher'` — the trigger that pushes researcher replies watches this subcollection |
| `config/support_chat` | Researcher-tunable adherence settings — `syncThresholdHours` (12–168, default 48). Read by both the iOS app and the Cloud Function. |
| `nightly_summaries/{YYYY-MM-DD}` | Per-participant Morning Briefings written by the nightly Cloud Function for the researcher dashboard |
| `throne_research_participants/{email}` | Email roster shared with Throne for research data access |
| `throneSync/{studyId}` | Study-wide Throne ingestion cursor + last-run status |

Firebase Storage holds:
- `users/{uid}/consent_pdfs/` — signed consent PDFs
- `users/{uid}/clinical_notes/` — raw decoded CDA XML and related note payloads for downstream analysis

---

## A few things worth knowing

**Post-surgery IPSS is currently scheduled at 1, 2, and 3 months** (per pathway-A; Pathway-A urodynamics-only is baseline + 2-week post-UDS).

**Throne accounts are linked to study accounts by shared email** — no manual Throne user IDs. During account creation, the app emphasizes "use this same email when you set up your Throne One." The backend maintains a Throne research participant roster keyed by email (`throne_research_participants/{email}`); the cloud functions and Throne use this list to authorize and route data.

**Throne syncing is function-driven, not client-driven.** The app writes `users/{uid}/sync_requests/latest` on app open, which triggers a Cloud Function to ingest if the study hasn't synced within the last hour. A scheduled function also runs daily at 3:00 AM Pacific.

**AI Support chat is Anthropic-backed and study-aware.** `functions/src/supportChat.ts` calls Claude (model `claude-sonnet-4-6`) with a per-request system prompt that includes the participant's pathway, consent state, UDS/surgery date, current sync recency, and a PII firewall (only `firstName` + study-logistics fields are passed — no last name, full DOB, or raw clinical data). Embedded knowledge bases for Throne and Apple Health/Watch troubleshooting come from `throneSupportKnowledge.ts` and `appleHealthKnowledge.ts`. The Anthropic API key lives in Firebase Secret Manager, never on disk.

**Researchers can start a thread for any participant** from the hosted dashboard. Messages with `role === 'researcher'` go through the same Firestore path as participant-initiated chats and fire `notifyOnSupportMessage` (Firestore trigger) which pushes via Expo's API — with a foreground-listener fallback (`use-researcher-message-buzz`) for when the app is open or push isn't available.

**Adherence monitoring runs every app foreground.** If Throne's `lastVoidAt` or any HealthKit metric's `lastSyncedAt` is older than `config/support_chat.syncThresholdHours` (researcher-tunable from 12 to 168 hours, default 48), the app starts a local notification that **repeats every 4 hours** until the gap closes. The notification body reflects the actual elapsed time, not a hardcoded "48 hours."

**Push notifications are gated on a paid Apple Developer Program.** The `aps-environment` entitlement is currently OUT of the iOS entitlements file because the personal Apple Developer team doesn't support push. The foreground-listener fallback covers researcher-message delivery in the meantime; local notifications (sync reminders, IPSS due dates) work on any tier. See `docs/APPLE_DEVELOPER_HANDOFF.md` for the institutional-account handoff plan.

**SMART on FHIR data is split into public and private records.** The app reads a sanitized connection record from `provider_connections`, while tokens and refresh metadata live separately in `provider_connections_private`.

**Clinical notes come in as structured clinical documents, not PDFs.** Apple Health notes arrive as CDA XML, and SMART providers can contribute FHIR DocumentReference-derived text. The app stores parsed text for UI use and raw payloads for downstream analysis.

**Consent has both local and cloud state.** AsyncStorage is used to gate onboarding locally, while Firestore plus the generated PDF in Storage serve as the durable study record.

**Firebase config is env-only and statically inlined.** No hardcoded fallbacks; missing values throw at boot. Critical caveat for Metro/Babel: each `EXPO_PUBLIC_FIREBASE_*` var MUST be accessed as a literal property (`process.env.EXPO_PUBLIC_FIREBASE_API_KEY`), never dynamically (`process.env[name]`) — dynamic access doesn't get inlined and resolves to `undefined` at runtime. See `lib/firebase.ts` and `docs/SECURITY.md`.



---

## Team

Streamsync Research Consortium — multi-center BPH study

Principal Investigator: Daniel Wong, MD
IRB Protocol: IRB# TBD
Contact: info@streamsyncresearch.com
