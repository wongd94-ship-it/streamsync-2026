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
  Animated,
  Image,
  TouchableOpacity,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StanfordColors, Spacing } from '@/constants/theme';
import { STUDY_INFO } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { ContinueButton } from '@/components/onboarding';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FontSize, FontWeight } from '@/lib/theme/typography';
import { LiquidGlassBackdrop } from '@/components/ui/LiquidGlassBackdrop';
import { LiquidGlassCard } from '@/components/ui/LiquidGlassCard';
import { LGColors } from '@/lib/theme/liquidGlass';
import { useAppTheme } from '@/lib/theme/ThemeContext';

export default function WelcomeScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { isDark } = theme;
  const ink = isDark ? LGColors.darkInk : LGColors.ink;
  const ink2 = isDark ? LGColors.darkInk2 : LGColors.ink2;
  const ink3 = isDark ? LGColors.darkInk3 : LGColors.ink3;

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
    <View style={styles.container}>
      <LiquidGlassBackdrop variant="welcome" />
      <SafeAreaView style={styles.safeArea}>
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
            <Image
              source={require('@/assets/images/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </Animated.View>

          <Animated.View
            style={{
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
              alignItems: 'center',
            }}
          >
            <Text style={[styles.title, { color: ink }]}>StreamSync</Text>
            <Text style={[styles.tagline, { color: ink2 }]}>
              A research study to determine how home uroflow and daily activity are related to voiding dysfunction.
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
            <LiquidGlassCard borderRadius={22} style={styles.callout}>
              <View style={styles.calloutRow}>
                <View style={styles.calloutIconBox}>
                  <View style={styles.calloutIconCorner} />
                  <IconSymbol name="sparkles" size={22} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.calloutTitle, { color: ink }]}>
                    Most of this is automatic
                  </Text>
                  <Text style={[styles.calloutBody, { color: ink2 }]}>
                    You{"'"}ll only need a few minutes a week.
                  </Text>
                </View>
              </View>
            </LiquidGlassCard>

            <View style={styles.features}>
              <FeatureItem
                icon="waveform.path.ecg"
                title="Passive Monitoring"
                description="Track activity and sleep with your Apple Watch"
                ink={ink}
                ink2={ink2}
              />
              <FeatureItem
                icon="lock.shield"
                title="Privacy First"
                description="Your data is encrypted and protected"
                ink={ink}
                ink2={ink2}
              />
            </View>
          </Animated.View>
        </View>

        <Animated.View style={[styles.footer, { opacity: fadeAnim }]}>
          <Text style={[styles.footerText, { color: ink3 }]}>
            The next few screens will check your eligibility and collect some basic information.
          </Text>
          <ContinueButton title="Get Started" onPress={handleContinue} />
          <TouchableOpacity
            onPress={() => router.push('/(onboarding)/sign-in' as Href)}
            style={styles.signInButton}
            accessibilityRole="button"
          >
            <Text style={[styles.signInText, { color: ink2 }]}>
              Already have an account? <Text style={styles.signInLink}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

function FeatureItem({
  icon,
  title,
  description,
  ink,
  ink2,
}: {
  icon: string;
  title: string;
  description: string;
  ink: string;
  ink2: string;
}) {
  return (
    <View style={styles.featureItem}>
      <View style={styles.featureIcon}>
        <IconSymbol name={icon as any} size={22} color={StanfordColors.cardinal} />
      </View>
      <View style={styles.featureText}>
        <Text style={[styles.featureTitle, { color: ink }]}>{title}</Text>
        <Text style={[styles.featureDescription, { color: ink2 }]}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.screenHorizontal,
    paddingTop: Spacing.xl,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  logo: {
    width: 132,
    height: 132,
    borderRadius: 30,
    shadowColor: LGColors.sea,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
  },
  title: {
    fontSize: 44,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -1.2,
    marginBottom: 12,
  },
  tagline: {
    fontSize: 18,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 25,
    letterSpacing: -0.2,
    paddingHorizontal: 8,
    marginBottom: Spacing.xl,
  },
  descriptionContainer: {
    flex: 1,
    gap: 18,
  },
  callout: {
    padding: 16,
  },
  calloutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  calloutIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: LGColors.peach,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  calloutIconCorner: {
    position: 'absolute',
    top: -10,
    right: -10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: LGColors.peachLight,
    opacity: 0.7,
  },
  calloutTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  calloutBody: {
    fontSize: 14,
    marginTop: 2,
  },
  features: {
    gap: Spacing.md,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: LGColors.seaTint,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  featureText: { flex: 1 },
  featureTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  featureDescription: {
    fontSize: 14,
    lineHeight: 19,
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
    fontSize: 15,
  },
  signInLink: {
    color: LGColors.sea,
    fontWeight: '700',
  },
});
