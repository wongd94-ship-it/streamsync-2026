---
name: build-streamsync
description: Build, install, and launch the StreamSync iOS app on a physical iPhone. Use this skill whenever the user asks to build the app, install on the phone, deploy to iPhone, run on device, rebuild after a code change, or test on the physical device. Triggers include "build streamsync", "rebuild streamsync", "install on my phone", "deploy to iphone", "run on device", "build the ios app", "build and install", "ship to my phone", "test on iphone". Always uses `npm run ios:device:release` (Release configuration with the JS bundle embedded) — never `expo run:ios` or plain `npm run ios:device`, which produce Debug builds that fail with "no script URL provided" unless Metro is already running.
---

# Build StreamSync to iPhone

When the user asks for any kind of "build StreamSync" / "install on phone" / "deploy to iPhone" task, run the project's canonical build script. **Do not** invent a different build command — any other path leads to the "no script URL provided" error class or breaks code-signing.

## The one command

```bash
cd /Users/dgw/Documents/Streamsync/2026-Stream/homeflow
npm run ios:device:release
```

That script (`scripts/ios-device-release.sh`) does the full pipeline:

1. Auto-detects the connected iPhone via `xcrun xctrace list devices` (or accepts a UDID arg)
2. Runs `xcodebuild -configuration Release -allowProvisioningUpdates` against `ios/StreamSync.xcworkspace`
3. Locates the built `.app` from `BUILT_PRODUCTS_DIR` (BSD-awk-safe, not GNU `\s`)
4. Installs it via `xcrun devicectl device install app`
5. Launches via `xcrun devicectl device process launch com.dwong.homeflow`

The build is **Release**, not Debug — that means the JS bundle is embedded in the `.app`, so the phone doesn't need Metro running, doesn't need to be on the same Wi-Fi as the laptop, and works fully offline.

## Why not `expo run:ios --device`

That command produces a **Debug** build, which expects a running Metro dev server on the same network. Without Metro, the app launches and immediately throws "No script URL provided." It also doesn't pass `-allowProvisioningUpdates` to xcodebuild, so the first build on a new device fails at code-signing with "No profiles for 'com.dwong.homeflow' were found."

`npm run ios:device:release` solves both of these.

## Operating notes

- **Build time**: 5–10 min for an incremental build, 15+ min for a clean build. The script writes a full log to `/tmp/streamsync_ios_release.log` if you need to inspect a failure.
- **Long-running**: kick it off with `Bash` `run_in_background: true`, then watch the log with `Monitor` using a filter like `grep -E "BUILD SUCCEEDED|BUILD FAILED|: error:"`. Don't poll-and-sleep.
- **First launch on a fresh cert**: iOS will refuse to launch the app the first time a new developer certificate is on the phone. The user has to go to **Settings → General → VPN & Device Management → Apple Development: \<email\> → Trust**. The script prints this hint when it sees a launch-time security error.
- **No CocoaPods step needed in the script**: pods are committed to the iOS workspace state. If `node_modules` was wiped, the user will need to `cd ios && pod install` once before the script will succeed.

## When NOT to use this skill

- The user wants to run on the **simulator** → use `npm run ios:sim` instead (Debug + simulator is fine, no Metro/device complications).
- The user wants to start **Metro for active development** → `npm start` or `npm run ios:metro`.
- The user is asking about **deploying to TestFlight or App Store** → that needs an Archive build via Xcode and a Distribution profile — different workflow, this skill won't help.

## Project context

- Bundle ID: `com.dwong.homeflow`
- Apple Developer Team: `7C854P6638`
- Workspace: `ios/StreamSync.xcworkspace`
- Scheme: `StreamSync`
- Firebase project: `streamsync-8ae79`
- Cloud function backing the AI Support chat: `claudeSupportChat` (https://us-central1-streamsync-8ae79.cloudfunctions.net/claudeSupportChat)

## Edge cases

- **No iPhone connected**: the script exits cleanly with a "plug one in" message. Don't suggest the user run it again until they confirm the phone is connected.
- **Multiple iPhones connected**: the script picks the first one. If the user has more than one, prompt for the UDID and pass it as the script's first arg: `npm run ios:device:release -- 00008140-XXXXXXXXX`.
- **`xcodebuild` reports "No profiles for 'com.dwong.homeflow' were found"**: the `-allowProvisioningUpdates` flag should already be passed; if it's still failing, the user's Apple ID may not be signed into Xcode. Have them open `ios/StreamSync.xcworkspace` in Xcode and verify "Automatic signing" + a team is selected on the StreamSync target's Signing & Capabilities tab.
