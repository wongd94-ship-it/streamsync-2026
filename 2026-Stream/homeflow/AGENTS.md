# AI Coding Instructions for Streamsync

## Project Context

**Project:** Streamsync — BPH Patient Digital Health Study
**Sponsor:** Streamsync Research Consortium (multi-center)
**Principal Investigator:** Daniel Wong, MD
**Platform:** iOS-first (React Native / Expo), cross-platform where feasible

**Purpose:** Enable passive, longitudinal measurement of voiding patterns, activity, and sleep in the home environment for BPH patients before and after bladder outlet surgery.

## Tech Stack

- React Native + Expo 54, TypeScript, Expo Router
- Spezi Vibe framework
- Apple HealthKit + Apple Watch integration
- Apple ResearchKit (consent/enrollment)
- Throne Uroflow API
- Formik + Yup (forms/validation)
- Cloud backend (PI-managed; e.g., GCP / Medplum / Firebase)

## Commands

```bash
npx expo start    # Start dev server (press i for iOS, a for Android)
npm test          # Run tests
```

## Core Data Types

### Throne Uroflow Data
- Void timestamp, voided volume
- Maximum flow rate (Qmax), average flow rate (Qavg)
- Flow curve shape, voiding frequency
- Nocturia events, patient annotations (straining, urgency)

### Apple HealthKit / Watch Data
- Step count, active minutes, sedentary time
- Sleep duration and stages
- Heart rate and vitals (when available)

### Surveys
- IPSS (International Prostate Symptom Score) - collected longitudinally

## Provider Hierarchy

Order matters - don't rearrange:
```
StandardProvider → SchedulerProvider → AccountProvider → App
```

## Critical Rules

1. **Always use Standard** - Access data via `useStandard()`, never import backends directly
2. **AccountService = auth only** - Login, register, logout, profile
3. **BackendService = data only** - Tasks, outcomes, questionnaires, uroflow, HealthKit
4. **Cancellation tokens** - Every async effect needs `let cancelled = false`
5. **Memoize context values** - Always `useMemo` for provider values
6. **Declarative auth guards** - Use `<Redirect href="..." />`, not `router.replace()`
7. **Privacy-first** - De-identify data before upload; no unnecessary PHI
8. **Research-only** - No real-time clinical alerts or treatment recommendations
9. **Adhere to PRD** - All AI-generated code must strictly follow `docs/PRD.md`

## Key Flows

1. **Enrollment & Consent** - ResearchKit-based eligibility screening and informed consent
2. **Permissions** - HealthKit access, Watch data, Throne device access
3. **Initial Data Intake** - Demographics from HealthKit + chatbot-assisted history + baseline IPSS
4. **Daily Passive Collection** - Uroflow, activity, sleep data synced ~once per day
5. **Periodic Surveys** - IPSS prompts at defined intervals

## Key Files

| File | Purpose |
|------|---------|
| `lib/services/standard-context.tsx` | Standard pattern - provides backend & auth |
| `app/_layout.tsx` | Root layout with providers and auth guards |
| `app/(tabs)/_layout.tsx` | Tab navigation |
| `docs/PRD.md` | Product requirements - source of truth |

## Don't

- Import backends directly - use `useStandard()`
- Add auth methods to BackendService
- Add data methods to AccountService
- Use `router.replace()` for auth guards
- Forget cleanup functions in useEffect
- Skip cancellation tokens in async effects
- Build real-time clinical decision support
- Store unnecessary PHI
- Deviate from PRD requirements without explicit approval

## Constraints & Assumptions

- This is a **research pilot** - demo-safe implementations acceptable
- Backend may be simulated or partially stubbed
- Data collected is **not used for clinical care**
- During demos, Throne uroflow data may be simulated if hardware unavailable
- iOS HealthKit limitations acknowledged (e.g., delayed syncs)

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

## Testing Strategy

### Running Tests
- `npm test`: Runs **ALL** tests (services + workspaces). This is the command used by CI.
- `npm run test:services`: Runs only the service-layer tests (Jest).

### Feature Flags in Tests
We use a feature flag pattern to handle tests for features that are not yet implemented (e.g., Throne API integration, Firebase backend).

- **Pattern**: Tests for unimplemented features are wrapped in feature flag checks (e.g., `FEATURE_FLAGS.THRONE_API_IMPLEMENTED`).
- **Default State**: Flags are set to `false`, causing these tests to rely on stub behavior or be skipped.
- **Action Required**: When you implement a feature, set the corresponding flag to `true` in the test file and update the test expectations to verify the real implementation.
