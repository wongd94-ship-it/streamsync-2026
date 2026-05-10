/**
 * Onboarding Service
 *
 * State machine for managing onboarding flow progress.
 * Persists state to AsyncStorage so users can resume from any step.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS, OnboardingStep, ONBOARDING_FLOW, userOnboardingFinishedKey } from '../constants';

/**
 * Data collected during onboarding
 */
export interface OnboardingData {
  // Eligibility responses (from chatbot)
  eligibility?: {
    hasIPhone: boolean;
    hasBPHDiagnosis: boolean;
    consideringSurgery: boolean;
    hasPlannedUrodynamicStudy?: boolean;
    isEligible: boolean;
    studyPathway?: 'surgery' | 'uds';
    /** Whether the anchor date came from surgery or a planned UDS */
    anchorDateType?: 'surgery' | 'uds';
    /** YYYY-MM-DD string of the scheduled surgery date, if provided */
    surgeryDate?: string;
    /** YYYY-MM-DD string of the scheduled urodynamics date, if provided */
    urodynamicsDate?: string;
  };

  // Medical history (from chatbot)
  medicalHistory?: {
    medications: string[];
    conditions: string[];
    allergies: string[];
    surgicalHistory: string[];
    bphTreatmentHistory: string[];
    rawTranscript?: string; // Full chat transcript for reference
  };

  // Account info
  account?: {
    firstName: string;
    lastName: string;
    email: string;
    dateOfBirth?: string;
  };

  // Permissions status
  permissions?: {
    healthKit: 'granted' | 'denied' | 'not_determined';
    clinicalRecords: 'granted' | 'denied' | 'not_determined' | 'skipped';
    throne: 'granted' | 'denied' | 'not_determined' | 'skipped';
    smartProvider: 'granted' | 'denied' | 'not_determined' | 'skipped';
    notifications?: 'granted' | 'denied' | 'not_determined';
  };

  providerConnection?: {
    providerId: string;
    providerName: string;
    issuer: string;
    fhirBaseUrl: string;
    connectedAt?: string | null;
  };

  // Consent PDF — stored pre-auth, uploaded to Firebase Storage after sign-in
  pendingConsentPdf?: {
    signatureType: 'typed' | 'drawn';
    participantName: string;
    signatureValue: string;
    consentDate: string; // ISO string
    drawnSignatureSvg?: string | null;
  };

  // IPSS baseline score
  ipssBaseline?: {
    score: number;
    qolScore: number;
    completedAt: string;
    responseId: string;
  };
}

/**
 * Onboarding state stored in AsyncStorage
 */
interface OnboardingState {
  currentStep: OnboardingStep;
  data: OnboardingData;
  startedAt: string;
  lastUpdatedAt: string;
}

class OnboardingServiceImpl {
  private state: OnboardingState | null = null;
  private initialized = false;
  // Per-uid in-memory cache. Written synchronously by complete(uid) and
  // read by isComplete(uid) to avoid the async AsyncStorage round-trip
  // between "user tapped Continue" and "router evaluates redirect guards".
  // Without this, React state updates from notifyOnboardingComplete() race
  // with router.replace() and the user can get stuck on the completion
  // screen (redirect guards see stale onboardingComplete=false).
  private finishedByUid: Map<string, boolean> = new Map();

  /**
   * Initialize the service by loading pre-auth state from AsyncStorage.
   *
   * Note: the "onboarding finished" flag is NOT loaded here — it lives under
   * a per-uid key (see userOnboardingFinishedKey in constants.ts) and is
   * read on demand by isComplete(uid). This avoids the cross-account
   * contamination bug where user A's completion state bled into user B.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const stepData = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_STEP);
      const savedData = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_DATA);

      if (stepData) {
        this.state = {
          currentStep: stepData as OnboardingStep,
          data: savedData ? JSON.parse(savedData) : {},
          startedAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
        };
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize onboarding service:', error);
      this.initialized = true;
    }
  }

  /**
   * One-time migration for existing installs: if a legacy global
   * @homeflow_onboarding_finished flag is set to 'true' and we now know
   * which uid it belongs to, promote it to the per-uid key and delete the
   * global. Safe to call repeatedly; no-op once the legacy key is gone.
   */
  async migrateLegacyFinishedFlag(uid: string): Promise<void> {
    if (!uid) return;
    try {
      const legacy = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_FINISHED);
      if (legacy === 'true') {
        this.finishedByUid.set(uid, true);
        await AsyncStorage.setItem(userOnboardingFinishedKey(uid), 'true');
        await AsyncStorage.removeItem(STORAGE_KEYS.ONBOARDING_FINISHED);
      }
    } catch (error) {
      console.warn('Failed to migrate legacy onboarding-finished flag:', error);
    }
  }

  /**
   * Get the current onboarding step
   */
  async getCurrentStep(): Promise<OnboardingStep | null> {
    await this.initialize();
    return this.state?.currentStep ?? null;
  }

  /**
   * Check if onboarding is complete for a specific user.
   *
   * @param uid Firebase uid of the signed-in user. Pass null/undefined for
   *   pre-auth routing decisions — returns false in that case, since a
   *   not-yet-authenticated user has no completion state.
   */
  async isComplete(uid?: string | null): Promise<boolean> {
    await this.initialize();
    if (!uid) return false;
    // In-memory cache: complete(uid) writes this synchronously so a
    // follow-up isComplete(uid) returns immediately without waiting on
    // AsyncStorage. Critical for the "tap Continue → route to tabs" flow
    // where router.replace races with React's setState propagation.
    if (this.finishedByUid.has(uid)) {
      return this.finishedByUid.get(uid) === true;
    }
    await this.migrateLegacyFinishedFlag(uid);
    try {
      const value = await AsyncStorage.getItem(userOnboardingFinishedKey(uid));
      const finished = value === 'true';
      this.finishedByUid.set(uid, finished);
      return finished;
    } catch (error) {
      console.warn('Failed to read onboarding finished flag:', error);
      return false;
    }
  }

  /**
   * Check if onboarding has been started
   */
  async hasStarted(): Promise<boolean> {
    await this.initialize();
    return this.state !== null;
  }

  /**
   * Start onboarding from the beginning
   */
  async start(): Promise<void> {
    const now = new Date().toISOString();
    this.state = {
      currentStep: OnboardingStep.WELCOME,
      data: {},
      startedAt: now,
      lastUpdatedAt: now,
    };
    await this.persistState();
  }

  /**
   * Move to the next step in the flow
   */
  async nextStep(): Promise<OnboardingStep> {
    await this.initialize();

    if (!this.state) {
      await this.start();
      return OnboardingStep.WELCOME;
    }

    const currentIndex = ONBOARDING_FLOW.indexOf(this.state.currentStep);
    const nextIndex = Math.min(currentIndex + 1, ONBOARDING_FLOW.length - 1);
    const nextStep = ONBOARDING_FLOW[nextIndex];

    this.state.currentStep = nextStep;
    this.state.lastUpdatedAt = new Date().toISOString();
    await this.persistState();

    return nextStep;
  }

  /**
   * Go to a specific step (for navigation)
   */
  async goToStep(step: OnboardingStep): Promise<void> {
    await this.initialize();

    if (!this.state) {
      await this.start();
    }

    this.state!.currentStep = step;
    this.state!.lastUpdatedAt = new Date().toISOString();
    await this.persistState();
  }

  /**
   * Update onboarding data
   */
  async updateData(data: Partial<OnboardingData>): Promise<void> {
    await this.initialize();

    if (!this.state) {
      await this.start();
    }

    this.state!.data = { ...this.state!.data, ...data };
    this.state!.lastUpdatedAt = new Date().toISOString();
    await this.persistState();
  }

  /**
   * Get all collected onboarding data
   */
  async getData(): Promise<OnboardingData> {
    await this.initialize();
    return this.state?.data ?? {};
  }

  /**
   * Mark user as ineligible and stop onboarding
   */
  async markIneligible(): Promise<void> {
    await this.initialize();

    if (this.state) {
      this.state.data.eligibility = {
        ...this.state.data.eligibility,
        isEligible: false,
      } as OnboardingData['eligibility'];
      await this.persistState();
    }
  }

  /**
   * Complete onboarding (called when user clicks "Get Started") for a
   * specific user. Writes the per-uid finished flag so only that uid lands
   * on the dashboard on next launch; other accounts on the same device
   * still see a fresh onboarding flow.
   *
   * @param uid Firebase uid of the user who just finished onboarding.
   */
  async complete(uid: string): Promise<void> {
    if (!uid) {
      throw new Error('OnboardingService.complete() requires a Firebase uid.');
    }
    await this.initialize();

    if (this.state) {
      this.state.currentStep = OnboardingStep.COMPLETE;
      this.state.lastUpdatedAt = new Date().toISOString();
      await this.persistState();
    }

    // Update the in-memory cache SYNCHRONOUSLY before awaiting the
    // AsyncStorage write. This makes isComplete(uid) return true
    // immediately for anyone reading through the cache path.
    this.finishedByUid.set(uid, true);
    await AsyncStorage.setItem(userOnboardingFinishedKey(uid), 'true');
    // Set the global "has anyone ever onboarded on this device" flag.
    // The router uses this to distinguish fresh installs (send unauth
    // users to welcome/onboarding) from returning devices (send unauth
    // users to login). Never cleared automatically.
    await AsyncStorage.setItem(STORAGE_KEYS.ONBOARDING_HAS_EVER_COMPLETED, 'true');
    // Clear the legacy global finished flag if it happens to still be
    // around.
    await AsyncStorage.removeItem(STORAGE_KEYS.ONBOARDING_FINISHED).catch(() => {});

    // Cross-device signal: write the explicit flag to Firestore so a
    // fresh install / new device can detect that this user already
    // completed onboarding without forcing them to redo it. Best-
    // effort — non-fatal if the network call fails.
    try {
      const { markOnboardingCompleteInFirestore } = await import('@/src/services/throneFirestore');
      await markOnboardingCompleteInFirestore(uid);
    } catch (err) {
      console.warn('Failed to write cross-device onboarding-complete flag:', err);
    }
  }

  /**
   * Clears the pre-auth scratchpad (step, data, consent scratch, IPSS
   * baseline, etc.) without touching any per-uid finished flag or the
   * global has-ever-onboarded flag. Call this when a user on the login
   * screen taps "Sign Up" so the new account starts its onboarding flow
   * fresh instead of inheriting leftover state from a previous session.
   */
  async resetPreAuthScratchpad(): Promise<void> {
    this.state = null;
    this.initialized = false;
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.ONBOARDING_STEP,
      STORAGE_KEYS.ONBOARDING_DATA,
      STORAGE_KEYS.CONSENT_GIVEN,
      STORAGE_KEYS.CONSENT_DATE,
      STORAGE_KEYS.CONSENT_VERSION,
      STORAGE_KEYS.CONSENT_SIGNATURE,
      STORAGE_KEYS.MEDICAL_HISTORY,
      STORAGE_KEYS.ELIGIBILITY_RESPONSES,
      STORAGE_KEYS.IPSS_BASELINE,
      STORAGE_KEYS.PERMISSIONS_STATUS,
      STORAGE_KEYS.SMART_PROVIDER_CONNECTION,
    ]);
  }

  /**
   * Has ANY user ever completed onboarding on this device? Used by the
   * root router to distinguish fresh install (show onboarding) from
   * returning device (show login when not signed in).
   *
   * Includes a one-time backfill: devices that completed onboarding
   * before this flag was introduced still have either (a) a per-uid
   * `@homeflow_onboarding_finished:<uid>` key, or (b) the pre-T5 legacy
   * global `@homeflow_onboarding_finished` key. If either is present we
   * set the canonical flag so future reads are fast.
   */
  async hasEverOnboarded(): Promise<boolean> {
    try {
      const v = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_HAS_EVER_COMPLETED);
      if (v === 'true') return true;

      // Backfill — scan for any existing per-uid finished flag.
      const allKeys = await AsyncStorage.getAllKeys();
      const perUidKeys = allKeys.filter((k) =>
        k.startsWith('@homeflow_onboarding_finished:'),
      );
      for (const key of perUidKeys) {
        const perUidValue = await AsyncStorage.getItem(key);
        if (perUidValue === 'true') {
          await AsyncStorage.setItem(
            STORAGE_KEYS.ONBOARDING_HAS_EVER_COMPLETED,
            'true',
          );
          return true;
        }
      }

      // Backfill — pre-T5 legacy global flag.
      const legacy = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_FINISHED);
      if (legacy === 'true') {
        await AsyncStorage.setItem(
          STORAGE_KEYS.ONBOARDING_HAS_EVER_COMPLETED,
          'true',
        );
        return true;
      }

      return false;
    } catch (error) {
      console.warn('Failed to read has-ever-onboarded flag:', error);
      return false;
    }
  }

  /**
   * Reset onboarding (for testing or re-enrollment).
   *
   * Clears the shared pre-auth onboarding data (step, collected data,
   * consent scratch, permissions cache, IPSS baseline, etc.) and, if a uid
   * is provided, the per-uid finished flag. Always also clears the legacy
   * global flag.
   *
   * @param uid Firebase uid of the user whose onboarding should be reset.
   *   Pass null to only clear shared pre-auth data (e.g. before sign-in).
   */
  async reset(uid?: string | null): Promise<void> {
    this.state = null;
    this.initialized = false;
    if (uid) {
      this.finishedByUid.delete(uid);
    } else {
      this.finishedByUid.clear();
    }

    const keysToRemove: string[] = [
      STORAGE_KEYS.ONBOARDING_STEP,
      STORAGE_KEYS.ONBOARDING_DATA,
      STORAGE_KEYS.ONBOARDING_FINISHED,
      STORAGE_KEYS.CONSENT_GIVEN,
      STORAGE_KEYS.CONSENT_DATE,
      STORAGE_KEYS.CONSENT_VERSION,
      STORAGE_KEYS.CONSENT_SIGNATURE,
      STORAGE_KEYS.MEDICAL_HISTORY,
      STORAGE_KEYS.ELIGIBILITY_RESPONSES,
      STORAGE_KEYS.IPSS_BASELINE,
      STORAGE_KEYS.PERMISSIONS_STATUS,
      STORAGE_KEYS.SMART_PROVIDER_CONNECTION,
    ];
    if (uid) {
      keysToRemove.push(userOnboardingFinishedKey(uid));
    }
    await AsyncStorage.multiRemove(keysToRemove);
  }

  /**
   * Get the step after the current one (for preview)
   */
  getNextStepName(): OnboardingStep | null {
    if (!this.state) return OnboardingStep.WELCOME;

    const currentIndex = ONBOARDING_FLOW.indexOf(this.state.currentStep);
    if (currentIndex >= ONBOARDING_FLOW.length - 1) return null;

    return ONBOARDING_FLOW[currentIndex + 1];
  }

  /**
   * Get progress as a percentage
   */
  getProgress(): number {
    if (!this.state) return 0;

    const currentIndex = ONBOARDING_FLOW.indexOf(this.state.currentStep);
    return Math.round((currentIndex / (ONBOARDING_FLOW.length - 1)) * 100);
  }

  /**
   * Persist state to AsyncStorage
   */
  private async persistState(): Promise<void> {
    if (!this.state) return;

    try {
      await AsyncStorage.setItem(STORAGE_KEYS.ONBOARDING_STEP, this.state.currentStep);
      await AsyncStorage.setItem(STORAGE_KEYS.ONBOARDING_DATA, JSON.stringify(this.state.data));
    } catch (error) {
      console.error('Failed to persist onboarding state:', error);
    }
  }
}

/**
 * Singleton instance of the onboarding service
 */
export const OnboardingService = new OnboardingServiceImpl();
