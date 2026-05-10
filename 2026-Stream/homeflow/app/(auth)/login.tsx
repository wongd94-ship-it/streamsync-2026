/**
 * Login Screen
 *
 * Email/password login with Apple and Google social sign-in.
 */

import React, { useState } from 'react';
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
  Modal,
  Pressable,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { devSkipAuth } from '@/lib/dev-flags';
import { notifyOnboardingComplete } from '@/hooks/use-onboarding-status';
import { OnboardingService } from '@/lib/services/onboarding-service';

const LANGUAGES = [
  { code: 'en', name: 'English',    flag: '🇺🇸' },
  { code: 'es', name: 'Español',    flag: '🇪🇸' },
  { code: 'zh', name: '中文',        flag: '🇨🇳' },
  { code: 'fr', name: 'Français',   flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch',    flag: '🇩🇪' },
  { code: 'pt', name: 'Português',  flag: '🇧🇷' },
  { code: 'ar', name: 'العربية',    flag: '🇸🇦' },
  { code: 'hi', name: 'हिन्दी',      flag: '🇮🇳' },
  { code: 'ko', name: '한국어',      flag: '🇰🇷' },
  { code: 'ja', name: '日本語',      flag: '🇯🇵' },
] as const;

type LanguageCode = typeof LANGUAGES[number]['code'];

export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { signInWithEmail, signInWithGoogle, sendPasswordResetEmail } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [langPickerVisible, setLangPickerVisible] = useState(false);
  const insets = useSafeAreaInsets();

  const selectedLang = LANGUAGES.find(l => l.code === language)!;

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
    notifyOnboardingComplete(); // Ensure onboarding status is fresh
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Welcome Back</Text>
            <Text style={[styles.subtitle, { color: colors.icon }]}>
              Sign in to continue to StreamSync
            </Text>
          </View>

          <View style={styles.form}>
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
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Password"
              placeholderTextColor={colors.icon}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              editable={!loading}
            />

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleEmailLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={handleForgotPassword} disabled={loading}>
              <Text style={[styles.forgotText, { color: StanfordColors.cardinal }]}>
                Forgot Password?
              </Text>
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
                Sign in with Google
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.icon }]}>
              Don&apos;t have an account?{' '}
            </Text>
            <TouchableOpacity
              onPress={async () => {
                // Clear the pre-auth onboarding scratchpad (step, collected
                // eligibility/consent/medical data, permissions cache) so a
                // new account starts onboarding from step 1 rather than
                // resuming wherever the previous user left off on this
                // device. Per-uid completion flags (and the global
                // "has-ever-onboarded" flag) are preserved.
                await OnboardingService.resetPreAuthScratchpad().catch(() => {});
                // Navigate to the welcome leaf screen directly (not the
                // (onboarding)/index router). The index has a guard that
                // bounces unauth-returning-users to /(auth)/login — which
                // is the right default behavior on app launch but wrong
                // here because the user explicitly asked to sign up.
                router.replace('/(onboarding)/welcome' as Href);
              }}
            >
              <Text style={[styles.linkText, { color: StanfordColors.cardinal }]}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          {__DEV__ && (
            <TouchableOpacity style={styles.devSkipButton} onPress={handleDevSkip}>
              <Text style={styles.devSkipText}>Dev — Skip Sign In</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Language selector — rendered after KeyboardAvoidingView so it sits on top */}
      <TouchableOpacity
        style={[styles.langButton, { top: insets.top + 8 }]}
        onPress={() => setLangPickerVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.langFlag}>{selectedLang.flag}</Text>
      </TouchableOpacity>

      {/* Language picker bottom sheet */}
      <Modal
        visible={langPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLangPickerVisible(false)}
      >
        <Pressable
          style={langStyles.backdrop}
          onPress={() => setLangPickerVisible(false)}
        >
          <Pressable style={[langStyles.sheet, { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }]}>
            <View style={[langStyles.handle, { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' }]} />
            <Text style={[langStyles.title, { color: colors.icon }]}>LANGUAGE</Text>
            {LANGUAGES.map(lang => (
              <TouchableOpacity
                key={lang.code}
                style={[langStyles.option, { borderBottomColor: colors.border }]}
                onPress={() => {
                  setLanguage(lang.code);
                  setLangPickerVisible(false);
                }}
                activeOpacity={0.7}
              >
                <Text style={langStyles.optionFlag}>{lang.flag}</Text>
                <Text style={[langStyles.optionName, { color: colors.text }]}>{lang.name}</Text>
                {language === lang.code && (
                  <Text style={[langStyles.checkmark, { color: StanfordColors.cardinal }]}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
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
  },
  form: {
    gap: Spacing.md,
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
  forgotText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 4,
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
    fontWeight: '600',
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
  langButton: {
    position: 'absolute',
    right: 28,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  langFlag: {
    fontSize: 26,
  },
});

const langStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 14,
  },
  optionFlag: {
    fontSize: 24,
  },
  optionName: {
    fontSize: 17,
    flex: 1,
  },
  checkmark: {
    fontSize: 17,
    fontWeight: '700',
  },
});
