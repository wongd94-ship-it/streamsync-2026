# AI Coding Instructions for Streamsync

## Project Context

**Project:** Streamsync — Multimodal Home Uroflow & Wearable Monitoring Pilot Study
**Platform:** iOS-first (React Native / Expo), cross-platform where feasible

**Purpose:** Streamsync is a pragmatic pilot study enrolling 50 men with BPH who are undergoing either urodynamic evaluation or surgical treatment. The app integrates longitudinal home uroflowmetry (Throne One smart toilet) with continuous Apple Watch monitoring to predict voiding etiology, assess surgical outcomes, and identify candidate digital biomarkers for BPH progression.

## Study Design — Two Pathways

### Pathway A: Urodynamics Patients
- **Pre-UDS Monitoring:** ≥2 weeks of continuous data collection (uroflow + wearable)
- **Urodynamics Event:** Pressure-flow study (ground-truth BOO endpoint)
- **Post-UDS Monitoring:** 2 weeks continued monitoring
- **Some patients proceed to surgery** → enter Pathway B

### Pathway B: BPH Surgery Patients
- **Pre-Surgery Monitoring:** ≥2 weeks of continuous data collection
- **Surgery Event:** BPH procedure (e.g., HoLEP, TURP, UroLift, Rezum)
- **Post-Surgery Monitoring:** 12 weeks continued monitoring
- **IPSS Questionnaires:** Baseline, 1 month, 2 months, 3 months post-surgery
- **Endpoint:** ≥5-point IPSS reduction or >5 mL/s Qmax improvement

### Enrollment Context
- Patients are enrolled **in person at the urology clinic**
- Apple Watches are **provided at the clinic** during the enrollment visit
- Throne One smart toilets are **shipped via mail** (~4 business days after signup)
- Onboarding is guided by research staff but completed on the patient's own iPhone

## Tech Stack

- React Native + Expo 54, TypeScript, Expo Router
- Apple HealthKit + Apple Watch integration
- Apple ResearchKit (consent/enrollment)
- Throne Uroflow API (email-matched accounts)
- SMART on FHIR (Epic, etc.) for clinical records
- Formik + Yup (forms/validation)
- Cloud backend: Firebase (Auth, Firestore, Storage, Cloud Functions)

## Commands

```bash
npx expo start             # Start Metro dev server (press i for iOS, a for Android)
npm test                   # Run ALL tests (services + workspaces)
npm run test:services      # Run service-layer tests only (Jest)
npm run ios:device:release # Build Release config + install to connected iPhone
                           # (canonical command — handles signing + JS bundle embed)
```

### iPhone build gotchas
- `ios:device:release` produces a Release build with the JS bundle embedded — no Metro needed. Use this for "actually use the app" testing. `expo run:ios --device` produces a Debug build that throws "no script URL provided" without a running Metro server.
- After an iOS point-update on the test device (e.g. 26.3.1 → 26.4.2), `xcodebuild` may fail with `"The developer disk image could not be mounted on this device."` Fix: open Xcode → Window → Devices and Simulators → select the iPhone → wait for "Preparing for development" to finish, then retry. Xcode auto-downloads the matching DDI; this can take a few minutes.
- The iPhone must be **unlocked** during `xcrun devicectl process launch` for auto-launch to succeed. Locked phone → script exits 0 with a friendly hint to unlock and tap the icon.
- Free / personal Apple Developer team does NOT support push notifications. The `aps-environment` entitlement must stay OUT of `ios/StreamSync/StreamSync.entitlements` until the team is upgraded to a paid Developer Program ($99/yr).

## Core Data Types

### Throne Uroflow Data
- Void timestamp, voided volume
- Maximum flow rate (Qmax), average flow rate (Qavg)
- Flow curve shape/morphology, voiding frequency
- Nocturia events, patient annotations (straining, urgency)

### Apple HealthKit / Watch Data
- Step count, active energy, exercise minutes, stand time
- Heart rate, resting heart rate, HRV (SDNN)
- Respiratory rate, oxygen saturation
- Sleep duration and stages (inBed, asleep, awake)
- Body mass, height

### Surveys
- IPSS (International Prostate Symptom Score) — collected at baseline + 1, 2, 3 months post-surgery

### Clinical Records (via SMART on FHIR)
- Medications, conditions, procedures, lab results, allergies, vitals

---

## Streamlined Onboarding Flow

The onboarding is designed for **in-person clinic enrollment** with research staff present. It must be efficient (target: <15 minutes) while collecting all required consents and permissions.

### Step 1: WELCOME
- Brief introduction to Streamsync study
- Highlights: what data is collected, how long participation lasts
- Single "Get Started" CTA

### Step 2: ELIGIBILITY
- Confirm BPH diagnosis
- **Select study pathway:** "I am scheduled for urodynamics" / "I am scheduled for BPH surgery" / "Both"
- Collect anchor date (surgery date and/or urodynamics date)
- If ineligible → route to ineligible screen

### Step 3: CONSENT
- Scrollable informed consent document (IRB-reviewed)
- Participant name input + digital signature canvas
- Store signature locally; upload PDF after account creation

### Step 4: ACCOUNT CREATION
- Email/password signup (or Google/Apple Sign-In)
- **Important:** Instruct patient to use the **same email** they will use for their Throne account
- Display clear callout: "Use this same email when you set up your Throne device"
- First/last name collection
- Triggers Firebase Auth + Firestore profile creation
- Uploads pending consent PDF
- Saves pathway selection + anchor date(s)

### Step 5: PERMISSIONS
- **HealthKit** (required on iOS): activity, sleep, heart rate, HRV, vitals
- **Apple Health Clinical Records** (optional): pull existing medical records
- **SMART on FHIR** (optional): connect to health system (Epic, etc.)
- **Notifications** (required): enable push notifications for surveys + reminders
- **NO Throne setup here** — device ships separately via mail

### Step 6: MEDICAL HISTORY
- Pull clinical data from SMART provider connection (if available)
- Query HealthKit demographics (age, sex)
- 6-section confirmation UI: demographics, medications, surgical history, labs, conditions, measurements
- User reviews and confirms each section

### Step 7: BASELINE IPSS
- 8-question IPSS questionnaire (Q1-Q7: 0-5 scale, Q8 QoL: 0-6)
- Display score + severity interpretation (mild/moderate/severe)
- Store as baseline in Firestore

### Step 8: COMPLETE
- Summary of what happens next:
  - "Your Apple Watch is ready — wear it daily"
  - "Your Throne One will arrive in ~4 business days"
  - "We'll notify you when it's time to set up your Throne device"
  - "Keep using the app to track your progress"
- Mark onboarding complete
- Schedule IPSS follow-up tasks (if surgery pathway)

### Removed / Consolidated Steps
- **No separate Throne device setup during onboarding** (device arrives later)
- **No Throne User ID manual entry** — match by email via Throne API
- Account creation emphasizes email matching instead

---

## Throne Device Integration (Post-Onboarding)

### Device Arrival Flow
1. After signup, research team ships Throne One to patient (~4 business days)
2. App sends a **scheduled notification** at ~5 days post-enrollment:
   - "Your Throne One should be arriving soon! Tap here for setup instructions."
3. Notification links to an **in-app Throne Setup Guide** screen:
   - Step-by-step Throne One setup instructions
   - Reminder: "Create your Throne account using the same email: {user_email}"
   - "Once set up, your voiding data will sync automatically"
   - Contact support option if having trouble

### Email-Based Data Linking
- When patient creates Throne account with same email as Streamsync account, the backend can use that email to query the Throne API for their data
- Cloud Function maintains a **Throne research participant list** (email roster)
- This roster is periodically emailed to Throne to enable research data access permissions
- Backend `syncThroneData` Cloud Function pulls data for matched participants daily

### Throne Research Participant Registry
- Firestore collection: `throne_research_participants/{email}`
- Fields: `{ email, firebaseUid, enrolledAt, throneAccountCreated: boolean, lastSyncAt }`
- Admin dashboard can export this list for Throne data access requests

---

## Dashboard (Home Screen)

The dashboard adapts based on the patient's **study pathway** and **current phase**.

### Common Elements (Both Pathways)
1. **Activity Rings** — Apple Watch-style (Move, Exercise, Stand)
2. **Throne Voiding Summary** — 7-day chart (volume, Qmax, Qavg, flow time, nocturia)
   - Shows "Waiting for Throne device..." if no data yet
3. **Data Sync Status** — Last sync times for HealthKit + Throne
4. **Study Phase Indicator** — Current phase with countdown/progress

### Pathway-Specific Elements

#### Urodynamics Pathway
- Phase indicator: "Pre-UDS Monitoring" → "Urodynamics Complete" → "Post-UDS Monitoring"
- Countdown to urodynamics date
- After UDS: prompt to confirm if proceeding to surgery (→ switches to surgery pathway)

#### Surgery Pathway
- Phase indicator: "Pre-Surgery Monitoring" → "Recovery Week X/12" → "Monitoring Complete"
- Surgery countdown or weeks-since-surgery counter
- IPSS due date reminders (1, 2, 3 month milestones)
- Recovery progress visualization

### Adaptive Throne Status Card
- **Before device arrives** (~days 0-5): "Your Throne One is on its way!"
- **Setup pending** (device arrived, no data): "Set up your Throne One" + setup guide link
- **Active**: Live voiding data dashboard
- **Stale data** (>48h no voids): "Haven't seen a void in a while — is your Throne set up?"

---

## IPSS Survey Schedule

### Surgery Pathway
| Period | Timing | Firestore Path |
|--------|--------|----------------|
| Baseline | During onboarding | `users/{uid}/ipss_scores/baseline` |
| 1 Month | 30 days post-surgery | `users/{uid}/ipss_scores/1month` |
| 2 Months | 60 days post-surgery | `users/{uid}/ipss_scores/2month` |
| 3 Months | 90 days post-surgery | `users/{uid}/ipss_scores/3month` |

### Urodynamics-Only Pathway
| Period | Timing | Firestore Path |
|--------|--------|----------------|
| Baseline | During onboarding | `users/{uid}/ipss_scores/baseline` |
| Post-UDS | 2 weeks after urodynamics | `users/{uid}/ipss_scores/post_uds` |

Notifications fire 1 day before, day-of, and 1 day after each due date.

---

## Data Model — Firestore Structure

```
users/{uid}/
  ├── (root doc)
  │   ├── firstName, lastName, email
  │   ├── studyPathway: "urodynamics" | "surgery" | "both"
  │   ├── surgeryDate?: "YYYY-MM-DD"
  │   ├── urodynamicsDate?: "YYYY-MM-DD"
  │   ├── enrolledAt: ISO timestamp
  │   ├── onboardingComplete: boolean
  │   ├── currentPhase: "pre_uds" | "post_uds" | "pre_surgery" | "post_surgery" | "complete"
  │   ├── throneDeviceShipped: boolean
  │   ├── throneDeviceShippedAt?: ISO timestamp
  │   ├── throneAccountLinked: boolean
  │   └── createdAt, updatedAt
  │
  ├── ipss_scores/
  │   ├── baseline { totalScore, qolScore, severity, completedAt, responseId }
  │   ├── 1month { ... }
  │   ├── 2month { ... }
  │   ├── 3month { ... }
  │   └── post_uds { ... }
  │
  ├── healthkit_metrics/
  │   ├── heartRate/{id}
  │   ├── stepCount/{id}
  │   ├── sleepAnalysis/{id}
  │   ├── heartRateVariabilitySDNN/{id}
  │   └── ... (other metric types)
  │
  ├── healthkit_sync_state { lastSyncedAt, lastError }
  │
  ├── throne_sessions/
  │   └── {sessionId} { startTs, endTs, metricCount, ... }
  │
  ├── throne_metrics/
  │   └── {metricId} { sessionId, ts, value, type, series, ... }
  │
  ├── clinical_records/
  │   ├── medications/{id}
  │   ├── conditions/{id}
  │   ├── procedures/{id}
  │   ├── observations/{id}
  │   └── allergies/{id}
  │
  ├── smart_provider_connections/
  │   └── {providerId} { issuer, fhirBaseUrl, connectedAt, ... }
  │
  └── consents/
      └── baseline.pdf (Firebase Storage)

throne_research_participants/
  └── {email} { firebaseUid, enrolledAt, throneAccountCreated, lastSyncAt }
```

---

## Provider Hierarchy

Order matters — don't rearrange:
```
StandardProvider → SchedulerProvider → AccountProvider → App
```

## Critical Rules

1. **Always use Standard** — Access data via `useStandard()`, never import backends directly
2. **AccountService = auth only** — Login, register, logout, profile
3. **BackendService = data only** — Tasks, outcomes, questionnaires, uroflow, HealthKit
4. **Cancellation tokens** — Every async effect needs `let cancelled = false`
5. **Memoize context values** — Always `useMemo` for provider values
6. **Declarative auth guards** — Use `<Redirect href="..." />`, not `router.replace()`
7. **Privacy-first** — De-identify data before upload; no unnecessary PHI
8. **Research-only** — No real-time clinical alerts or treatment recommendations
9. **Email consistency** — Throne and Streamsync accounts must use same email
10. **Pathway-aware** — All screens must respect the patient's study pathway (UDS vs surgery vs both)

## Key Files

| File | Purpose |
|------|---------|
| `lib/services/standard-context.tsx` | Standard pattern — provides backend & auth |
| `app/_layout.tsx` | Root layout with providers and auth guards |
| `app/(tabs)/_layout.tsx` | Tab navigation |
| `app/(onboarding)/index.tsx` | Onboarding router (step state machine) |
| `app/(onboarding)/chat.tsx` | Eligibility screening (pathway selection) |
| `app/(onboarding)/consent.tsx` | Informed consent + signature |
| `app/(onboarding)/account.tsx` | Account creation (email-match emphasis) |
| `app/(onboarding)/permissions.tsx` | HealthKit, SMART, notifications |
| `app/(onboarding)/medical-history.tsx` | Clinical history review |
| `app/(onboarding)/baseline-survey.tsx` | IPSS baseline questionnaire |
| `app/(tabs)/index.tsx` | Dashboard (pathway-adaptive) |
| `app/(tabs)/voiding.tsx` | Throne voiding data + trends |
| `app/(tabs)/health.tsx` | Apple HealthKit data display |
| `lib/services/onboarding-service.ts` | Onboarding state machine |
| `lib/services/throne-service.ts` | Throne integration service |
| `lib/services/notification-service.ts` | Notifications + reminders |
| `lib/services/healthkit/` | HealthKit query + sync layer |
| `lib/services/smart/` | SMART on FHIR OAuth + sync |
| `lib/services/fhir/` | FHIR R4 parsing + mapping |
| `src/services/healthkitSync.ts` | HealthKit → Firestore sync |
| `src/services/ipssScoreSync.ts` | IPSS → Firestore sync |
| `docs/PRD.md` | Product requirements — update to match |

## Don't

- Import backends directly — use `useStandard()`
- Add auth methods to BackendService
- Add data methods to AccountService
- Use `router.replace()` for auth guards
- Forget cleanup functions in useEffect
- Skip cancellation tokens in async effects
- Build real-time clinical decision support
- Store unnecessary PHI
- Ask for Throne User ID during onboarding (device hasn't arrived yet)
- Assume all patients are surgery patients — check pathway
- Hard-code monitoring durations — derive from pathway + anchor dates

---

## Development Agents

Claude Code agents for common tasks. Invoke with `/agent-name`.

### Development

| Agent | Command | Purpose |
|-------|---------|---------|
| docs | `/docs` | Generate documentation and READMEs |
| changelog | `/changelog` | Generate changelogs from git history |
| test | `/test` | Generate Jest tests following project patterns |
| fhir | `/fhir` | Validate FHIR R4 compliance in code |
| fhir-mapping | `/fhir-mapping` | Generate FHIR resource mappings |
| feature | `/feature` | Create new app features and screens |
| release | `/release` | Create release notes for new versions |

### Planning

| Agent | Command | Purpose |
|-------|---------|---------|
| study-planner | `/study-planner` | Plan health studies and research protocols |
| compliance | `/compliance` | Plan HIPAA, IRB, and regulatory compliance |
| data-model | `/data-model` | Design health data models and FHIR structures |
| ux-planner | `/ux-planner` | Design user flows and engagement strategies |

Agent definitions are in `.claude/commands/`.

---

## Testing Strategy

### Running Tests
- `npm test`: Runs ALL tests (services + workspaces). This is CI.
- `npm run test:services`: Runs only service-layer tests (Jest).

### Feature Flags in Tests
- **Pattern**: Tests for unimplemented features wrapped in feature flag checks
- **Default State**: Flags `false` → tests use stubs or skip
- **Action Required**: Set flag `true` when implementing, update expectations

### Simulator Testing Workflow

When making changes, follow this cycle for **each pathway**:

#### Phase 1: Implementation
1. Make code changes
2. Run `npm test` — fix any failures
3. Run `npx expo start --ios` to launch simulator

#### Phase 2: Urodynamics Pathway Test
1. Fresh install → complete onboarding selecting "urodynamics" pathway
2. Verify: eligibility → consent → account → permissions → medical history → baseline IPSS → complete
3. Verify dashboard shows UDS-specific phase indicator
4. Verify Throne status shows "device on the way"
5. Verify IPSS schedule is UDS-appropriate (baseline + post-UDS only)
6. Verify HealthKit data populates

#### Phase 3: Surgery Pathway Test
1. Fresh install → complete onboarding selecting "surgery" pathway
2. Verify same onboarding flow but with surgery date
3. Verify dashboard shows surgery-specific phase/countdown
4. Verify IPSS schedule includes 1, 2, 3 month follow-ups
5. Verify Throne setup notification fires at ~5 days
6. Verify post-surgery recovery week counter works

#### Phase 4: Edge Cases
1. "Both" pathway (UDS → surgery transition)
2. Throne data appears after initial "waiting" state
3. IPSS notification tap → opens correct questionnaire
4. App backgrounding/foregrounding preserves state
5. Network offline → graceful degradation

#### Phase 5: Debug & Iterate
- If a test fails: fix → retest that specific pathway
- If UI is janky: refine animations/transitions → retest
- If data doesn't sync: check Firestore rules → fix → verify

### Autonomous Agent Testing Protocol

When using parallel agents for development:

**Agent 1 — Onboarding & Eligibility:**
- Modify eligibility chat to support pathway selection (UDS / surgery / both)
- Update onboarding data model with `studyPathway`, `urodynamicsDate`
- Remove Throne setup from permissions screen
- Add email-match callout to account creation
- Add Throne setup guide screen (post-onboarding)
- Test: run through onboarding for each pathway in simulator

**Agent 2 — Dashboard & Phase Tracking:**
- Implement pathway-aware dashboard with phase indicators
- Build adaptive Throne status card (waiting → setup → active → stale)
- Add surgery countdown / UDS countdown / recovery week counter
- Implement phase auto-advancement based on dates
- Test: verify dashboard states for each pathway + phase

**Agent 3 — Notifications & IPSS Scheduling:**
- Implement Throne arrival notification (~5 days post-enrollment)
- Update IPSS scheduling: surgery pathway (baseline + 1/2/3 month) vs UDS (baseline + post-UDS)
- Add notification for IPSS due dates (day before, day of, day after)
- Implement Throne setup reminder if no data after 7 days
- Test: verify notification timing and survey routing

**Agent 4 — Data Layer & Throne Integration:**
- Update Firestore schema for dual-pathway model
- Implement `throne_research_participants` collection
- Build email-based Throne data linking (replace manual User ID)
- Update HealthKit sync for continuous monitoring windows
- Update data export for research analysis
- Test: verify data writes, reads, and sync correctness

**Integration Testing (sequential, after parallel work):**
1. Merge all agent outputs
2. Run `npm test` — fix any conflicts
3. Full simulator walkthrough: UDS pathway end-to-end
4. Full simulator walkthrough: Surgery pathway end-to-end
5. Full simulator walkthrough: Both pathways (UDS → surgery transition)
6. Verify Firestore data structure matches schema above
7. Verify no regressions in HealthKit, SMART, medical history flows

---

## Constraints & Assumptions

- This is a **research pilot study** — demo-safe implementations acceptable
- Backend may be partially stubbed (Throne API awaiting research access)
- Data collected is **not used for clinical care**
- Throne data may be simulated if device hardware unavailable during development
- iOS HealthKit limitations acknowledged (e.g., delayed syncs)
- Apple Watches are provided by the study — patients don't need their own
- In-clinic onboarding means research staff can assist with any setup issues
- Throne email matching assumes patients follow the instruction to use same email
