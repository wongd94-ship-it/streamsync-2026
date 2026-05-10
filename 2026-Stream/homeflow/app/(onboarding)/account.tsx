/**
 * Account Screen (Onboarding)
 *
 * Account-creation step, positioned after consent and before permissions.
 * Returning users sign in from the Welcome screen; this screen is signup-only.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { OnboardingStep } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { useAuth } from '@/hooks/use-auth';
import { saveSurgeryDate, saveStudyTimeline, saveUrodynamicsDate, registerThroneResearchParticipant } from '@/src/services/throneFirestore';
import { getAuth } from '@/src/services/firestore';
import { uploadConsentPdf } from '@/src/services/consentPdfSync';
import {
  OnboardingProgressBar,
} from '@/components/onboarding';

export default function AccountScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { signUpWithEmail, signInWithGoogle, isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const advancingRef = useRef(false);

  const handleAdvance = useCallback(async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;

    const uid = getAuth().currentUser?.uid;
    try {
      if (uid) {
        const data = await OnboardingService.getData();
        const persistenceJobs: Promise<unknown>[] = [];

        // Flush surgery date collected pre-login
        const surgeryDate = data.eligibility?.surgeryDate;
        if (surgeryDate) {
          persistenceJobs.push(saveSurgeryDate(uid, surgeryDate).catch((err) => {
            console.warn('[Account] Failed to flush surgery date to Firestore:', err);
          }));
        }

        // Flush urodynamics date collected pre-login
        const udsDate = data.eligibility?.urodynamicsDate;
        if (udsDate) {
          persistenceJobs.push(saveUrodynamicsDate(uid, udsDate).catch((err) => {
            console.warn('[Account] Failed to flush urodynamics date to Firestore:', err);
          }));
        }

        const studyPathway = data.eligibility?.studyPathway;
        const anchorDateType = data.eligibility?.anchorDateType;
        if (studyPathway || anchorDateType || surgeryDate || udsDate) {
          persistenceJobs.push(saveStudyTimeline(uid, {
            studyPathway: studyPathway ?? null,
            anchorDateType: anchorDateType ?? null,
            surgeryDate: surgeryDate ?? null,
            urodynamicsDate: udsDate ?? null,
          }).catch((err) => {
            console.warn('[Account] Failed to flush study timeline to Firestore:', err);
          }));
        }

        // Register in the Throne research participant registry (email-keyed)
        const email = getAuth().currentUser?.email;
        if (email) {
          persistenceJobs.push(registerThroneResearchParticipant(email, uid).catch((err) => {
            console.warn('[Account] Failed to register Throne research participant:', err);
          }));
        }

        // Upload consent PDF now that we have a UID
        const pending = data.pendingConsentPdf;
        if (pending) {
          uploadConsentPdf({
            signatureType: pending.signatureType,
            participantName: pending.participantName,
            signatureValue: pending.signatureValue,
            consentDate: pending.consentDate,
            drawnSignatureSvg: pending.drawnSignatureSvg,
          }).then((result) => {
            if (!result.ok) {
              console.warn('[Account] Consent PDF upload failed (non-fatal):', result.error);
              return;
            }
            OnboardingService.updateData({ pendingConsentPdf: undefined }).catch((err) => {
              console.warn('[Account] Failed to clear pending consent PDF state:', err);
            });
          });
        }

        if (persistenceJobs.length) {
          await Promise.allSettled(persistenceJobs);
        }
      }

      await OnboardingService.goToStep(OnboardingStep.PERMISSIONS);
      router.push('/(onboarding)/permissions' as Href);
    } catch (error) {
      advancingRef.current = false;
      throw error;
    }
  }, [router]);

  useEffect(() => {
    if (isAuthenticated) {
      void handleAdvance();
    }
  }, [handleAdvance, isAuthenticated]);

  const handleEmailAuth = async () => {
    const trimmedEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Missing Fields', 'Please enter your first and last name.');
      return;
    }
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 8) {
      Alert.alert('Weak Password', 'Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      await signUpWithEmail(trimmedEmail, password, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      await handleAdvance();
    } catch (error: any) {
      const code = error?.code ?? '';
      const rawMessage = error?.message ?? '';
      console.error('[Account] Sign-up failed:', { code, rawMessage });
      const message =
        code === 'auth/email-already-in-use'
          ? 'An account with this email already exists. Return to the welcome screen and tap Sign In.'
          : code === 'auth/operation-not-allowed'
          ? 'Email/password authentication is not enabled for this Firebase project.'
          : code === 'auth/too-many-requests'
          ? 'Too many attempts. Please try again later.'
          : code === 'auth/weak-password'
          ? 'Password must be at least 8 characters.'
          : code === 'auth/invalid-email'
          ? 'Please enter a valid email address.'
          : code === 'auth/network-request-failed'
          ? 'Network error. Check your connection and try again.'
          : rawMessage || 'Account creation failed. Please try again.';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
      await handleAdvance();
    } catch (error: any) {
      if (error?.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign In Failed', error?.message || 'Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <OnboardingProgressBar currentStep={OnboardingStep.ACCOUNT} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>
              Create an account to securely store your study data.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.nameRow}>
              <TextInput
                style={[styles.input, styles.nameInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                placeholder="First Name"
                placeholderTextColor={colors.icon}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                textContentType="givenName"
                editable={!loading}
              />
              <TextInput
                style={[styles.input, styles.nameInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                placeholder="Last Name"
                placeholderTextColor={colors.icon}
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                textContentType="familyName"
                editable={!loading}
              />
            </View>

            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Email"
              placeholderTextColor={colors.icon}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!loading}
            />
            <View style={styles.emailCallout}>
              <Text style={styles.emailCalloutText}>
                <Text style={styles.emailCalloutBold}>Important: </Text>
                Use this same email when you set up your Throne device. We store it as your Throne account email, but your actual Throne user ID must still come from Throne itself to link voiding data correctly.
              </Text>
            </View>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Password"
              placeholderTextColor={colors.icon}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
              editable={!loading}
            />

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleEmailAuth}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.icon }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.socialButtons}>
            <TouchableOpacity
              style={[styles.socialButton, { borderColor: colors.border }]}
              onPress={handleGoogleLogin}
              disabled={loading}
            >
              <Image
                source={require('@/assets/images/google-logo.png')}
                style={styles.googleLogo}
              />
              <Text style={[styles.socialButtonText, { color: colors.text }]}>
                Continue with Google
              </Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.screenHorizontal,
    justifyContent: 'center',
  },
  header: {
    marginBottom: Spacing.xl,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  form: {
    gap: Spacing.md,
  },
  nameRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  nameInput: {
    flex: 1,
  },
  emailCallout: {
    backgroundColor: '#FFF4CC',
    borderLeftWidth: 4,
    borderLeftColor: '#B8860B',
    borderRadius: 8,
    padding: Spacing.sm,
    marginTop: -Spacing.sm,
  },
  emailCalloutText: {
    color: '#5C4400',
    fontSize: 13,
    lineHeight: 18,
  },
  emailCalloutBold: {
    fontWeight: '700',
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  primaryButton: {
    height: 52,
    backgroundColor: StanfordColors.cardinal,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 14,
    textTransform: 'uppercase',
  },
  socialButtons: {
    gap: Spacing.md,
  },
  appleButton: {
    width: '100%',
    height: 52,
  },
  socialButton: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  googleLogo: {
    width: 18,
    height: 18,
    resizeMode: 'contain',
  },
  socialButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  alreadySignedIn: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  alreadySignedInText: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  alreadySignedInButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  continueAsButton: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueAsButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  switchButton: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  switchButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
