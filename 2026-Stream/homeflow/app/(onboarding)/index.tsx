/**
 * Onboarding Router
 *
 * Determines which onboarding screen to show based on current step.
 * Automatically routes to the correct screen on mount.
 */

import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect, useRouter, Href } from 'expo-router';
import { useOnboardingStep, useOnboardingStatus, useHasEverOnboarded } from '@/hooks/use-onboarding-status';
import { OnboardingStep } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { StanfordColors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';

export default function OnboardingRouter() {
  const router = useRouter();
  const currentStep = useOnboardingStep();
  const { user, isAuthenticated } = useAuth();
  // During onboarding the user may or may not be authenticated yet — account
  // creation happens mid-flow. Passing user?.id as it becomes available
  // ensures the "already complete?" check re-evaluates once they sign up.
  const isOnboardingComplete = useOnboardingStatus(user?.id ?? null);
  const hasEverOnboarded = useHasEverOnboarded();

  useEffect(() => {
    let cancelled = false;

    async function initializeOnboarding() {
      const hasStarted = await OnboardingService.hasStarted();

      if (!hasStarted && !cancelled) {
        // First time - start onboarding
        await OnboardingService.start();
        router.replace('/(onboarding)/welcome' as Href);
      }
    }

    if (!isOnboardingComplete) {
      initializeOnboarding();
    }

    return () => {
      cancelled = true;
    };
  }, [router, isOnboardingComplete]);

  // If onboarding is already finished for this user, skip to tabs immediately
  if (isOnboardingComplete === true) {
    return <Redirect href="/(tabs)" />;
  }

  // Returning logged-out user on a used device — don't bounce them into
  // onboarding, send them to login. They signed out on purpose; they know
  // they have an account. Fresh installs (hasEverOnboarded === false)
  // keep showing the welcome flow.
  if (!isAuthenticated && hasEverOnboarded === true) {
    return <Redirect href={'/(auth)/login' as Href} />;
  }

  // Show loading while determining step
  if (currentStep === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={StanfordColors.cardinal} />
      </View>
    );
  }

  // Route based on current step
  switch (currentStep) {
    case OnboardingStep.WELCOME:
      return <Redirect href={'/(onboarding)/welcome' as Href} />;

    case OnboardingStep.CHAT:
      return <Redirect href={'/(onboarding)/chat' as Href} />;

    case OnboardingStep.CONSENT:
      return <Redirect href={'/(onboarding)/consent' as Href} />;

    case OnboardingStep.ACCOUNT:
      return <Redirect href={'/(onboarding)/account' as Href} />;

    case OnboardingStep.PERMISSIONS:
      return <Redirect href={'/(onboarding)/permissions' as Href} />;

    case OnboardingStep.MEDICAL_HISTORY:
      return <Redirect href={'/(onboarding)/medical-history' as Href} />;

    case OnboardingStep.BASELINE_SURVEY:
      return <Redirect href={'/(onboarding)/baseline-survey' as Href} />;

    case OnboardingStep.COMPLETE:
      // Show complete screen - user needs to click "Get Started" to finish
      return <Redirect href={'/(onboarding)/complete' as Href} />;

    default:
      return <Redirect href={'/(onboarding)/welcome' as Href} />;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
