# Apple Developer Account — Handoff Checklist

**Audience:** the engineer who will sign StreamSync under the **University of Nevada, Reno (UNR) Apple Developer Program account**. The app was previously signed with a personal/free Apple Developer team during pilot development and is now moving to the UNR institutional team for production distribution.

**Goal:** light up two production capabilities that are currently stubbed out because the project is signed with a personal/free Apple Developer team:

1. **Remote push notifications** — researcher messages from the dashboard buzz the participant's phone instantly even when the app is closed; sync-alert reminders fire reliably on locked devices.
2. **HealthKit Clinical Records full access** — the BPH Clinical Records card on the Health tab reads medications, conditions, procedures, labs, and allergies directly from the iPhone Health app's Health Records (provider-portal-imported clinical data).

The supporting code is **already shipped and wired** in the repo. The blockers are entitlements, not implementation.

> **Institutional account context.** This handoff is for signing under the **UNR organization-tier paid Apple Developer Program account** (NOT the free personal team currently in `project.pbxproj`). UNR's institutional team unlocks both capabilities once the right entitlements are toggled on the App ID. UNR is a research-active R1 institution with standing to obtain `com.apple.developer.healthkit.access` (clinical records) — Apple still reviews the request, but for an institutional research account citing UNR-IRB approval, it's typically a standard request approved without back-and-forth. If UNR's developer portal already has Clinical Health Records enabled at the team level for another app, you can skip the formal request entirely (see step 4).

---

## TL;DR

| Step | Estimated time |
|---|---|
| 1. Confirm institutional Apple Developer team membership + your role | 5 min |
| 2. Register App ID `com.dwong.homeflow` (or institutional bundle id) under the org team | 5 min |
| 3. Enable Push Notifications + HealthKit + HealthKit Clinical Records capabilities on the App ID | 5 min |
| 4. Submit Health Records entitlement request to Apple (citing IRB#) | 1–3 business days for Apple to confirm, faster than personal-team review |
| 5. Update `ios/StreamSync/StreamSync.entitlements` (3 keys) | 2 min |
| 6. Set Xcode signing team in `ios/StreamSync.xcodeproj` to the org team ID | 2 min |
| 7. Build + smoke-test on a real device | 30 min |
| 8. (optional) Configure FCM / APNs Auth Key in Firebase Console | not needed if using Expo Push (default) |

Total: about **1 hour of engineer time** plus 1–3 business days waiting on Apple to acknowledge the Health Records entitlement (institutional accounts typically clear in well under a week).

---

## 1 · Confirm your role on the institutional account

You don't need to enroll the org — that's already done. What you DO need to verify before any capability work:

- **Your role on the UNR team.** App ID + entitlement changes require the **App Manager**, **Admin**, or **Account Holder** role on the team. The Developer role is read-only for these workflows. If you're a Developer-only member, ask the UNR team's Admin (typically UNR Office of Information Technology, the UNR Med-IT mobile-portfolio owner, or whoever administers the existing UNR Apple developer presence) to grant you App Manager. Without that, every entitlement step below will require a human in the loop.
- **Existing UNR bundle-ID conventions.** Institutional teams typically have a reverse-DNS prefix tied to the org's domain. UNR's likely targets: `edu.unr.streamsync`, `edu.unr.med.streamsync`, or similar — check UNR's existing App IDs in the developer portal for the established convention. The current dev build uses `com.dwong.homeflow`; this WILL need to be renamed.
- **UNR signing-cert + provisioning-profile management policy.** Some institutional teams require all signing certs to flow through a managed pipeline (Fastlane Match, EAS managed credentials, or an internal cert-management system). Ask whoever administers UNR's developer team what the convention is, BEFORE generating new certs ad hoc — switching mid-project is painful.

After confirming role, in Xcode → Settings → Accounts → add your Apple ID linked to the institutional team, then verify under "Manage Certificates" that you can issue new development + distribution certs.

---

## 2 · Register the App ID

App Store Connect → Identifiers → App IDs → "+" → **App**

- **Bundle ID** (Explicit): pick the institutional convention.
  - Current dev value: `com.dwong.homeflow` — **this should be renamed** unless your org explicitly wants to ship under a personal-style id.
  - Likely UNR target: `edu.unr.streamsync` / `edu.unr.med.streamsync` / similar — check UNR's existing App IDs in the developer portal for the established prefix.
  - Whatever you pick, it MUST match `ios/StreamSync.xcodeproj/project.pbxproj` → `PRODUCT_BUNDLE_IDENTIFIER` (currently `com.dwong.homeflow`). See section 9 for the full bundle-id rename radius (Firebase, GoogleService-Info.plist, app.config.js, etc.).
- **Description**: "StreamSync (StreamSync BPH Pilot Study — IRB# 85480)"

### Capabilities to enable on the App ID

Tick these boxes:

| Capability | Why |
|---|---|
| ✅ **Push Notifications** | Required for `aps-environment` entitlement → remote APNs delivery |
| ✅ **HealthKit** | Already used; reaffirm under the org team |
| ✅ **HealthKit** → **Clinical Health Records** sub-capability | The slice of HealthKit that needs the entitlement application in step 4 |
| ✅ **Background Modes** | We use `remote-notification` for silent push and HealthKit background delivery |

**Skip** App Groups, iCloud, Sign In with Apple, etc. — not currently used.

> **Org-portfolio note.** If UNR already runs other clinical-records iOS apps (the UNR Med-IT team or a faculty research group with a HealthKit app would qualify), UNR's developer portal may already have **Clinical Health Records** approved at the team level. In that case the sub-capability is just a checkbox here; you skip the formal entitlement application in step 4 and go straight to step 5. Verify with whoever administers UNR's developer team.

---

## 3 · Enable Push Notifications & generate APNs key

Two paths exist. Pick **(A)** unless you specifically want to migrate off Expo's push service.

### Path A: Keep Expo Push (recommended — already wired up, no extra config)

The current implementation uses Expo's push notification service. Expo handles the APNs cert + key rotation; you never see an Auth Key. **You do not need to do anything in Firebase Console for FCM** — the server just POSTs to `https://exp.host/--/api/v2/push/send`.

What needs to happen on Apple's side:

- The App ID must have **Push Notifications** capability enabled (step 2 above).
- The new signing certificate Xcode generates must include the push entitlement.
- That's it. Expo's APNs shared cert handles the rest.

### Path B: Migrate to direct FCM (only if you have a reason to leave Expo)

Only do this if the org policy forbids using Expo's push relay (e.g. data-residency rules). The change set is non-trivial.

1. **Apple Developer portal** → Keys → "+" → enable **Apple Push Notifications service (APNs)** → download the `.p8` file. Note the Key ID and Team ID.
2. **Firebase Console** → Project Settings → Cloud Messaging → iOS app configuration → upload the `.p8`, Key ID, Team ID.
3. Replace `useExpoPushRegistration` (in [`hooks/use-expo-push-registration.ts`](../hooks/use-expo-push-registration.ts)) with `@react-native-firebase/messaging` registration.
4. Replace `notifyOnSupportMessage` (in [`functions/src/notifyOnSupportMessage.ts`](../functions/src/notifyOnSupportMessage.ts)) — swap the `fetch('https://exp.host/--/api/v2/push/send')` block for `admin.messaging().send({ token, notification: {...}, data: {...} })`.
5. Migrate the Firestore field `users/{uid}.expoPushTokens` to `users/{uid}.fcmTokens` (or just rename the array's role).

**Recommendation: stay on Path A.** Expo Push works perfectly for this use case and removes a class of certificate-rotation work the team would otherwise own.

---

## 4 · HealthKit Clinical Records — Apple entitlement application

Reading clinical records (medications, conditions, procedures, etc. from a participant's healthcare provider) requires the `com.apple.developer.healthkit.access` entitlement with a `health-records` value.

For UNR's institutional Apple Developer team, this entitlement is granted via a standard request form. R1 research-active institutions citing IRB approval and a clinical-research use case have well-established standing; this is not a "novel" entitlement request the way it would be for a personal account. **Expect Apple to approve without back-and-forth in 1–3 business days**, but factor in 1 round-trip for clarification just in case.

### Before you submit

Check first whether your team admin has **already** secured the entitlement at the team level for another app. If so, you can simply tick the **Clinical Health Records** sub-capability on the new App ID (step 2) and skip the form entirely. The institution's developer-portal admin will know.

### If you need to submit fresh

1. **Apple Developer Account → Contact → Health Records → Request access** (or via the App ID's HealthKit capability detail page; both routes lead to the same form).
2. The form will ask for:
   - **Team ID** (institutional team — auto-populated when you submit while logged in as a team member)
   - **Bundle ID** (whatever you registered in step 2)
   - **Use case** — paste this verbatim:
     > *StreamSync is an IRB-approved multi-center BPH research study (PI **Daniel Wong, MD**; lead-site IRB application filed at the University of Nevada, Reno — protocol number **\<TBD — fill in once issued\>**) enrolling 50 men with benign prostatic hyperplasia for longitudinal home uroflowmetry + Apple Watch monitoring across multiple academic medical centers. The app reads medications, conditions, and procedures from Apple Health Records during onboarding to confirm BPH-relevant clinical history with each participant. Records are read locally on the device with explicit per-category user consent and stored only in our encrypted Firestore database (covered under the lead site's BAA with Google Cloud). They are not transmitted to third parties or used outside the IRB-approved research protocol.*
   - **Privacy policy URL**: link to the consent doc copy already in the repo at [`lib/legal/`](../lib/legal/) once it's hosted publicly under a UNR-controlled domain (or use the UNR institutional privacy URL the research office maintains).
   - **App screenshots**: the Health tab → BPH Clinical Records card is the entire user-facing surface where these records appear. One screenshot of the card showing medications/conditions/procedures sections is sufficient.
   - **Data-handling description**: the records are de-identified per HIPAA Safe Harbor (no last name, no DOB, no full clinical dates — see [`src/services/throneFirestore.ts`](../src/services/throneFirestore.ts) for the de-id model) before any cloud-side processing.

3. **Expected turnaround for an institutional account**: 1–3 business days. If Apple comes back with questions, they're usually about the consent flow — point them at [`app/(onboarding)/consent.tsx`](../app/\(onboarding\)/consent.tsx) and the per-category permission UI.

While waiting: the `BphClinicalRecordsCard` on the Health tab continues to work for data confirmed during onboarding (it reads from `users/{uid}/medical_history/current`, which the prefill already populated). The entitlement only gates **new** clinical-record reads from HealthKit on production builds.

> **Free-tier "loophole" — won't matter to you.** The current personal-team dev build reads clinical records during onboarding because Apple is permissive on dev builds without the entitlement. With an institutional account going through proper review, you'll have the legitimate entitlement before TestFlight/App Store distribution; the loophole question doesn't apply.

---

## 5 · Update the entitlements file

Path: [`ios/StreamSync/StreamSync.entitlements`](../ios/StreamSync/StreamSync.entitlements)

**Current state** (after rolling back the personal-team push attempt):

```xml
<dict>
    <key>com.apple.developer.healthkit</key>
    <true/>
    <key>com.apple.developer.healthkit.background-delivery</key>
    <true/>
</dict>
```

**Target state** (paid team, both capabilities active):

```xml
<dict>
    <key>aps-environment</key>
    <string>development</string>

    <key>com.apple.developer.healthkit</key>
    <true/>

    <key>com.apple.developer.healthkit.background-delivery</key>
    <true/>

    <key>com.apple.developer.healthkit.access</key>
    <array>
        <string>health-records</string>
    </array>
</dict>
```

Notes:

- `aps-environment` should be `development` for dev / TestFlight Internal Testing builds and `production` for App Store + TestFlight External Testing builds. The `npm run ios:device:release` script uses `development`. EAS Build → production profiles should set this to `production` automatically; verify in your EAS profile.
- `com.apple.developer.healthkit.access` array value `health-records` is what gates clinical records. Add it ONLY after Apple approves the entitlement application from step 4 — including it before approval will cause the production provisioning profile to fail to generate.
- `Info.plist` already has `NSHealthClinicalHealthRecordsShareUsageDescription` (the user-facing copy shown when the OS prompts for clinical-records permission). No change needed there.

---

## 6 · Update Xcode signing

In Xcode:

1. Open `ios/StreamSync.xcworkspace`.
2. Select the **StreamSync** target → **Signing & Capabilities**.
3. **Team**: change from "Daniel Wong (Personal Team)" to your paid team.
4. **Automatically manage signing**: ON.
5. Confirm three capabilities are listed (add via "+" if missing):
   - **Push Notifications**
   - **HealthKit** (with `Clinical Health Records` checked once entitlement is approved)
   - **Background Modes** → check `Remote notifications` and `Background fetch`

Also update the project file directly:

```
ios/StreamSync.xcodeproj/project.pbxproj
```

Find `DEVELOPMENT_TEAM = 7C854P6638;` (current personal team ID) and replace with your paid team ID. There are typically two occurrences (Debug + Release config).

If using EAS Build → also update [`eas.json`](../eas.json) to point at the new credentials profile.

---

## 7 · Verify

### Push notifications

1. Run `npm run ios:device:release` from the project root. Watch for "BUILD SUCCEEDED" and `Done — app should be running on the device.`
2. Open the app on the iPhone, sign in. The app silently registers an Expo push token to `users/{uid}.expoPushTokens`. Confirm in Firebase Console → Firestore → `users/{your-uid}` that the `expoPushTokens` array now contains a value starting with `ExponentPushToken[…]`.
3. Open the researcher dashboard ([`https://streamsync-8ae79.web.app/dashboard/`](https://streamsync-8ae79.web.app/dashboard/)) → AI Support panel → "+ Start new chat" → pick yourself as the participant → send a test message.
4. Within ~5 seconds the iPhone should buzz with a push showing "StreamSync Research Team" and the message body — even if the app is closed and the phone is locked.
5. Tap the notification. It should deep-link into the support chat with the researcher's message visible.

If step 2 produces no token: verify the entitlement is in the built app's `Frameworks/StreamSync.app/StreamSync.app.xcent` after build (`unzip -p .../StreamSync.app StreamSync.app.xcent` or use `codesign -d --entitlements -`). The most common cause of "no token" is `aps-environment` getting stripped by the provisioning profile because the App ID doesn't have Push Notifications enabled.

### Clinical records

1. On the iPhone: Settings → Health → Health Records → Add Account → connect to a participating institution. For UNR-area testing, **Renown Health** is the regional health system to test with (UNR's primary hospital partner). For other dev workflows, any participating institution works (Stanford MyHealth, UCSF MyChart, etc. for a generic smoke test). Use a test patient account.
2. Wait for the records to download.
3. Open StreamSync → Profile → Permissions or run through onboarding for a fresh test user.
4. The "Clinical Records" permission prompt should appear. Grant access to medications, conditions, procedures.
5. Health tab → BPH Clinical Records card. Items downloaded from the institution should appear in the relevant sections (filtered by the BPH-relevance pattern list in [`lib/services/fhir/codes.ts`](../lib/services/fhir/codes.ts)).
6. Make a small edit + Save. Confirm `users/{uid}/medical_history/current` in Firestore reflects the change with a fresh `lastEditedAt` and `lastEditedBy: 'user'`.

If the clinical-records permission prompt doesn't appear: confirm `com.apple.developer.healthkit.access` is in the entitlements AND Apple has approved your entitlement application (step 4). On a non-approved app, the prompt is suppressed silently.

### Sync-alert remote push (the 4-hour-repeating reminder)

This currently fires as a **local** notification because the participant's iPhone schedules it itself ([`lib/services/notification-service.ts`](../lib/services/notification-service.ts) → `startRepeatingReminder`). Local notifications work without remote push.

If you want sync alerts to ALSO fire as a server-side remote push (so the elapsed-time string is always current as of fire time, not as of last app foreground), that's a future enhancement — not in scope for this handoff. The flow would be:

- Add a Cloud Scheduler / pubsub trigger that runs every hour, scans for stale-syncing participants, sends an Expo push.
- Code template: lift `notifyOnSupportMessage` and adapt for the stale-sync trigger.

Document this for after the handoff is complete; users will not notice the difference unless they leave the app closed for >24h.

---

## 8 · Files the handoff engineer will touch

Authoritative paths (relative to repo root):

| File | What changes |
|---|---|
| `ios/StreamSync/StreamSync.entitlements` | Add `aps-environment` + `com.apple.developer.healthkit.access`, see step 5 |
| `ios/StreamSync.xcodeproj/project.pbxproj` | `DEVELOPMENT_TEAM = ...;` (×2) — Debug + Release configs |
| `eas.json` (if using EAS) | Update production-build credentials block to reference the new team |

That's it. **No JavaScript / Swift code changes are required** to light up either capability. The supporting code is already shipped:

| Capability | Existing implementation |
|---|---|
| Expo push token registration | [`hooks/use-expo-push-registration.ts`](../hooks/use-expo-push-registration.ts) — runs on auth, saves to `users/{uid}.expoPushTokens` |
| Researcher-message remote push | [`functions/src/notifyOnSupportMessage.ts`](../functions/src/notifyOnSupportMessage.ts) — Firestore trigger, posts to Expo push API, prunes dead tokens |
| Notification-tap deep link router | [`hooks/use-notification-tap-router.ts`](../hooks/use-notification-tap-router.ts) — routes `data.screen === 'support-chat'` to the chat |
| HealthKit clinical-records read | [`modules/expo-clinical-records/`](../modules/expo-clinical-records/) + [`lib/services/healthkit/ClinicalRecordsClient.ts`](../lib/services/healthkit/ClinicalRecordsClient.ts) |
| BPH classification + Firestore write | [`lib/services/fhir/`](../lib/services/fhir/), [`lib/services/medical-history-edit.ts`](../lib/services/medical-history-edit.ts) |
| Health tab card UI | [`components/health/BphClinicalRecordsCard.tsx`](../components/health/BphClinicalRecordsCard.tsx) |
| Firestore rules already permitting writes | [`firestore.rules`](../firestore.rules) — `expoPushTokens` is in the owner-write allowlist |

---

## 9 · Risks & gotchas

- **Bundle-ID rename — likely required for institutional teams.** Most orgs won't want to ship under `com.dwong.homeflow`. The rename has a wide radius:
  - `ios/StreamSync.xcodeproj/project.pbxproj` → `PRODUCT_BUNDLE_IDENTIFIER` (×2 — Debug + Release)
  - `app.config.js` → `ios.bundleIdentifier` (if present) and `extra.eas.projectId` is unchanged
  - Apple Developer portal → register the new App ID + capabilities
  - Firebase Console → add a new iOS app entry to project `streamsync-8ae79` with the new bundle id, regenerate `GoogleService-Info.plist`, replace the old plist in `ios/StreamSync/`
  - Re-deploy the `claudeSupportChat` and `notifyOnSupportMessage` Cloud Functions only if they hard-code the bundle id (they don't currently — Firestore docs are keyed on UID, not bundle)
  - **Existing iPhone installs are orphaned** — they're tied to the old bundle id, which becomes a different app to iOS. Anyone testing the personal-team build today will need to delete the old StreamSync icon and install the org-team build fresh. Their Firebase Auth UID is preserved, so onboarding state and chat history follow them; only the iOS install side resets.

- **Institutional signing-cert policy.** Some orgs require Fastlane Match, EAS managed credentials, or an internal cert-management system rather than Xcode-managed certs. If the team has a policy, follow it from day one — switching mid-project is painful. Check with the team's developer-portal admin.

- **Provisioning-profile churn.** Re-pulling provisioning profiles after enabling new capabilities can take 5–10 min for the changes to propagate via Xcode's auto-signing. If the build still fails with "missing entitlement" errors, manually nuke `~/Library/MobileDevice/Provisioning Profiles/` and let Xcode regenerate. For institutional accounts using Fastlane Match, run `fastlane match nuke development && fastlane match development`.

- **EAS Build cache.** If you're using EAS, run `eas credentials` after the team change to ensure EAS picks up the new signing identity. Old cached credentials will silently sign with the old team. The `extra.eas.projectId` in `app.config.js` (`066cdee7-0684-41e8-a579-d5505029ed50`) does NOT change — it's the EAS project, not the Apple team.

- **App Store Connect distribution role.** Pushing builds to TestFlight or the App Store requires a separate **App Manager** or **Admin** role in App Store Connect (different from the Developer-portal team). On UNR-tier institutional accounts these roles are usually controlled by a small group of admins (UNR OIT or a dedicated app-portfolio owner); coordinate ahead of your first TestFlight upload — don't wait until you have a build ready to push.

- **HealthKit Clinical Records — institutional review path.** For R1 research-active accounts like UNR's citing IRB approval, Apple's review is fast but not skipped. Plan for the entitlement to land within a week; don't block the rest of the work waiting for it. The BPH card continues working off the prefill that's already in `medical_history/current`.

- **Cross-org app transfer is hard.** This is exactly the situation we're in NOW — moving from a personal team (`com.dwong.homeflow`) to UNR's institutional team. Apple's app-transfer process for App-Store-published apps has prerequisites (no in-app purchases tied to the source team, must be the same Apple ID admin on both sides, etc.). Since the personal-team build hasn't been published to App Store yet, **the cleanest path is to register a fresh App ID under UNR's team with a UNR-style bundle id** (per step 2) rather than trying to transfer `com.dwong.homeflow`. Pre-existing test installs on participants' phones become orphans (different bundle id = different app to iOS) — they'll need to delete + reinstall the new build. Auth state in Firebase persists.

---

## 10 · Smoke-test checklist (paste into a tracking ticket)

```
[ ] Confirmed App Manager / Admin role on the institutional Apple team
[ ] Confirmed institutional bundle-id convention with team admin
[ ] Renamed bundle id from com.dwong.homeflow → <institutional id> in:
    [ ] ios/StreamSync.xcodeproj/project.pbxproj
    [ ] app.config.js (if ios.bundleIdentifier is set)
    [ ] Apple Developer portal (App ID registered)
    [ ] Firebase Console (new iOS app added to streamsync-8ae79)
    [ ] ios/StreamSync/GoogleService-Info.plist (regenerated)
[ ] App ID capabilities enabled:
    [ ] Push Notifications
    [ ] HealthKit
    [ ] HealthKit Clinical Health Records (sub-capability)
    [ ] Background Modes (remote-notification)
[ ] Health Records entitlement application:
    [ ] Skipped (team admin confirmed it's already at team level), OR
    [ ] Submitted with IRB justification → Apple acknowledged → APPROVED
[ ] Updated ios/StreamSync/StreamSync.entitlements with the 3 new keys
[ ] Updated DEVELOPMENT_TEAM (×2) in ios/StreamSync.xcodeproj/project.pbxproj
[ ] Updated eas.json + ran eas credentials (if using EAS)
[ ] Build succeeds: npm run ios:device:release
[ ] users/{uid}.expoPushTokens populates after first launch
[ ] Researcher message → phone buzzes within 5s (app closed, locked)
[ ] Notification tap deep-links into support chat
[ ] iPhone Health Records connected to a test institution
[ ] Clinical records permission prompt appears in StreamSync onboarding
[ ] BPH Clinical Records card on Health tab shows imported medications/conditions/procedures
[ ] Edit + Save in BPH card writes to medical_history/current with audit fields
[ ] App Store Connect role configured for whoever ships TestFlight builds
```

---

## Questions for the handoff engineer

If anything in this doc is unclear, the original implementer (Claude Code session log: see git log + `CLAUDE.md`) can be reached via the same workflow. The key implementation milestones are:

- 2026-05-06: Initial AI support chat + push token registration code
- 2026-05-07: BPH Clinical Records card + medical-history-edit service
- 2026-05-07: Sleep / Vitals data-shape fixes (was producing NaN)
- 2026-05-07: Discharge/recovery instructions removed from app per research-app scope
- 2026-05-07: Project moved from Stanford-developed pilot → University of Nevada, Reno (UNR) institutional ownership

Total project context lives in [`CLAUDE.md`](../CLAUDE.md). The Cloud Function deploy target is `streamsync-8ae79`; only the Anthropic-backed `claudeSupportChat` requires the secret `ANTHROPIC_API_KEY` (already set).

### Outstanding TODOs (likely owned by the research team, not the iOS engineer)

These are non-iOS items that need research-team-side action before you can ship — flagged here so the engineer doesn't get stuck waiting:

- **Lead-site IRB protocol number.** [`lib/constants.ts`](../lib/constants.ts) → `STUDY_INFO.irbProtocol` is currently `'IRB# TBD'`. Once the UNR IRB (lead site) issues a protocol number, replace it there — that string flows into the consent doc, the Apple Health Records entitlement application, and any researcher-team-facing reports. For multi-center recruitment, the UNR-issued protocol number is the IRB of record; participating sites will rely on it via SMART IRB reciprocal review.
- **Principal Investigator: Daniel Wong, MD** is hard-coded in [`lib/constants.ts`](../lib/constants.ts) → `STUDY_INFO.principalInvestigator`. Update if the PI changes.
- **BAA with Google Cloud (Firebase).** Confirm the lead site's institutional BAA with Google Cloud covers the Firebase project `streamsync-8ae79`. If the BAA isn't in place, a migration to a BAA-covered project is needed before clinical data is collected from real participants.
- **Institutional consent-doc review.** [`lib/consent/consent-document.ts`](../lib/consent/consent-document.ts) carries the consent text shown in onboarding. The text is **institutionally agnostic** by design (refers to "multiple academic medical centers" / "the study's IRB of record" rather than naming a specific university), so it should be portable across enrollment sites with minimal site-specific edits. Each participating site's IRB will still need to bless its own copy as part of the multi-site approval.
- **Front-facing app stays university-agnostic.** The participant-facing UI never names a specific institution as the study host — this is intentional for multi-center recruitment. Don't hard-code institution names back into the consent doc, onboarding screens, or the AI Support chat's system prompt. UNR ownership of the **App Store binary** (via the institutional Apple Developer team) is metadata-only and never surfaced in the app UX.
- **Visual rebrand status.** The current theme uses `StanfordColors` (cardinal red) — see [`constants/theme.ts`](../constants/theme.ts) and the various `StanfordColors.cardinal` imports across the onboarding screens. The PI has decided to keep this color scheme; no rebrand to UNR-tier silver/blue is planned. The token names are misleading (they're really just "the app's red") — renaming them is a low-priority cleanup, not a blocker.
