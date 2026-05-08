import React, { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

// Suppress all JS warnings in the dev overlay so the Expo warning toast does not
// fire macOS UserNotificationCenter alerts that block Simulator interaction.
// Safe to remove once the app is ready for production.
import { LogBox as RNLogBox } from 'react-native';
RNLogBox.ignoreAllLogs();
// Global CSS for web (theming for alert dialogs, etc.) - only processed on web
import '@/assets/styles/global.css';
import { bootstrapHealthKitSync } from '@/src/services/healthkitSync';
import { registerHealthKitBackgroundSync } from '@/src/services/healthkitBackgroundSync';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/src/services/firebase';

import { useOnboardingStatus, useHasEverOnboarded } from '@/hooks/use-onboarding-status';
import { useAuth } from '@/hooks/use-auth';
import { useDataSyncCheck } from '@/hooks/use-data-sync-check';
import { useIPSSTaskSetup } from '@/hooks/use-ipss-task-setup';
import { useNotificationTapRouter } from '@/hooks/use-notification-tap-router';
import { useExpoPushRegistration } from '@/hooks/use-expo-push-registration';
import { useResearcherMessageBuzz } from '@/hooks/use-researcher-message-buzz';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { ErrorBoundary } from '@/components/error-boundary';
import { StandardProvider, useStandard } from '@/lib/services/standard-context';
import { AppThemeProvider, useAppTheme } from '@/lib/theme/ThemeContext';

// Module-level guards — survive Fast Refresh hot reloads (unlike useRef).
const _bootstrappedUids = new Set<string>();
const _throneSyncRequestedUids = new Set<string>();
const _hkBgRegisteredUids = new Set<string>();

export const unstable_settings = {
  // Initial route while loading
  initialRouteName: 'index',
};

// TEMP DEV BYPASS: skip auth requirement so tabs are accessible without signing in.
// Remove this (and the uses below) when auth is ready to test end-to-end.
const DEV_BYPASS_AUTH = false;

/**
 * Navigation stack with onboarding, auth, and main app routes
 */
function RootLayoutNav() {
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  // Per-uid onboarding state — passing user?.id ensures that a different
  // account on the same device sees a fresh onboarding flow.
  const onboardingComplete = useOnboardingStatus(user?.id ?? null);
  // Device-level flag — has ANY user ever completed onboarding on this
  // device? Combined with isAuthenticated it tells us whether an unauth
  // user should land on login (device has history) or welcome (fresh
  // install). Without this signal, the old router sent post-logout users
  // back into the onboarding stack because the per-uid "complete" flag
  // is false once they sign out.
  const hasEverOnboarded = useHasEverOnboarded();

  // Launch telemetry — one line per render during the first few seconds so
  // future "why did I get redirected to login?" bugs can be diagnosed from
  // device logs without a debugger attached.
  useEffect(() => {
    console.info('[launch]', JSON.stringify({
      authLoading,
      isAuthenticated,
      onboardingComplete,
      hasEverOnboarded,
      uid: user?.id ?? null,
      time: new Date().toISOString(),
    }));
  }, [authLoading, isAuthenticated, onboardingComplete, hasEverOnboarded, user?.id]);

  // Seed IPSS follow-up tasks at 1, 2, and 3 months post-surgery
  useIPSSTaskSetup();

  // Run bootstrapHealthKitSync exactly once per signed-in uid.
  // Module-level Set survives Fast Refresh; a ref would reset on every hot reload.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    if (_bootstrappedUids.has(uid)) return;
    _bootstrappedUids.add(uid);

    // Delay 8 s so the home screen's own HealthKit queries (12 parallel
    // reads for the activity rings) get a fair shot at the HealthKit
    // queue before the bootstrap sync piles on behind them. HealthKit
    // serializes concurrent queries on one internal thread; without a
    // generous head-start the tab bar and rings feel unresponsive for
    // several seconds after a force-quit relaunch. bootstrapHealthKitSync
    // itself also runs its metric syncs sequentially now.
    const timer = setTimeout(() => {
      bootstrapHealthKitSync().catch((err) =>
        console.error("[HealthKit] bootstrapHealthKitSync error:", err),
      );
    }, 8000);

    return () => clearTimeout(timer);
  }, [user?.id]);

  // Register HealthKit background delivery + BGTaskScheduler once per uid.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    if (_hkBgRegisteredUids.has(uid)) return;
    _hkBgRegisteredUids.add(uid);

    registerHealthKitBackgroundSync().catch((err) =>
      console.warn('[HealthKit BG] registration failed', err),
    );
  }, [user?.id]);

  // On first open per uid: write a Firestore doc that triggers the Cloud Function
  // to pull Throne data immediately. After the first sync the daily 3 AM schedule takes over.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    if (_throneSyncRequestedUids.has(uid)) return;
    _throneSyncRequestedUids.add(uid);

    async function requestSyncIfNeeded() {
      // Always write on app open — the cloud function rate-limits to once/hour.
      await setDoc(
        doc(db, `users/${uid}/sync_requests/latest`),
        { requestedAt: new Date().toISOString(), source: 'app_open' },
      );
    }

    requestSyncIfNeeded().catch((err) =>
      console.warn('[Throne] sync request error:', err),
    );
  }, [user?.id]);

  // Run 48-hour data sync check only when user is fully in the app
  useDataSyncCheck(!!onboardingComplete && isAuthenticated);

  // Route sync-alert notification taps to the AI Support chat. Only active
  // once the user is fully past onboarding, so the redirect guards below
  // don't cancel the navigation.
  useNotificationTapRouter(!!onboardingComplete && isAuthenticated);

  // Register an Expo push token for this device + user, saved to
  // /users/{uid}.expoPushTokens. Picked up by the notifyOnSupportMessage
  // Cloud Function so researcher messages buzz the phone in real time.
  // No-ops on free Apple Developer tier (no Push Notifications capability);
  // the foreground-listener fallback below covers that case.
  useExpoPushRegistration(!!onboardingComplete && isAuthenticated);

  // Foreground / recently-backgrounded fallback for researcher messages.
  // Subscribes to the active support chat and fires a local notification
  // whenever a new researcher message lands. Once Apple Dev is upgraded and
  // remote push works, this still runs harmlessly — duplicate buzzes are
  // suppressed by the per-chat unread-count tracking inside the hook.
  useResearcherMessageBuzz(!!onboardingComplete && isAuthenticated);

  // While checking onboarding/auth status, show loading
  if (onboardingComplete === null || authLoading || hasEverOnboarded === null) {
    return <LoadingScreen />;
  }

  const authed = isAuthenticated || DEV_BYPASS_AUTH;

  // Stack guards — block access to each group for obviously-wrong states,
  // but leave them permissive enough that explicit user-initiated
  // navigation (e.g. tapping "Sign Up" from the login screen) can reach
  // any group. The DEFAULT landing on app launch is picked imperatively
  // by app/index.tsx via <Redirect>, not by these guards.
  //
  //   - (onboarding) blocked only for authed+complete users. Unauth
  //     users need access for fresh install AND for explicit Sign Up.
  //     Authed+incomplete users need access to resume.
  //   - (auth) blocked only for already-authenticated users.
  //   - (tabs) requires both authenticated AND onboarding complete.
  const blockOnboarding = authed && onboardingComplete === true;
  const blockAuth = authed;
  const blockTabs = !authed || onboardingComplete !== true;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Onboarding flow */}
      <Stack.Screen
        name="(onboarding)"
        options={{ animation: 'fade' }}
        redirect={blockOnboarding}
      />

      {/* Auth flow */}
      <Stack.Screen
        name="(auth)"
        options={{ animation: 'fade' }}
        redirect={blockAuth}
      />

      {/* Main app */}
      <Stack.Screen
        name="(tabs)"
        redirect={blockTabs}
      />

      {/* Modal screens */}
      <Stack.Screen
        name="questionnaire"
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="modal"
        options={{ presentation: 'modal', title: 'Modal', headerShown: true }}
      />
      <Stack.Screen
        name="consent-viewer"
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="throne-session"
        options={{ headerShown: false }}
      />

      {/* Per-HealthKit-type status screen, replaces the old Data Permissions modal */}
      <Stack.Screen
        name="permissions-status"
        options={{ headerShown: false }}
      />

      {/* AI Support chat — opened by sync-alert notification taps and the
          "Get Help" row in profile. Uses fullScreenModal (not the iOS sheet
          'modal' style) so that the keyboard's reported frame is in the
          same coordinate space as the screen — KeyboardAvoidingView's
          offset=0 lines the input bar up flush against the keyboard. With
          the sheet style, the keyboard appears to overlap the input. */}
      <Stack.Screen
        name="support-chat"
        options={{ presentation: 'fullScreenModal', headerShown: false }}
      />

      {/* Index route for initial redirect */}
      <Stack.Screen
        name="index"
        options={{ animation: 'none' }}
      />
    </Stack>
  );
}

function AppContent({ children }: { children: React.ReactNode }) {
  const { isLoading } = useStandard();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}

/**
 * Inner shell — has access to AppThemeProvider so it can read the resolved theme
 * and pass it to React Navigation's ThemeProvider + StatusBar.
 */
function ThemedApp() {
  const { theme } = useAppTheme();

  return (
    <ThemeProvider value={theme.isDark ? DarkTheme : DefaultTheme}>
      <StandardProvider>
        <AppContent>
          <RootLayoutNav />
          <StatusBar style={theme.isDark ? 'light' : 'dark'} />
        </AppContent>
      </StandardProvider>
    </ThemeProvider>
  );
}

/**
 * Root Layout
 *
 * Handles onboarding, authentication, and main app navigation.
 * Flow: Onboarding -> Auth -> Main App
 */
export default function RootLayout() {
  return (
    <ErrorBoundary>
      <AppThemeProvider>
        <ThemedApp />
      </AppThemeProvider>
    </ErrorBoundary>
  );
}
