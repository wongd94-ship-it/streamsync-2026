/**
 * Ineligible Screen
 *
 * Shown when a user doesn't meet the eligibility criteria.
 * Provides a kind explanation and contact information.
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing } from '@/constants/theme';
import { STUDY_INFO } from '@/lib/constants';
import { ContinueButton } from '@/components/onboarding';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function IneligibleScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleReturn = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(onboarding)/chat');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <View style={styles.iconContainer}>
          <View
            style={[
              styles.iconBackground,
              { backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7' },
            ]}
          >
            <IconSymbol name={'person.2.fill' as any} size={64} color={colors.icon} />
          </View>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>
          We&apos;re Sorry
        </Text>

        <Text style={[styles.description, { color: colors.icon }]}>
          Based on your responses, you don&apos;t currently meet the eligibility criteria for the {STUDY_INFO.name}.
        </Text>

        <Text style={[styles.contactPrompt, { color: colors.text }]}>
          If you have questions, please contact the research team at info@streamsyncresearch.com.
        </Text>
      </Animated.View>

      <View style={styles.footer}>
        <ContinueButton
          title="Return"
          onPress={handleReturn}
          variant="text"
        />
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.screenHorizontal,
    paddingTop: Spacing.xl * 2,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  iconBackground: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  description: {
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  contactPrompt: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: Spacing.screenHorizontal,
    paddingBottom: Spacing.lg,
    gap: Spacing.sm,
  },
});
