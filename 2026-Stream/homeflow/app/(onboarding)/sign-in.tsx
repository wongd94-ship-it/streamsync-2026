/**
 * Sign-In Screen (Onboarding) — Liquid Glass
 *
 * Shown when a user taps "Sign In" from the Welcome screen because they
 * already have a StreamSync account. On successful auth, we check the
 * user's Firestore profile — if onboarding was already completed elsewhere
 * we mark local onboarding finished and the router sends them to the tabs.
 * Otherwise the onboarding index resumes from the current step.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { notifyOnboardingComplete } from '@/hooks/use-onboarding-status';
import { db, getAuth } from '@/src/services/firestore';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { LiquidGlassBackdrop } from '@/components/ui/LiquidGlassBackdrop';
import { LiquidGlassCard } from '@/components/ui/LiquidGlassCard';
import { LGColors, LGShadowStrong } from '@/lib/theme/liquidGlass';
import { useAppTheme } from '@/lib/theme/ThemeContext';

export default function OnboardingSignInScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { isDark } = theme;
  const ink = isDark ? LGColors.darkInk : LGColors.ink;
  const ink2 = isDark ? LGColors.darkInk2 : LGColors.ink2;
  const ink3 = isDark ? LGColors.darkInk3 : LGColors.ink3;
  const hair = isDark ? LGColors.darkHair : LGColors.hair;
  const { signInWithEmail, signInWithGoogle, isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const advancingRef = useRef(false);

  const routeAfterSignIn = useCallback(async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;

    try {
      const uid = getAuth().currentUser?.uid;
      let profileOnboardingComplete = false;

      if (uid) {
        try {
          const snap = await getDoc(doc(db, `users/${uid}`));
          profileOnboardingComplete = !!snap.data()?.onboardingComplete;
        } catch (err) {
          console.warn('[SignIn] Failed to read profile:', err);
        }
      }

      if (profileOnboardingComplete) {
        if (uid) {
          await OnboardingService.complete(uid);
        } else {
          console.warn('[SignIn] Post-auth onboarding-complete write skipped: no uid available.');
        }
        notifyOnboardingComplete();
      } else {
        router.replace('/(onboarding)' as Href);
      }
    } finally {
      advancingRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (isAuthenticated) {
      void routeAfterSignIn();
    }
  }, [isAuthenticated, routeAfterSignIn]);

  const handleEmailSignIn = async () => {
    const trimmedEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 8) {
      Alert.alert('Invalid Password', 'Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      await signInWithEmail(trimmedEmail, password);
      await routeAfterSignIn();
    } catch (error: any) {
      const code = error?.code ?? '';
      const rawMessage = error?.message ?? '';
      console.error('[SignIn] Email sign-in failed:', { code, rawMessage });
      const message =
        code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'
          ? 'Invalid email or password.'
          : code === 'auth/too-many-requests'
          ? 'Too many attempts. Please try again later.'
          : code === 'auth/invalid-email'
          ? 'Please enter a valid email address.'
          : code === 'auth/network-request-failed'
          ? 'Network error. Check your connection and try again.'
          : rawMessage || 'Sign-in failed. Please try again.';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
      await routeAfterSignIn();
    } catch (error: any) {
      if (error?.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign In Failed', error?.message || 'Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(onboarding)/welcome' as Href);
    }
  };

  return (
    <View style={styles.container}>
      <LiquidGlassBackdrop variant="welcome" />
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconSymbol name={'chevron.left' as any} size={22} color={ink} />
            <Text style={[styles.backButtonText, { color: ink }]}>Back</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.header}>
              <Image
                source={require('@/assets/images/icon.png')}
                style={styles.logo}
                resizeMode="contain"
              />
              <Text style={[styles.title, { color: ink }]}>Welcome back</Text>
              <Text style={[styles.subtitle, { color: ink2 }]}>
                Sign in to skip onboarding and return to your study.
              </Text>
            </View>

            <LiquidGlassCard borderRadius={26} style={styles.formCard}>
              <View style={styles.form}>
                <View style={[styles.inputWrap, { borderColor: hair }]}>
                  <Text style={[styles.inputLabel, { color: ink3 }]}>Email</Text>
                  <TextInput
                    style={[styles.input, { color: ink }]}
                    placeholder="you@example.com"
                    placeholderTextColor={ink3}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    editable={!loading}
                  />
                </View>
                <View style={[styles.inputWrap, { borderColor: hair }]}>
                  <Text style={[styles.inputLabel, { color: ink3 }]}>Password</Text>
                  <TextInput
                    style={[styles.input, { color: ink }]}
                    placeholder="At least 8 characters"
                    placeholderTextColor={ink3}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    textContentType="password"
                    editable={!loading}
                  />
                </View>

                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    !loading && LGShadowStrong,
                    loading && styles.buttonDisabled,
                  ]}
                  onPress={handleEmailSignIn}
                  disabled={loading}
                  activeOpacity={0.86}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Sign In</Text>
                  )}
                </TouchableOpacity>
              </View>
            </LiquidGlassCard>

            <View style={styles.divider}>
              <View style={[styles.dividerLine, { backgroundColor: hair }]} />
              <Text style={[styles.dividerText, { color: ink3 }]}>or</Text>
              <View style={[styles.dividerLine, { backgroundColor: hair }]} />
            </View>

            <TouchableOpacity
              style={styles.socialButton}
              onPress={handleGoogleSignIn}
              disabled={loading}
              activeOpacity={0.86}
            >
              <View style={[styles.socialButtonInner, { borderColor: hair }]}>
                <Image
                  source={require('@/assets/images/google-logo.png')}
                  style={styles.googleLogo}
                />
                <Text style={[styles.socialButtonText, { color: ink }]}>
                  Sign in with Google
                </Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingRight: 12,
    gap: 2,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.screenHorizontal,
    paddingBottom: Spacing.xl,
    justifyContent: 'center',
  },
  header: {
    marginBottom: Spacing.xl,
    alignItems: 'center',
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 18,
    marginBottom: Spacing.md,
    shadowColor: LGColors.sea,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.7,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: -0.2,
    paddingHorizontal: 8,
  },
  formCard: {
    padding: 18,
  },
  form: {
    gap: 12,
  },
  inputWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  input: {
    height: 36,
    fontSize: 17,
    padding: 0,
    fontWeight: '500',
  },
  primaryButton: {
    height: 60,
    backgroundColor: LGColors.sea,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.lg,
    gap: Spacing.sm,
    paddingHorizontal: 8,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 1.0,
  },
  socialButton: {
    height: 60,
  },
  socialButtonInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.68)',
  },
  googleLogo: {
    width: 20,
    height: 20,
    resizeMode: 'contain',
  },
  socialButtonText: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
});
