/**
 * Login Screen — Liquid Glass
 *
 * Email/password login with Google social sign-in and a language picker.
 * This is the first screen unauthenticated users see when launching the app.
 */

import React, { useState } from 'react';
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
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { devSkipAuth } from '@/lib/dev-flags';
import { notifyOnboardingComplete } from '@/hooks/use-onboarding-status';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { LiquidGlassBackdrop } from '@/components/ui/LiquidGlassBackdrop';
import { LiquidGlassCard } from '@/components/ui/LiquidGlassCard';
import { LGColors, LGShadowStrong } from '@/lib/theme/liquidGlass';
import { useAppTheme } from '@/lib/theme/ThemeContext';

export default function LoginScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { isDark } = theme;
  const ink = isDark ? LGColors.darkInk : LGColors.ink;
  const ink2 = isDark ? LGColors.darkInk2 : LGColors.ink2;
  const ink3 = isDark ? LGColors.darkInk3 : LGColors.ink3;
  const hair = isDark ? LGColors.darkHair : LGColors.hair;
  const { signInWithEmail, signInWithGoogle, sendPasswordResetEmail } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async () => {
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
    } catch (error: any) {
      const code = error?.code ?? '';
      const rawMessage = error?.message ?? '';
      console.error('[Login] Email sign-in failed:', { code, rawMessage });
      const message =
        code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'
          ? 'Invalid email or password.'
          : code === 'auth/operation-not-allowed'
          ? 'Email/password authentication is not enabled for this Firebase project.'
          : code === 'auth/too-many-requests'
          ? 'Too many attempts. Please try again later.'
          : code === 'auth/user-disabled'
          ? 'This account has been disabled. Contact support.'
          : code === 'auth/invalid-email'
          ? 'Please enter a valid email address.'
          : code === 'auth/network-request-failed'
          ? 'Network error. Check your connection and try again.'
          : rawMessage || 'Sign in failed. Please try again.';
      Alert.alert('Sign In Failed', message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      Alert.alert('Enter Email', 'Please enter a valid email address first, then tap Forgot Password.');
      return;
    }

    try {
      await sendPasswordResetEmail(trimmedEmail);
      Alert.alert('Reset Email Sent', 'Check your inbox for a password reset link.');
    } catch (error: any) {
      const code = error?.code ?? '';
      const message =
        code === 'auth/user-not-found'
          ? 'No account found with that email.'
          : code === 'auth/too-many-requests'
          ? 'Too many attempts. Please try again later.'
          : code === 'auth/network-request-failed'
          ? 'Network error. Check your connection and try again.'
          : 'Failed to send reset email. Please try again.';
      Alert.alert('Error', message);
    }
  };

  const handleDevSkip = () => {
    devSkipAuth();
    notifyOnboardingComplete();
    router.replace('/(tabs)');
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (error?.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign In Failed', error?.message || 'Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LiquidGlassBackdrop variant="welcome" />
      <SafeAreaView style={styles.flex}>
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
                Sign in to continue to StreamSync
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
                  onPress={handleEmailLogin}
                  disabled={loading}
                  activeOpacity={0.86}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Sign In</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity onPress={handleForgotPassword} disabled={loading}>
                  <Text style={[styles.forgotText, { color: LGColors.sea }]}>
                    Forgot password?
                  </Text>
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
              onPress={handleGoogleLogin}
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

            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: ink2 }]}>
                Don&apos;t have an account?{' '}
              </Text>
              <TouchableOpacity
                onPress={async () => {
                  await OnboardingService.resetPreAuthScratchpad().catch(() => {});
                  router.replace('/(onboarding)/welcome' as Href);
                }}
              >
                <Text style={[styles.linkText, { color: LGColors.sea }]}>Sign Up</Text>
              </TouchableOpacity>
            </View>

            {__DEV__ && (
              <TouchableOpacity style={styles.devSkipButton} onPress={handleDevSkip}>
                <Text style={styles.devSkipText}>Dev — Skip Sign In</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
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
    width: 96,
    height: 96,
    borderRadius: 22,
    marginBottom: Spacing.md,
    shadowColor: LGColors.sea,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 23,
    letterSpacing: -0.2,
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
  forgotText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: Spacing.xl,
  },
  footerText: {
    fontSize: 15,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '700',
  },
  devSkipButton: {
    marginTop: Spacing.lg,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  devSkipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF9500',
  },
});
