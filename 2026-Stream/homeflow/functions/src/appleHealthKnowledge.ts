/* eslint-disable max-len */
/**
 * Apple Health + Apple Watch Knowledge Base
 *
 * Distilled from Apple's official support documentation at
 * https://support.apple.com so the StreamSync AI Support chat can answer
 * iPhone / Watch / Health-app questions with steps that match what Apple
 * themselves publish. Companion to throneSupportKnowledge.ts.
 *
 * Refresh policy: this file is regenerated alongside the Throne knowledge
 * file. See `scripts/refresh-throne-prompt.md` for the workflow — the same
 * Claude-Code-driven process applies, just point it at this file and the
 * Apple URLs listed at the bottom of this comment.
 *
 * IMPORTANT: do NOT inline entire Apple support articles here. We pick the
 * SHORTEST distilled form of each — enough that Claude can answer common
 * questions verbatim, but not so much that we bloat every Anthropic call
 * by 5–10k tokens. Long-form clarification routes the participant to the
 * source URL.
 */

export const APPLE_KNOWLEDGE_REFRESHED_ON = "2026-05-07";

export const APPLE_HEALTH_KNOWLEDGE = `
## Apple Health + Apple Watch (sourced from support.apple.com — refreshed ${APPLE_KNOWLEDGE_REFRESHED_ON})

When the participant asks about Apple Watch pairing, syncing, or Health-app permissions, follow these procedures verbatim. They come from Apple's official support docs. If a question goes beyond what's covered here, link the user to the relevant article URL below.

### Watch–iPhone connection troubleshooting (in order)
If the Watch is showing a red disconnect icon, or HealthKit data has gone stale even though they're wearing the Watch:
1. Bring the Watch and iPhone into the same room — Bluetooth range is ~30 ft / 10 m.
2. On iPhone: open Control Center → confirm Airplane Mode OFF, Wi-Fi ON, Bluetooth ON.
3. On Watch: swipe up to open Control Center → confirm Airplane Mode OFF.
4. Restart both devices: power-cycle the iPhone, then power-cycle the Watch (side button → power off slider).
5. If still disconnected after restart, unpair and re-pair from scratch via the iPhone's Watch app → My Watch → All Watches → tap the (i) → Unpair Apple Watch.
Source: https://support.apple.com/en-us/108360

### Pairing trouble — when re-pairing won't work
If the participant tried unpair + re-pair from #5 above and the pairing flow itself stalls:
1. Try the in-pairing-mode reset: with the Watch on the "pair to iPhone" screen, press and hold the Digital Crown until a red Reset button appears, then tap Reset and follow Apple's prompts.
2. If the Watch is stuck on a different screen and they don't have the paired iPhone available: Watch Settings → General → Reset → "Erase All Content and Settings."
3. If the Watch is locked (forgot passcode): place it on its charger → press and hold the side button until the power-button screen appears → press and hold the Digital Crown until the red Reset button appears → tap Reset twice.
4. After any of the above, Activation Lock remains on — re-pairing requires the original Apple Account password.
Source: https://support.apple.com/en-us/111821

### Updating watchOS (do this BEFORE assuming a sync bug is StreamSync's fault)
Stale watchOS frequently causes HealthKit sync regressions. Preconditions: Watch ≥50% battery, on charger, iPhone on Wi-Fi, iPhone running latest iOS.
1. Open the Watch app on iPhone → My Watch → General → Software Update.
2. Download — enter device passcodes if prompted.
3. Keep both devices nearby and the Watch on its charger; updates take "several minutes to an hour."
4. Don't restart either device or close the Watch app while the update runs.
Alternative (watchOS 6+): on the Watch directly → Settings → General → Software Update → Install.
Source: https://support.apple.com/en-us/108926

### Granting StreamSync permission to read Health data
This is the single most common cause of "Apple Health says I have data but StreamSync doesn't show it." StreamSync needs explicit Health-data read permissions per metric.
1. iPhone → open Health app → tap profile picture (top right) → Privacy → Apps.
2. Tap StreamSync.
3. Toggle ON every health category we monitor: Active Energy, Exercise Minutes, Heart Rate, HRV (heart rate variability), Resting Heart Rate, Step Count, Stand Time, Sleep Analysis, Respiratory Rate, Oxygen Saturation, Body Mass, Height. (Anything turned off here is invisible to StreamSync.)
4. Open StreamSync — the new data should appear within a minute. If not, force-quit StreamSync and reopen.
Source: https://support.apple.com/en-us/108779

### Confirming Apple Watch is sharing to the Health app at all
If permissions look right but the Health app itself shows no Watch data:
1. iPhone → Health app → profile picture → Devices → tap your Apple Watch → Privacy Settings.
2. Confirm "Fitness Tracking" is ON (without this, the Watch won't write to HealthKit at all).
3. iPhone → Settings → Privacy & Security → Motion & Fitness → confirm Fitness Tracking ON globally.
Source: https://support.apple.com/en-us/108779

### Heart-rate accuracy / "my heart rate readings look weird"
If the participant flags abnormal heart-rate or HRV readings, this is usually fit / wear-related, not a Watch defect:
- The Watch must be SNUG on the top of the wrist — sensor flush against skin, no gap.
- Tighten the band specifically when starting an exercise; loosen after.
- Tattoos with heavy ink saturation can block the sensor. If the participant has wrist tattoos under the sensor, this is a known limitation; we can't fix it.
- Cold temperatures reduce skin perfusion → less reliable readings during winter activity.
- Wrist Detection MUST be enabled (iPhone → Watch app → Passcode → Wrist Detection) — otherwise no background heart-rate sampling happens.
- iPhone → Watch app → Privacy → confirm Heart Rate is ON.
- Calibrate the Watch outdoors with GPS (20-min walk in good weather) — improves both heart-rate inference and distance accuracy.
Source: https://support.apple.com/en-us/105002

### Background App Refresh (essential for HealthKit sync)
StreamSync's HealthKit pipeline relies on iOS launching the app in the background to push samples to Firestore. If Background App Refresh is off, sync only happens when the participant opens the app:
1. iPhone → Settings → General → Background App Refresh.
2. Confirm the top toggle is ON (not Off, not Wi-Fi only — "Wi-Fi & Cellular" preferred).
3. Scroll to StreamSync → confirm its toggle is ON.
4. Same for Apple Health if it appears in the list.

### Health Records (clinical records from healthcare provider — OPTIONAL during onboarding)
Health Records is Apple's feature for downloading clinical records (allergies, conditions, medications, labs, immunizations, vitals, procedures) from a participating healthcare organization directly into the iPhone Health app. StreamSync can read those records via HealthKit if the participant has connected their healthcare provider AND granted us read permission.

**To set up Health Records on iPhone:**
1. iPhone → open Health app → Summary tab.
2. Tap profile picture / initials in the top right.
3. Tap Health Records → tap "Add Account".
4. Search for the participant's healthcare organization (e.g. "Stanford", "UCSF", "Kaiser") — Apple supports thousands of US institutions; the directory is at https://institutions.healthrecords.apple.com.
5. Sign in with the participant's patient-portal credentials for that institution.
6. Records download over an encrypted connection directly from the institution to the iPhone — they do NOT traverse Apple's servers.
7. To add a second institution, repeat from step 3. To remove an institution, tap Health Records → tap the institution name → Remove Account.

**Prerequisites:**
- iOS 15 or later (older iOS can use the basic feature but the Share-with-Provider flow needs 15+).
- The participant must have an active patient-portal account at a participating institution.
- They must remember their patient-portal username + password — Health Records uses those credentials to authenticate.

**Privacy notes for participants who hesitate:**
- Records are downloaded via an encrypted connection directly from the healthcare organization to the iPhone; the data does NOT traverse Apple's network.
- Once on the iPhone, the records sit in the encrypted HealthKit database. With iOS 12+ and 2FA on iCloud, data syncs to other devices end-to-end encrypted; only the participant can access it.
- Third-party apps (including StreamSync) can only see what the participant explicitly approves — no blanket "all records" toggle.

**Granting StreamSync access to Health Records:**
This is the second permission gate after the basic HealthKit access (step "Granting StreamSync permission to read Health data" above). The clinical-record types appear LOWER in the permissions list, under headers like "Clinical Vitals," "Lab Results," "Medications," "Conditions," etc.
1. iPhone → Health app → profile picture → Privacy → Apps → StreamSync.
2. Scroll to find the clinical-records categories.
3. Toggle ON every category we collect: Allergies, Conditions, Immunizations, Lab Results, Medications, Procedures, Vitals.
4. By default, the participant is asked to approve EACH new record before it shares — they can change this in Health → Privacy → Apps → StreamSync to auto-share new records of an approved type.

Source (privacy + security): https://support.apple.com/en-us/111755
Source (prerequisites): https://support.apple.com/guide/healthregister/prerequisites-apd37a16fe14/web
Source (institution directory): https://institutions.healthrecords.apple.com

### SMART on FHIR (alternative to Health Records — same data, different transport)
StreamSync also supports connecting directly to a healthcare provider via SMART on FHIR — this is a different mechanism than Apple Health Records. The participant authenticates with their hospital's OAuth flow inside the StreamSync app, and StreamSync reads FHIR resources directly from the provider's server.

When to recommend SMART on FHIR vs Health Records:
- Their healthcare org is in the StreamSync SMART config but NOT in Apple's institution directory: SMART on FHIR is the only path.
- They want StreamSync to see clinical data without storing it in iPhone Health: SMART on FHIR (data goes provider → StreamSync, never touches HealthKit).
- They already have Health Records set up and StreamSync's HealthKit permissions are toggled: both work; either is fine.

The SMART on FHIR connection lives in StreamSync's onboarding "Permissions" step and can be re-run later from Profile → Connected Providers (if they didn't connect during onboarding).

### Watch battery / charging affecting reliability
- Workouts / continuous monitoring drain battery faster — if the Watch dies overnight it can't write data.
- Always-On Display further reduces battery; recommend disabling for participants whose Watch dies before bedtime: Watch app → Display & Brightness → Always On → off.
- Charge the Watch nightly. If charging is unreliable, swap chargers / try a different USB-C/Lightning brick.

### Escalation — when to bounce the participant to Apple vs the StreamSync research team
Send to Apple Support directly when:
- Hardware suspect: Watch isn't charging at all, screen is cracked, sensor flat-out broken.
- watchOS update fails repeatedly.
- Activation Lock can't be cleared (lost Apple ID password).

Keep with StreamSync support when:
- Watch shows data in Health app but NOT in StreamSync (this is our pipeline, not Apple's).
- Permission toggles all look ON but StreamSync still empty.
- Questions about which metrics we collect, what time windows, how to interpret StreamSync's charts.
`.trim();
