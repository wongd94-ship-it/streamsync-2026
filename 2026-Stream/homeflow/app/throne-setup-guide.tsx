/**
 * Throne Setup Guide Screen
 *
 * Post-onboarding screen that guides patients through setting up their
 * Throne One smart toilet device after it arrives (~4 business days).
 * Emphasizes using the same email as their Streamsync account.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/hooks/use-auth';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { Spacing } from '@/constants/theme';
import { STUDY_INFO } from '@/lib/constants';

const SETUP_STEPS = [
  {
    number: '1',
    title: 'Unbox your Throne One',
    description: 'Remove the device from its packaging. You should have the sensor unit and a USB charging cable.',
  },
  {
    number: '2',
    title: 'Charge the device',
    description: 'Connect the USB cable and charge for at least 2 hours before first use.',
  },
  {
    number: '3',
    title: 'Download the Throne app',
    description: 'Search for "Throne" in the App Store and install the Throne Science app.',
  },
  {
    number: '4',
    title: 'Create your Throne account',
    description: 'Sign up using the same email you used for StreamSync (shown below). This is how we link your voiding data.',
  },
  {
    number: '5',
    title: 'Pair the device',
    description: 'Follow the in-app instructions to pair your Throne One via Bluetooth.',
  },
  {
    number: '6',
    title: 'Install on your toilet',
    description: 'Place the sensor on the toilet bowl rim following the Throne app diagram. Ensure it sits flush and level.',
  },
];

export default function ThroneSetupGuideScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { theme } = useAppTheme();
  const { isDark, colors } = theme;

  const cardBg = isDark ? '#1C1C1E' : '#F2F2F7';
  const emailHighlightBg = isDark ? '#2C2C2E' : 'rgba(140, 21, 21, 0.08)';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <IconSymbol name="chevron.left" size={24} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Throne Setup</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro */}
        <View style={styles.introSection}>
          <View style={[styles.iconCircle, { backgroundColor: emailHighlightBg }]}>
            <IconSymbol name="shippingbox.fill" size={40} color={colors.accent} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>
            Set Up Your Throne One
          </Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
            Follow these steps to get your smart toilet sensor ready for the study.
          </Text>
        </View>

        {/* Email callout */}
        <View style={[styles.emailCallout, { backgroundColor: emailHighlightBg, borderColor: colors.accent }]}>
          <IconSymbol name="exclamationmark.triangle.fill" size={20} color={colors.accent} />
          <View style={styles.emailCalloutContent}>
            <Text style={[styles.emailCalloutTitle, { color: colors.text }]}>
              Use the same email for your Throne account
            </Text>
            <Text style={[styles.emailCalloutEmail, { color: colors.accent }]}>
              {user?.email ?? 'your StreamSync email'}
            </Text>
            <Text style={[styles.emailCalloutNote, { color: colors.secondaryText }]}>
              This allows us to automatically link your voiding data to the study.
            </Text>
          </View>
        </View>

        {/* Setup steps */}
        <View style={styles.stepsSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Setup Steps</Text>
          {SETUP_STEPS.map((step, index) => (
            <View key={step.number} style={[styles.stepCard, { backgroundColor: cardBg }]}>
              <View style={[styles.stepNumber, { backgroundColor: colors.accent }]}>
                <Text style={styles.stepNumberText}>{step.number}</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>{step.title}</Text>
                <Text style={[styles.stepDescription, { color: colors.secondaryText }]}>
                  {step.description}
                </Text>
                {/* Highlight email on step 4 */}
                {index === 3 && user?.email && (
                  <View style={[styles.inlineEmail, { backgroundColor: isDark ? '#3A3A3C' : '#fff' }]}>
                    <IconSymbol name="envelope.fill" size={16} color={colors.accent} />
                    <Text style={[styles.inlineEmailText, { color: colors.text }]} selectable>
                      {user.email}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Troubleshooting */}
        <View style={[styles.helpCard, { backgroundColor: cardBg }]}>
          <IconSymbol name="questionmark.circle.fill" size={24} color={colors.accent} />
          <View style={styles.helpContent}>
            <Text style={[styles.helpTitle, { color: colors.text }]}>
              Need help?
            </Text>
            <Text style={[styles.helpDescription, { color: colors.secondaryText }]}>
              If you're having trouble setting up your Throne One, contact the research team for assistance.
            </Text>
            <TouchableOpacity
              style={[styles.helpButton, { borderColor: colors.accent }]}
              onPress={() => Linking.openURL(`mailto:${STUDY_INFO.contactEmail}?subject=Throne%20Setup%20Help`)}
            >
              <IconSymbol name="envelope.fill" size={16} color={colors.accent} />
              <Text style={[styles.helpButtonText, { color: colors.accent }]}>
                Contact Support
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Bottom spacer */}
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.screenHorizontal,
  },
  introSection: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  emailCallout: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderLeftWidth: 4,
    gap: 12,
  },
  emailCalloutContent: {
    flex: 1,
  },
  emailCalloutTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  emailCalloutEmail: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  emailCalloutNote: {
    fontSize: 13,
    lineHeight: 18,
  },
  stepsSection: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  stepCard: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  stepNumberText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  stepDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  inlineEmail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    gap: 8,
  },
  inlineEmailText: {
    fontSize: 15,
    fontWeight: '600',
  },
  helpCard: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: Spacing.md,
    gap: 12,
  },
  helpContent: {
    flex: 1,
  },
  helpTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  helpDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  helpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  helpButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
