/**
 * Onboarding status hook
 *
 * Provides real-time onboarding status for navigation guards
 * and UI components.
 */

import { useState, useEffect, useCallback } from 'react';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { OnboardingStep } from '@/lib/constants';

/**
 * Simple event emitter for onboarding status changes
 */
type StatusListener = () => void;
const statusListeners: Set<StatusListener> = new Set();

export function notifyOnboardingComplete(): void {
  statusListeners.forEach((listener) => listener());
}

/**
 * Hook that returns whether ANY user has ever completed onboarding on
 * this device. Used by the root router to distinguish a fresh install
 * (send unauthenticated user to onboarding) from a returning device
 * (send unauthenticated user to login). Returns null while loading.
 *
 * This is a device-level flag — it is never cleared automatically.
 * OnboardingService.complete(uid) sets it.
 */
export function useHasEverOnboarded(): boolean | null {
  const [status, setStatus] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const v = await OnboardingService.hasEverOnboarded();
      if (!cancelled) setStatus(v);
    }

    check();

    // Also re-check when completion is broadcast, so that the very first
    // user to complete on a fresh install flips this to true reactively.
    const listener = () => { check(); };
    statusListeners.add(listener);

    return () => {
      cancelled = true;
      statusListeners.delete(listener);
    };
  }, []);

  return status;
}

/**
 * Hook that returns onboarding completion status for a specific user.
 * Returns null while loading, true if complete, false if not.
 *
 * @param uid Firebase uid of the signed-in user, or null if not yet
 *   authenticated. When uid is null the hook resolves to `false`, which is
 *   the correct answer for launch-time routing (no user → cannot have
 *   completed onboarding). The hook re-evaluates when uid changes so a
 *   sign-out → different-sign-in sequence picks up the new user's state.
 */
export function useOnboardingStatus(uid: string | null | undefined): boolean | null {
  const [status, setStatus] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Reset to "loading" on every uid change. Without this, the status
    // keeps its previous value (e.g. false for a pre-auth render) while
    // the async AsyncStorage read for the NEW uid is in flight. That
    // stale false causes the root router to route a just-signed-in user
    // into the onboarding stack before isComplete(uid) resolves — you
    // see the completion screen for a blink, then get bounced to tabs.
    // Setting status to null makes the router show <LoadingScreen />
    // during the transition instead of acting on stale data.
    setStatus(null);

    async function checkStatus() {
      const isComplete = await OnboardingService.isComplete(uid ?? null);
      if (!cancelled) {
        setStatus(isComplete);
      }
    }

    checkStatus();

    // Listen for status changes
    const listener = () => {
      checkStatus();
    };
    statusListeners.add(listener);

    return () => {
      cancelled = true;
      statusListeners.delete(listener);
    };
  }, [uid]);

  return status;
}

/**
 * Hook that returns the current onboarding step
 */
export function useOnboardingStep(): OnboardingStep | null {
  const [step, setStep] = useState<OnboardingStep | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function getStep() {
      const currentStep = await OnboardingService.getCurrentStep();
      if (!cancelled) {
        setStep(currentStep);
      }
    }

    getStep();

    return () => {
      cancelled = true;
    };
  }, []);

  return step;
}

/**
 * Hook that provides onboarding navigation controls.
 *
 * @param uid Firebase uid of the signed-in user — required when calling
 *   the returned `complete` function so the finished flag is written under
 *   the correct per-uid key.
 */
export function useOnboardingNavigation(uid: string | null | undefined) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const step = await OnboardingService.getCurrentStep();
      if (!cancelled) {
        setCurrentStep(step);
        setIsLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  const nextStep = useCallback(async () => {
    setIsLoading(true);
    const next = await OnboardingService.nextStep();
    setCurrentStep(next);
    setIsLoading(false);
    return next;
  }, []);

  const goToStep = useCallback(async (step: OnboardingStep) => {
    setIsLoading(true);
    await OnboardingService.goToStep(step);
    setCurrentStep(step);
    setIsLoading(false);
  }, []);

  const complete = useCallback(async () => {
    if (!uid) {
      throw new Error('Cannot complete onboarding without an authenticated uid.');
    }
    setIsLoading(true);
    await OnboardingService.complete(uid);
    setCurrentStep(OnboardingStep.COMPLETE);
    setIsLoading(false);
  }, [uid]);

  const getProgress = useCallback(() => {
    return OnboardingService.getProgress();
  }, []);

  return {
    currentStep,
    isLoading,
    nextStep,
    goToStep,
    complete,
    getProgress,
  };
}

/**
 * Mark onboarding as completed for a specific user.
 */
export async function markOnboardingCompleted(uid: string): Promise<void> {
  await OnboardingService.complete(uid);
}

/**
 * Reset onboarding status (for testing or re-enrollment).
 *
 * @param uid Pass the current user's uid to also clear their per-uid
 *   finished flag. Omit (or pass null) to only clear shared pre-auth
 *   onboarding state — appropriate before any user has signed in.
 */
export async function resetOnboardingStatus(uid?: string | null): Promise<void> {
  await OnboardingService.reset(uid ?? null);
}
