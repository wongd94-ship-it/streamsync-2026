/**
 * Onboarding Eligibility Check Screen
 *
 * Structured eligibility questionnaire replacing the AI chat-based screening.
 * Medical history collection happens later (after consent & permissions)
 * in the medical-history screen.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { OnboardingStep } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { OnboardingProgressBar, ContinueButton } from '@/components/onboarding';
import { IconSymbol } from '@/components/ui/icon-symbol';

// Lazy-load so the screen still renders even if the package isn't available
let DateTimePicker: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DateTimePicker = require('react-native-ui-datepicker').default;
} catch {
  // noop – graceful degradation below
}

type YesNo = 'yes' | 'no' | null;
type StudyPathwayChoice = 'surgery' | 'uds' | null;

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function OnboardingChatScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const [bphDiagnosis, setBphDiagnosis] = useState<YesNo>(null);
  const [studyPathway, setStudyPathway] = useState<StudyPathwayChoice>(null);
  const [surgeryDate, setSurgeryDate] = useState<Date>(new Date());
  const [udsDate, setUdsDate] = useState<Date>(new Date());
  const [showSurgeryPicker, setShowSurgeryPicker] = useState(false);
  const [showUdsPicker, setShowUdsPicker] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const canContinue = bphDiagnosis === 'yes' && studyPathway !== null;

  // When the pathway's calendar opens, scroll the full calendar into view.
  useEffect(() => {
    if (!showSurgeryPicker && !showUdsPicker) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 250);
    return () => clearTimeout(t);
  }, [showSurgeryPicker, showUdsPicker]);

  const cardBg = isDark ? '#1C1C1E' : '#F2F2F7';
  const noButtonBg = isDark ? '#2C2C2E' : '#E5E5EA';
  const noButtonText = isDark ? '#EBEBF5' : '#3A3A3C';
  const dateInputBg = isDark ? '#2C2C2E' : '#E5E5EA';

  const handleBphSelect = (value: YesNo) => {
    setBphDiagnosis(value);
    if (value === 'no') {
      setTimeout(() => {
        router.replace('/(onboarding)/ineligible' as Href);
      }, 400);
    }
  };

  const handlePathwaySelect = (value: StudyPathwayChoice) => {
    setStudyPathway(value);
    setShowSurgeryPicker(value === 'surgery');
    setShowUdsPicker(value === 'uds');
  };

  const handleContinue = async () => {
    const surgeryDateStr = studyPathway === 'surgery'
      ? surgeryDate.toISOString().split('T')[0]
      : undefined;
    const udsDateStr = studyPathway === 'uds'
      ? udsDate.toISOString().split('T')[0]
      : undefined;
    const anchorDateType: 'surgery' | 'uds' = studyPathway === 'surgery' ? 'surgery' : 'uds';

    await OnboardingService.updateData({
      eligibility: {
        hasIPhone: true,
        hasBPHDiagnosis: bphDiagnosis === 'yes',
        consideringSurgery: studyPathway === 'surgery',
        hasPlannedUrodynamicStudy: studyPathway === 'uds',
        isEligible: canContinue,
        studyPathway: studyPathway ?? undefined,
        anchorDateType,
        surgeryDate: surgeryDateStr,
        urodynamicsDate: udsDateStr,
      },
    });

    // Surgery date is persisted locally in OnboardingService (AsyncStorage).
    // It will be flushed to Firestore after the user logs in (account.tsx).

    await OnboardingService.goToStep(OnboardingStep.CONSENT);
    router.push('/(onboarding)/consent' as Href);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.progressHeader}>
        <OnboardingProgressBar currentStep={OnboardingStep.CHAT} />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={styles.titleRow}>
          <View style={styles.iconCircle}>
            <IconSymbol name={'checkmark' as any} size={22} color="#FFFFFF" />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Eligibility Check</Text>
        </View>
        <Text style={[styles.subtitle, { color: colors.icon }]}>
          Let&apos;s make sure this study is right for you
        </Text>

        {/* ── Q1: BPH Diagnosis ── */}
        <View style={[styles.card, { backgroundColor: cardBg }]}>
          <Text style={[styles.questionText, { color: colors.text }]}>
            Have you been diagnosed with BPH (Benign Prostatic Hyperplasia)?
          </Text>
          <View style={styles.yesNoRow}>
            <YesNoButton
              label="Yes"
              selected={bphDiagnosis === 'yes'}
              onPress={() => handleBphSelect('yes')}
              selectedBg={StanfordColors.cardinal}
              unselectedBg={noButtonBg}
              unselectedText={noButtonText}
            />
            <YesNoButton
              label="No"
              selected={bphDiagnosis === 'no'}
              onPress={() => handleBphSelect('no')}
              selectedBg={StanfordColors.cardinal}
              unselectedBg={noButtonBg}
              unselectedText={noButtonText}
            />
          </View>
        </View>

        {/* ── Q2: Study Pathway ── */}
        <View style={[styles.card, { backgroundColor: cardBg }]}>
          <Text style={[styles.questionText, { color: colors.text }]}>
            Which study pathway are you entering?
          </Text>
          <Text style={[styles.questionSubtext, { color: colors.icon }]}>
            Please select only one. Participants begin with either scheduled urodynamics or scheduled BPH surgery.
          </Text>
          <View style={styles.pathwayColumn}>
            <PathwayOption
              title="Scheduled BPH Surgery"
              description="Choose this if you already have BPH surgery scheduled."
              selected={studyPathway === 'surgery'}
              onPress={() => handlePathwaySelect('surgery')}
              colors={colors}
              cardBg={noButtonBg}
            />
            <PathwayOption
              title="Scheduled Urodynamic Testing"
              description="Choose this if you are entering the study for urodynamics and do not yet have surgery scheduled."
              selected={studyPathway === 'uds'}
              onPress={() => handlePathwaySelect('uds')}
              colors={colors}
              cardBg={noButtonBg}
            />
          </View>
        </View>

        {/* ── Q3a: Surgery Date ── */}
        {studyPathway === 'surgery' && (
          <AnchorDateCard
            label="When is your surgery scheduled?"
            date={surgeryDate}
            onChange={setSurgeryDate}
            expanded={showSurgeryPicker}
            onToggle={() => setShowSurgeryPicker((prev) => !prev)}
            cardBg={cardBg}
            dateInputBg={dateInputBg}
            colors={colors}
          />
        )}

        {/* ── Q3b: UDS Date ── */}
        {studyPathway === 'uds' && (
          <AnchorDateCard
            label="When is your urodynamic study scheduled?"
            date={udsDate}
            onChange={setUdsDate}
            expanded={showUdsPicker}
            onToggle={() => setShowUdsPicker((prev) => !prev)}
            cardBg={cardBg}
            dateInputBg={dateInputBg}
            colors={colors}
          />
        )}
      </ScrollView>

      {/* ── Footer CTA ── */}
      <View style={[styles.footer, { borderTopColor: isDark ? '#2C2C2E' : 'rgba(0,0,0,0.1)' }]}>
        <ContinueButton
          title="Continue to Consent"
          onPress={handleContinue}
          disabled={!canContinue}
        />
      </View>

    </SafeAreaView>
  );
}

// ─── Sub-component ───────────────────────────────────────────────────────────

interface YesNoButtonProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  selectedBg: string;
  unselectedBg: string;
  unselectedText: string;
}

function YesNoButton({ label, selected, onPress, selectedBg, unselectedBg, unselectedText }: YesNoButtonProps) {
  return (
    <TouchableOpacity
      style={[
        styles.yesNoBtn,
        { backgroundColor: selected ? selectedBg : unselectedBg },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Text style={[styles.yesNoBtnText, { color: selected ? '#FFFFFF' : unselectedText }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function PathwayOption({
  title,
  description,
  selected,
  onPress,
  colors,
  cardBg,
}: {
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
  colors: typeof Colors.light;
  cardBg: string;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.pathwayOption,
        {
          backgroundColor: selected ? 'rgba(140, 21, 21, 0.10)' : cardBg,
          borderColor: selected ? StanfordColors.cardinal : 'transparent',
        },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.pathwayOptionTop}>
        <Text style={[styles.pathwayTitle, { color: colors.text }]}>{title}</Text>
        <View
          style={[
            styles.pathwayCheck,
            {
              borderColor: selected ? StanfordColors.cardinal : colors.icon,
              backgroundColor: selected ? StanfordColors.cardinal : 'transparent',
            },
          ]}
        >
          {selected ? <IconSymbol name={'checkmark' as any} size={12} color="#FFFFFF" /> : null}
        </View>
      </View>
      <Text style={[styles.pathwayDescription, { color: colors.icon }]}>{description}</Text>
    </TouchableOpacity>
  );
}

interface AnchorDateCardProps {
  label: string;
  date: Date;
  onChange: (date: Date) => void;
  expanded: boolean;
  onToggle: () => void;
  cardBg: string;
  dateInputBg: string;
  colors: { text: string; icon: string };
}

function AnchorDateCard({
  label,
  date,
  onChange,
  expanded,
  onToggle,
  cardBg,
  dateInputBg,
  colors,
}: AnchorDateCardProps) {
  return (
    <View style={[styles.card, { backgroundColor: cardBg }]}>
      <Text style={[styles.questionText, { color: colors.text }]}>{label}</Text>

      <TouchableOpacity
        style={[styles.dateInput, { backgroundColor: dateInputBg }]}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <IconSymbol name={'calendar' as any} size={20} color={colors.icon} />
        <Text style={[styles.dateText, { color: colors.text }]}>{formatDate(date)}</Text>
        <IconSymbol
          name={(expanded ? 'chevron.up' : 'chevron.down') as any}
          size={14}
          color={colors.icon}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.calendarWrap}>
          {DateTimePicker ? (
            <DateTimePicker
              mode="single"
              date={date}
              onChange={({ date: newDate }: { date: any }) => {
                if (newDate) {
                  const nativeDate =
                    newDate instanceof Date
                      ? newDate
                      : new Date(
                          typeof newDate.valueOf === 'function' ? newDate.valueOf() : newDate,
                        );
                  onChange(nativeDate);
                  onToggle();
                }
              }}
              styles={{
                day_label:            { color: colors.text },
                outside_label:        { color: colors.icon },
                disabled_label:       { color: colors.icon, opacity: 0.35 },
                weekday_label:        { color: colors.icon },
                month_selector_label: { color: colors.text, fontWeight: '600' },
                year_selector_label:  { color: colors.text, fontWeight: '600' },
                today:                { borderWidth: 1, borderColor: StanfordColors.cardinal, borderRadius: 999 },
                today_label:          { color: StanfordColors.cardinal },
                selected:             { backgroundColor: StanfordColors.cardinal, borderRadius: 999 },
                selected_label:       { color: '#FFFFFF', fontWeight: '600' },
              }}
            />
          ) : (
            <Text style={[styles.pickerFallback, { color: colors.icon }]}>
              Date picker not available. Install react-native-ui-datepicker.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  progressHeader: {
    paddingTop: Spacing.sm,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.screenHorizontal,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },

  // Header
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: Spacing.xs,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: StanfordColors.cardinal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },

  // Question cards
  card: {
    borderRadius: 16,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  questionText: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  questionSubtext: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: -Spacing.sm,
  },

  // Yes/No buttons
  yesNoRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pathwayColumn: {
    gap: 10,
  },
  pathwayOption: {
    borderWidth: 1.5,
    borderRadius: 16,
    padding: Spacing.md,
  },
  pathwayOptionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: 6,
  },
  pathwayTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  pathwayDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  pathwayCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesNoBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesNoBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Date input
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 10,
  },
  dateText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  calendarWrap: {
    marginTop: -Spacing.sm,
  },
  pickerFallback: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },

  // Footer
  footer: {
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
