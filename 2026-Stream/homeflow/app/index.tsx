/**
 * Root Index
 *
 * Initial route that redirects based on onboarding and auth status.
 * Flow: Onboarding -> Auth -> Main App
 */

import React from 'react';
import { Redirect, Href } from 'expo-router';
import { useOnboardingStatus, useHasEverOnboarded } from '@/hooks/use-onboarding-status';
import { useAuth } from '@/hooks/use-auth';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { isDevAuthSkipped } from '@/lib/dev-flags';

export default function RootIndex() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const onboardingComplete = useOnboardingStatus(user?.id ?? null);
  const hasEverOnboarded = useHasEverOnboarded();

  if (onboardingComplete === null || isLoading || hasEverOnboarded === null) {
    return <LoadingScreen />;
  }

  const authed = isAuthenticated || isDevAuthSkipped();

  // Signed-in user — dashboard if their onboarding is complete, otherwise
  // resume onboarding at whatever step they were on.
  if (authed) {
    if (onboardingComplete) {
      return <Redirect href="/(tabs)" />;
    }
    return <Redirect href={'/(onboarding)' as Href} />;
  }

  // Unauthenticated user. If anyone has ever onboarded on this device,
  // land on the login screen (they're probably a returning user who
  // signed out). Otherwise show the onboarding welcome flow so new
  // users can sign up fresh.
  if (hasEverOnboarded) {
    return <Redirect href={'/(auth)/login' as Href} />;
  }
  return <Redirect href={'/(onboarding)' as Href} />;
}
