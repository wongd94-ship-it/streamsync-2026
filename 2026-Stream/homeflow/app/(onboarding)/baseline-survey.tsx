/**
 * Baseline Survey Screen
 *
 * IPSS questionnaire for baseline symptom assessment.
 * Presented as a modal-like experience that feels integrated.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  Animated,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { QuestionnaireForm, QuestionnaireResult } from '@spezivibe/questionnaire';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { OnboardingStep } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import {
  IPSS_QUESTIONNAIRE,
  calculateIPSSScore,
  getIPSSSeverityDescription,
} from '@/lib/questionnaires/ipss-questionnaire';
import { OnboardingProgressBar, ContinueButton } from '@/components/onboarding';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/hooks/use-auth';
import { saveIpssScore } from '@/src/services/ipssScoreSync';

export default function BaselineSurveyScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();

  const [showResults, setShowResults] = useState(false);
  const [score, setScore] = useState<{ totalScore: number; qolScore: number; severity: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    if (showResults) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [showResults, fadeAnim, slideAnim]);

  const handleSubmit = async (result: QuestionnaireResult) => {
    if (result.status !== 'completed') return;

    const response = result.response;

    // Extract answers from response
    const answers: Record<string, number> = {};

    response.item?.forEach((item) => {
      if (item.answer?.[0]?.valueCoding?.code) {
        answers[item.linkId] = parseInt(item.answer[0].valueCoding.code, 10);
      }
    });

    // Calculate score
    const calculatedScore = calculateIPSSScore(answers);
    setScore(calculatedScore);

    const completedAt = new Date().toISOString();
    const responseId = response.id || `ipss-${Date.now()}`;

    // Save to onboarding data (local, source of truth for gate-keeping)
    await OnboardingService.updateData({
      ipssBaseline: {
        score: calculatedScore.totalScore,
        qolScore: calculatedScore.qolScore,
        completedAt,
        responseId,
      },
    });

    // Persist to Firestore under users/{uid}/ipss_scores/baseline
    const uid = user?.id;
    if (uid) {
      saveIpssScore(uid, 'baseline', {
        period: 'baseline',
        totalScore: calculatedScore.totalScore,
        qolScore: calculatedScore.qolScore,
        severity: calculatedScore.severity as 'mild' | 'moderate' | 'severe',
        completedAt,
        responseId,
      }).catch((err) => {
        console.warn('[BaselineSurvey] Firestore write failed (non-fatal):', err);
      });
    }

    setShowResults(true);
  };

  const handleContinue = async () => {
    setIsSubmitting(true);

    try {
      await OnboardingService.goToStep(OnboardingStep.COMPLETE);
      router.replace('/(onboarding)/complete' as Href);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Dev-only handler that bypasses the survey
  const handleDevContinue = async () => {
    await OnboardingService.goToStep(OnboardingStep.COMPLETE);
    router.replace('/(onboarding)/complete' as Href);
  };

  const getSeverityColor = () => {
    if (!score) return colors.icon;
    switch (score.severity) {
      case 'mild':
        return '#34C759';
      case 'moderate':
        return '#FF9500';
      case 'severe':
        return '#FF3B30';
      default:
        return colors.icon;
    }
  };

  if (showResults) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Animated.View
          style={[
            styles.resultsContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.resultsIcon}>
            <IconSymbol name="checkmark.circle.fill" size={64} color="#34C759" />
          </View>

          <Text style={[styles.resultsTitle, { color: colors.text }]}>
            Baseline Complete!
          </Text>

          <View
            style={[
              styles.scoreCard,
              { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' },
            ]}
          >
            <Text style={[styles.scoreLabel, { color: colors.icon }]}>Your IPSS Score</Text>
            <View style={styles.scoreRow}>
              <Text style={[styles.scoreValue, { color: getSeverityColor() }]}>
                {score?.totalScore}
              </Text>
              <Text style={[styles.scoreMax, { color: colors.icon }]}>/35</Text>
            </View>
            <View
              style={[
                styles.severityBadge,
                { backgroundColor: getSeverityColor() + '20' },
              ]}
            >
              <Text style={[styles.severityText, { color: getSeverityColor() }]}>
                {score?.severity?.toUpperCase()} SYMPTOMS
              </Text>
            </View>
          </View>

          <Text style={[styles.resultsDescription, { color: colors.icon }]}>
            {score && getIPSSSeverityDescription(score.severity as any)}
          </Text>

          <View
            style={[
              styles.qolCard,
              { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7' },
            ]}
          >
            <Text style={[styles.qolLabel, { color: colors.icon }]}>
              Quality of Life Score
            </Text>
            <Text style={[styles.qolValue, { color: colors.text }]}>
              {score?.qolScore}/6
            </Text>
          </View>

          <Text style={[styles.disclaimer, { color: colors.icon }]}>
            This score will be used as your baseline. We&apos;ll track how your symptoms
            change over the course of the study.
          </Text>
        </Animated.View>

        <View style={styles.footer}>
          <ContinueButton
            title="Complete Setup"
            onPress={handleContinue}
            loading={isSubmitting}
          />
        </View>

      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <OnboardingProgressBar currentStep={OnboardingStep.BASELINE_SURVEY} />
        <View style={styles.titleContainer}>
          <IconSymbol name={'doc.text.fill' as any} size={24} color={StanfordColors.cardinal} />
          <Text style={[styles.title, { color: colors.text }]}>Baseline Survey</Text>
        </View>
        <Text style={[styles.subtitle, { color: colors.icon }]}>
          Please answer these questions about your urinary symptoms over the past month.
        </Text>
      </View>

      <View style={styles.formContainer}>
        <QuestionnaireForm
          questionnaire={IPSS_QUESTIONNAIRE}
          onResult={handleSubmit}
          submitButtonText="Submit Survey"
          autoAdvanceOnChoice
          // Fix for scroll issue: Ensure keyboard doesn't cover input and content scrolls past footer
          keyboardVerticalOffset={100}
          scrollContentStyle={{ paddingBottom: 120 }}
        />
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.screenHorizontal,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.sm,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  formContainer: {
    flex: 1,
  },
  resultsContainer: {
    flex: 1,
    paddingHorizontal: Spacing.screenHorizontal,
    paddingTop: Spacing.xl * 2,
    alignItems: 'center',
  },
  resultsIcon: {
    marginBottom: Spacing.lg,
  },
  resultsTitle: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: Spacing.xl,
  },
  scoreCard: {
    width: '100%',
    borderRadius: 16,
    padding: Spacing.lg,
    alignItems: 'center',
    marginBottom: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  scoreLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  scoreValue: {
    fontSize: 64,
    fontWeight: '700',
  },
  scoreMax: {
    fontSize: 24,
    fontWeight: '500',
  },
  severityBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: Spacing.sm,
  },
  severityText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  resultsDescription: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  qolCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  qolLabel: {
    fontSize: 15,
  },
  qolValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  disclaimer: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: Spacing.md,
  },
  footer: {
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
  },
});
