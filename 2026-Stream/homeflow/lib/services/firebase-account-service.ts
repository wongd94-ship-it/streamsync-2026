/**
 * Firebase Account Service
 *
 * Implements IAccountService using Firebase Auth.
 * Supports email/password and Google Sign-In.
 */

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  signInWithCredential,
  GoogleAuthProvider,
  type User as FirebaseUser,
} from 'firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { doc, getDoc } from 'firebase/firestore';
import { auth } from '../firebase';
import { db } from '@/src/services/firebase';
import type { IAccountService, UserProfile } from './account-service';
import { saveUserProfile, isOnboardingCompleteInFirestore } from '@/src/services/throneFirestore';
import { claimParticipantRecord } from './participant-claim';
import { OnboardingService } from './onboarding-service';
import { notifyOnboardingComplete } from '@/hooks/use-onboarding-status';

const DEFAULT_GOOGLE_IOS_CLIENT_ID =
  '295202330543-6rlqahqi4ncgb5i0tksk3b46omhfin9e.apps.googleusercontent.com';

function mapFirebaseUser(user: FirebaseUser): UserProfile {
  const nameParts = (user.displayName || '').split(' ');
  return {
    id: user.uid,
    email: user.email || '',
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' ') || '',
    createdAt: user.metadata.creationTime || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function syncRootUserProfile(user: FirebaseUser): Promise<void> {
  const displayName = user.displayName || '';
  const nameParts = displayName.trim().split(/\s+/).filter(Boolean);
  const normalizedEmail = user.email?.trim().toLowerCase();

  // throneAccountEmail defaults to the auth email, but only when it is
  // not already set on the user doc. A researcher-set correction (e.g.
  // via setParticipantThroneEmail when the participant used Apple
  // Hide-My-Email at Throne signup) must survive subsequent sign-ins —
  // otherwise the next auth sync would silently revert it and the
  // Throne ingestion router would stop matching the participant's
  // sessions.
  let throneAccountEmailToWrite: string | undefined = normalizedEmail || undefined;
  try {
    const snap = await getDoc(doc(db, `users/${user.uid}`));
    const existing = snap.exists() ? (snap.data().throneAccountEmail as unknown) : undefined;
    if (typeof existing === 'string' && existing.trim()) {
      throneAccountEmailToWrite = undefined;
    }
  } catch (error) {
    // Best-effort read — if it fails (offline, rules change, etc.) fall
    // back to the auth-email default. The dashboard correction tool can
    // re-apply if needed.
    console.warn('[Auth] could not read existing throneAccountEmail; defaulting to auth email', error);
  }

  await saveUserProfile(user.uid, {
    name: displayName || undefined,
    displayName: displayName || undefined,
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' ') || undefined,
    email: user.email || undefined,
    throneAccountEmail: throneAccountEmailToWrite,
    createdAt: user.metadata.creationTime || undefined,
  });
}

async function syncRootUserProfileSafely(user: FirebaseUser): Promise<void> {
  try {
    await syncRootUserProfile(user);
  } catch (error) {
    console.warn('Non-fatal root profile sync failure after auth:', error);
  }

  // Cross-device onboarding backfill. If this user has completed
  // onboarding on another device/build, Firestore has the record of it
  // (either an explicit onboardingComplete flag OR the full set of
  // onboarding artifacts: consent + baseline IPSS + medical history).
  // The local per-uid AsyncStorage flag is device-scoped and won't be
  // set on this install yet. Backfill it so the router routes this
  // sign-in straight to the dashboard instead of replaying onboarding.
  // Best-effort — failures fall back to the existing onboarding flow.
  try {
    const alreadyLocal = await OnboardingService.isComplete(user.uid);
    if (!alreadyLocal) {
      const completeInFirestore = await isOnboardingCompleteInFirestore(user.uid);
      if (completeInFirestore) {
        await OnboardingService.complete(user.uid);
        // Force any mounted useOnboardingStatus hooks to re-read so the
        // router re-evaluates and navigates straight to tabs.
        notifyOnboardingComplete();
        console.info('[Auth] backfilled onboarding-complete flag from Firestore for uid:', user.uid);
      }
    }
  } catch (err) {
    console.warn('[Auth] onboarding-complete backfill failed:', err);
  }

  // After every successful auth, ask the backend whether there's a
  // researcher-created patients/{id} record pending for this email. If so,
  // the callable links it to the signed-in uid and writes the non-PHI
  // mirror under users/{uid}. No-op when no pending record exists.
  // Best-effort: errors are swallowed inside claimParticipantRecord().
  const claimResult = await claimParticipantRecord();
  if (claimResult.claimed) {
    console.info('[Auth] claimed pending participant record:', claimResult.participantId);
  }
}

export class FirebaseAccountService implements IAccountService {
  constructor() {
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
    const iosClientId =
      process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || DEFAULT_GOOGLE_IOS_CLIENT_ID;

    GoogleSignin.configure({
      iosClientId,
      ...(webClientId ? { webClientId } : {}),
    });
  }

  async isAuthenticated(): Promise<boolean> {
    return auth.currentUser !== null;
  }

  async getCurrentUser(): Promise<UserProfile | null> {
    const user = auth.currentUser;
    return user ? mapFirebaseUser(user) : null;
  }

  async createAccount(
    profile: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<UserProfile> {
    // In Firebase mode, accounts are created via signUpWithEmail or social sign-in
    const user = auth.currentUser;
    if (!user) {
      throw new Error('No authenticated user. Sign in first.');
    }
    await updateProfile(user, {
      displayName: `${profile.firstName} ${profile.lastName}`,
    });
    await syncRootUserProfileSafely(user);
    return mapFirebaseUser(user);
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('No authenticated user.');
    }

    const displayName = updates.firstName || updates.lastName
      ? `${updates.firstName ?? ''} ${updates.lastName ?? ''}`.trim()
      : undefined;

    if (displayName) {
      await updateProfile(user, { displayName });
    }

    await syncRootUserProfileSafely(user);
    return mapFirebaseUser(user);
  }

  async deleteAccount(): Promise<void> {
    const user = auth.currentUser;
    if (user) {
      await user.delete();
    }
  }

  async signInWithEmail(email: string, password: string): Promise<UserProfile> {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await syncRootUserProfileSafely(result.user);
      return mapFirebaseUser(result.user);
    } catch (error) {
      console.error('Firebase email sign-in failed:', error);
      throw error;
    }
  }

  async signUpWithEmail(
    email: string,
    password: string,
    profile: { firstName: string; lastName: string }
  ): Promise<UserProfile> {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(result.user, {
        displayName: `${profile.firstName} ${profile.lastName}`,
      });
      await syncRootUserProfileSafely(result.user);
      return mapFirebaseUser(result.user);
    } catch (error) {
      console.error('Firebase email sign-up failed:', error);
      throw error;
    }
  }

  async signInWithApple(): Promise<UserProfile> {
    throw new Error('Apple Sign-In is currently disabled for this build.');
  }

  async signInWithGoogle(): Promise<UserProfile> {
    await GoogleSignin.hasPlayServices();
    const signInResult = await GoogleSignin.signIn();

    if (signInResult.type === 'cancelled') {
      const cancelError = new Error('Google Sign-In was cancelled.');
      (cancelError as Error & { code?: string }).code = 'SIGN_IN_CANCELLED';
      throw cancelError;
    }

    let idToken = signInResult.data.idToken;
    if (!idToken) {
      const tokenResult = await GoogleSignin.getTokens();
      idToken = tokenResult.idToken;
    }

    if (!idToken) {
      throw new Error(
        'Google Sign-In did not return an ID token. Check the iOS client ID and Firebase Google provider configuration.'
      );
    }

    const googleCredential = GoogleAuthProvider.credential(idToken);
    const result = await signInWithCredential(auth, googleCredential);
    await syncRootUserProfileSafely(result.user);
    return mapFirebaseUser(result.user);
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(auth);
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    await firebaseSendPasswordResetEmail(auth, email);
  }

  onAuthStateChanged(callback: (user: UserProfile | null) => void): () => void {
    return firebaseOnAuthStateChanged(auth, (user) => {
      callback(user ? mapFirebaseUser(user) : null);
    });
  }
}
