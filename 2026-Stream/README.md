# Streamsync

A multi-center digital-health research app. Streamsync helps men with BPH (benign prostatic hyperplasia) passively track their voiding patterns, sleep, and activity before and after bladder outlet surgery, so researchers can measure real-world functional improvement and use rich digital data to predict patients most likely to benefit from intervention.

The app is institutionally agnostic and is being piloted across multiple academic medical centers participating in the BPH Research Consortium.

---

## What it does

Right now, when a patient has bladder outlet surgery surgery, the main outcome measure is a questionnaire they fill out in a waiting room. Streamsync replaces that with continuous, passive data collection at home using hardware and sensors the patient already has.

Concretely, it:

- Records every void using a **Throne uroflow device** attached to the patient's toilet, capturing flow rate, volume, and flow curve shape, pulls information with Throne API once per day
- Pulls **activity, sleep, resting heart rate and heart rate** data from Apple Watch and HealthKit automatically, once per day
- Collects a **baseline IPSS symptom score** at enrollment and follow-up scores at 1, 2, and 3 months post-surgery
- Walks patients through **enrollment and informed consent** entirely in-app, with a signed PDF stored securely
- User login and SSO auth enabled
- Allows patients to share medical records through SMART on FHIR for seamless acquisition of medical history
- Maintains full reference documents for clinical notes on backend for Medjemma processing of key urologic features
- Syncs everything to a **Firebase backend** for the research team to analyze
- After login and set up, gives patient dashboard for monitoring of study progress relative to surgery date
- LLM chat function to answer patient questions about the study or troubleshooting syncing/pairing devices
- To ensure study adherence, automatic notifications will remind patients to use devices if no active sync is detected in 48 hours.
- Reminder notifications can prompt LLM function for personalized assistance


The patient doesn't need to do anything after setup. The app runs in the background.

---

## The patient journey

```
Download app
    ↓
Eligibility screening (takes ~2 min)
    ↓
Informed consent + digital signature
    ↓
Create account
    ↓
Grant HealthKit + Epic Health Records + Throne permissions
    ↓
Medical history review (pre-filled from Health Records)
    ↓
Baseline IPSS survey
    ↓
Done — passive collection starts
    ↓
Follow-up IPSS at 1,2, and 3 months post-surgery
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
    (onboarding)/              # Welcome, consent, account, permissions, Epic connect, medical history, baseline IPSS
    (auth)/                    # Login and signup
    (tabs)/                    # Home, voiding, health, chat helper, profile
    questionnaire/             # Shared questionnaire modal routes
    _layout.tsx                # Root navigation, auth/onboarding guards, sync bootstrap

  components/
    onboarding/                # Consent UI, progress, permission cards, continue buttons
    health/                    # Health summary cards and visualizations
    home/                      # Home screen-specific UI
    ui/                        # Shared primitives such as SignaturePad and loading states

  hooks/
    use-onboarding-status.ts   # Route gating based on onboarding completion
    use-ipss-task-setup.ts     # Seeds post-surgery IPSS follow-up tasks
    use-data-sync-check.ts     # 48-hour adherence/reminder checks

  lib/
    auth/                      # Auth context over the selected account service
    chat/                      # Concierge chat flows and LLM integration
    consent/                   # Consent document source content
    questionnaires/            # Eligibility and IPSS definitions
    services/                  # Standard context, backend abstraction, HealthKit, SMART, notifications
    tasks/                     # Scheduler task definitions

  src/services/
    clinicalNotesSync.ts       # Apple Health clinical note parsing + upload
    consentPdfSync.ts          # Signed consent PDF generation + Firebase sync
    fhirPrefillSync.ts         # HealthKit/SMART structured data prefill for medical history
    healthkitSync.ts           # Health metrics → Firestore sync
    ipssScoreSync.ts           # Baseline/follow-up IPSS writes to Firestore
    throneFirestore.ts         # Throne reads plus root user / surgery / history writes

  functions/
    src/index.ts               # Scheduled + app-open Throne ingestion triggers
    src/throneIngestion.ts     # Throne export normalization and Firestore fanout
    src/smartOnFhir.ts         # SMART auth, token storage, clinical sync

  packages/
    chat/                      # Shared SpeziVibe chat package
    questionnaire/             # Shared questionnaire package
    scheduler/                 # Shared scheduler package

  dashboard-public/            # Firebase Hosting site for the public dashboard and study pages
  modules/expo-clinical-records/ # Local Expo module for clinical record access
```

---

## Getting started

You'll need:
- macOS with Xcode installed
- A physical iPhone for the real HealthKit / clinical records flow
- Node.js 18+
- Firebase CLI for deploys: `npm install -g firebase-tools`
- A `.env` file with the keys below (ask a teammate)

```bash
# Install dependencies
cd 2026-Stream/homeflow
npm install

# Start the dev server
npx expo start

# Run typecheck / lint / tests
npm run typecheck
npm run lint
npm test

# Run on a physical iPhone
npx expo run:ios --device YOUR_DEVICE_UDID

# Build and run Cloud Functions locally
cd functions
npm install
npm run build

# Deploy Firebase resources from the app root
cd ..
firebase deploy --only firestore,storage,functions,hosting
```

Useful notes:
- `expo-notifications`, HealthKit, Google Sign-In, and the custom clinical records module require a native iOS build. Expo Go is not enough.
- The app has native `ios/` and `android/` folders checked in, plus EAS profiles in `eas.json`.
- Cloud Functions live in their own Node 20 workspace under `homeflow/functions`.

### Main scripts

```bash
npm start          # expo start
npm run ios        # expo run:ios
npm run android    # expo run:android
npm run web        # expo start --web
npm run lint
npm run typecheck
npm test
```

### Environment variables

Client / Expo app:

```text
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=
EXPO_PUBLIC_USE_BACKEND_LLM=true|false
GOOGLE_SERVICES_PLIST=/absolute/path/to/GoogleService-Info.plist
```

Cloud Functions (`homeflow/functions/.env`):

```text
THRONE_API_KEY=
THRONE_BASE_URL=
THRONE_STUDY_ID=
THRONE_TIMEZONE=America/Los_Angeles
ADMIN_TOKEN=
SMART_HEALTH_SYSTEMS_JSON=
```

Notes:
- The Throne API key is server-side only and never ships in the client bundle.
- SMART provider client credentials live inside `SMART_HEALTH_SYSTEMS_JSON` on the functions side.
- `EXPO_PUBLIC_USE_BACKEND_LLM` controls whether chat should rely on the backend-enabled LLM path in build profiles.

---

## Data model

Everything in Firestore is scoped under `users/{uid}/`:

| Collection | What's in it |
|---|---|
| `throne_sessions/` | Normalized void sessions from the Throne ingestion function |
| `throne_metrics/` | Flow metrics and curves associated with each session |
| `throne_sync/state` | Per-user Throne sync status and latest void timestamp |
| `sync_requests/latest` | App-open trigger document that requests a Throne sync |
| `hk_quantity_samples/` and `hk_sleep/` | HealthKit-derived quantity and sleep summaries written by sync services |
| `hk_sync/` | Per-metric HealthKit sync cursors and timestamps |
| `medical_history/current` | User-confirmed demographics, medications, conditions, procedures, labs |
| `medical_history_prefill/latest` | Deterministic HealthKit/SMART prefill before user confirmation |
| `clinical_notes/` | Parsed clinical notes synced from Apple Health or SMART providers |
| `surgery_date/current` | Patient's scheduled surgery date |
| `consent_response/current` | Consent record + storage path of signed PDF |
| `ipss_scores/{period}` | Baseline plus post-surgery IPSS results |
| `provider_connections/{providerId}` | Non-secret SMART connection metadata for the app UI |
| `provider_connections_private/{providerId}` | Access/refresh tokens and private SMART connection details |
| `smart_clinical_data/{providerId}` | Latest SMART sync summary for a connected provider |

Firebase Storage holds:
- `users/{uid}/consent_pdfs/` — signed consent PDFs
- `users/{uid}/clinical_notes/` — raw decoded CDA XML and related note payloads for downstream analysis

Study-level admin docs outside `users/{uid}`:
- `throneSync/{studyId}` — study-wide Throne ingestion cursor / last run status
- Root `users/{uid}` fields include profile info and the manually-entered `throneUserId` used for ingestion routing

---

## A few things worth knowing

**Post-surgery IPSS is currently scheduled at 1, 2, and 3 months.

**The Throne client flow is still partly a stub.** Onboarding collects a manually-entered Throne user ID and stores it on `users/{uid}` so the ingestion function can map exported Throne data back to the participant. The production OAuth/device-link flow is noted in comments but not implemented yet.

**Throne syncing is function-driven, not client-driven.** The app writes `users/{uid}/sync_requests/latest` on first open, which triggers a Cloud Function to ingest if the study has not synced within the last hour. A scheduled function also runs daily at 3:00 AM Pacific.

**SMART on FHIR data is split into public and private records.** The app reads a sanitized connection record from `provider_connections`, while tokens and refresh metadata live separately in `provider_connections_private`.

**Clinical notes come in as structured clinical documents, not PDFs.** Apple Health notes arrive as CDA XML, and SMART providers can contribute FHIR DocumentReference-derived text. The app stores parsed text for UI use and raw payloads for downstream analysis.

**Consent has both local and cloud state.** AsyncStorage is used to gate onboarding locally, while Firestore plus the generated PDF in Storage serve as the durable study record.

**The app mixes local orchestration with cloud persistence.** Scheduler state and some onboarding flow state live locally, while study data, consent artifacts, Throne exports, and SMART sync outputs are persisted to Firebase.



---

## Team

Streamsync Research Consortium — multi-center BPH study

Principal Investigator: Daniel Wong, MD
IRB Protocol: IRB# TBD
Contact: info@streamsyncresearch.com
