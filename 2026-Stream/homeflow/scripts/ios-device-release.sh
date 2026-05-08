#!/usr/bin/env bash
#
# Build StreamSync as a Release configuration, install on a connected iPhone,
# and launch it. A Release build EMBEDS the JS bundle in the .app — so the
# phone does not need Metro running, does not need to be on the same Wi-Fi as
# the laptop, and works fully offline. This is the right command for "I just
# want to use the build that's on my phone."
#
# Usage:
#   scripts/ios-device-release.sh [device-udid]
#
# If no UDID is given, picks the first connected iPhone. Run
# `xcrun xctrace list devices | grep -v Simulator` to see UDIDs.
#
# Requires:
#   - Xcode + CocoaPods installed
#   - Pods already installed (run `cd ios && pod install` if first time after
#     a node_modules wipe)
#   - Apple Developer team configured in ios/StreamSync.xcodeproj
#   - Device unlocked, paired, and trusted

set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"
WORKSPACE="$PROJECT_ROOT/ios/StreamSync.xcworkspace"
SCHEME="StreamSync"
BUNDLE_ID="com.dwong.homeflow"
CONFIG="Release"
LOG=/tmp/streamsync_ios_release.log

if [[ ! -d "$WORKSPACE" ]]; then
  echo "[ios:device:release] No iOS workspace at $WORKSPACE — run \`npx expo prebuild --platform ios\` first."
  exit 1
fi

# Resolve target device — accept arg, else pick first connected iPhone.
if [[ "${1:-}" != "" ]]; then
  UDID="$1"
else
  UDID=$(xcrun xctrace list devices 2>&1 | awk -F'[()]' '/iPhone .*\(([0-9]+\.[0-9.]+)\) \(([0-9A-F-]+)\)/ && !/Simulator/ {print $(NF-1); exit}')
fi
if [[ -z "${UDID:-}" ]]; then
  echo "[ios:device:release] No physical iPhone found. Plug one in, trust the laptop, then re-run."
  exit 1
fi
echo "[ios:device:release] Target device: $UDID"

# Build
echo "[ios:device:release] Building Release configuration — this is slow the first time…"
: > "$LOG"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "id=$UDID" \
  -allowProvisioningUpdates \
  build > "$LOG" 2>&1 || {
    echo "[ios:device:release] Build failed. Last 20 lines of log:"
    tail -20 "$LOG"
    echo "[ios:device:release] Full log: $LOG"
    exit 1
  }
echo "[ios:device:release] Build succeeded."

# Locate the .app — pull BUILT_PRODUCTS_DIR + FULL_PRODUCT_NAME from xcodebuild's
# build settings. The earlier awk-based version used GNU \s which BSD awk
# (the macOS default) silently accepts but never matches, so this uses
# field positions directly: `KEY = VALUE` → field 3 is the value.
SETTINGS=$(xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "id=$UDID" \
  -showBuildSettings 2>/dev/null)
BUILT_DIR=$(printf '%s\n' "$SETTINGS" | awk '$1=="BUILT_PRODUCTS_DIR" {print $3; exit}')
PRODUCT_NAME=$(printf '%s\n' "$SETTINGS" | awk '$1=="FULL_PRODUCT_NAME" {print $3; exit}')
APP_PATH="$BUILT_DIR/$PRODUCT_NAME"
if [[ ! -d "$APP_PATH" ]]; then
  echo "[ios:device:release] Couldn't find built .app at: $APP_PATH"
  exit 1
fi
echo "[ios:device:release] .app: $APP_PATH"

# Install + launch
echo "[ios:device:release] Installing on device…"
xcrun devicectl device install app --device "$UDID" "$APP_PATH" >/dev/null
echo "[ios:device:release] Launching $BUNDLE_ID…"
LAUNCH_OUT=$(xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" 2>&1) || LAUNCH_RC=$?
LAUNCH_RC="${LAUNCH_RC:-0}"
echo "$LAUNCH_OUT"

if [[ $LAUNCH_RC -ne 0 ]]; then
  if echo "$LAUNCH_OUT" | grep -q "device was not, or could not be, unlocked"; then
    echo ""
    echo "[ios:device:release] Build + install succeeded. iOS refused to auto-launch"
    echo "                    because the phone is LOCKED. Unlock your iPhone and"
    echo "                    tap the StreamSync icon to open the new build."
    exit 0
  fi
  if echo "$LAUNCH_OUT" | grep -qE "invalid code signature|profile has not been explicitly trusted"; then
    echo ""
    echo "[ios:device:release] Build + install succeeded, but iOS won't launch the app"
    echo "                    until the developer cert is trusted. On the iPhone:"
    echo "                      Settings → General → VPN & Device Management"
    echo "                      → Apple Development: <your-email> → Trust"
    echo "                    Then re-run this script (or just open the app from the home screen)."
    exit 0
  fi
  echo ""
  echo "[ios:device:release] Launch failed with an unexpected error — see above."
  exit 1
fi
echo "[ios:device:release] Done — app should be running on the device."
