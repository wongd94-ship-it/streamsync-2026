/**
 * Welcome Screen
 *
 * Brief introduction to the StreamSync study.
 * Sets the tone and explains what to expect.
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  Animated,
  TouchableOpacity,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { STUDY_INFO } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { ContinueButton } from '@/components/onboarding';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FontSize, FontWeight } from '@/lib/theme/typography';

export default function WelcomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const iconScale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.spring(iconScale, {
        toValue: 1,
        tension: 50,
        friction: 5,
        useNativeDriver: true,
        delay: 200,
      }),
    ]).start();
  }, [fadeAnim, slideAnim, iconScale]);

  const handleContinue = async () => {
    // Advance to the next step in the onboarding flow (chat/eligibility)
    await OnboardingService.nextStep();
    router.replace('/(onboarding)/chat');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Animated.View
          style={[
            styles.iconContainer,
            {
              opacity: fadeAnim,
              transform: [{ scale: iconScale }],
            },
          ]}
        >
          <View style={styles.iconBackground}>
            <IconSymbol name={'heart.fill' as any} size={64} color={StanfordColors.cardinal} />
          </View>
        </Animated.View>

        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }}
        >
          <Text style={[styles.title, { color: colors.text }]}>
            Welcome to StreamSync
          </Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.descriptionContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <Text style={[styles.description, { color: colors.text }]}>
            Thank you for your interest in the {STUDY_INFO.name}. This app will help us
            understand how voiding patterns and physical activity predict voiding
            etiology and procedural success in men with BPH.
          </Text>

          <View style={styles.features}>
            <FeatureItem
              icon="waveform.path.ecg"
              title="Passive Monitoring"
              description="Track activity and sleep with your Apple Watch"
              colors={colors}
            />
            <FeatureItem
              icon="chart.line.uptrend.xyaxis"
              title="Personalized Insights"
              description="Review your study data and progress in one place"
              colors={colors}
            />
            <FeatureItem
              icon="lock.shield"
              title="Privacy First"
              description="Your data is encrypted and protected"
              colors={colors}
            />
          </View>
        </Animated.View>
      </View>

      <Animated.View style={[styles.footer, { opacity: fadeAnim }]}>
        <Text style={[styles.footerText, { color: colors.icon }]}>
          The next few screens will check your eligibility and collect some basic information.
        </Text>
        <ContinueButton title="Get Started" onPress={handleContinue} />
        <TouchableOpacity
          onPress={() => router.push('/(onboarding)/sign-in' as Href)}
          style={styles.signInButton}
          accessibilityRole="button"
        >
          <Text style={[styles.signInText, { color: colors.text }]}>
            Already have an account? <Text style={styles.signInLink}>Sign In</Text>
          </Text>
        </TouchableOpacity>
      </Animated.View>

    </SafeAreaView>
  );
}

function FeatureItem({
  icon,
  title,
  description,
  colors,
}: {
  icon: string;
  title: string;
  description: string;
  colors: typeof Colors.light;
}) {
  const colorScheme = useColorScheme();

  return (
    <View style={styles.featureItem}>
      <View
        style={[
          styles.featureIcon,
          {
            backgroundColor:
              colorScheme === 'dark' ? 'rgba(140, 21, 21, 0.2)' : 'rgba(140, 21, 21, 0.1)',
          },
        ]}
      >
        <IconSymbol name={icon as any} size={24} color={StanfordColors.cardinal} />
      </View>
      <View style={styles.featureText}>
        <Text style={[styles.featureTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.featureDescription, { color: colors.icon }]}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.screenHorizontal,
    paddingTop: Spacing.xl,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  iconBackground: {
    width: 100,
    height: 100,
    borderRadius: 24,
    backgroundColor: 'rgba(140, 21, 21, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    marginBottom: 8,
  },
  descriptionContainer: {
    flex: 1,
  },
  description: {
    fontSize: FontSize.headline,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  features: {
    gap: Spacing.md,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: FontSize.subhead,
    fontWeight: FontWeight.semibold,
    marginBottom: 2,
  },
  featureDescription: {
    fontSize: FontSize.footnote,
  },
  footer: {
    paddingHorizontal: Spacing.screenHorizontal,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
  },
  footerText: {
    fontSize: FontSize.footnote,
    textAlign: 'center',
    lineHeight: 20,
  },
  signInButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  signInText: {
    fontSize: FontSize.subhead,
  },
  signInLink: {
    color: StanfordColors.cardinal,
    fontWeight: FontWeight.semibold,
  },
});
