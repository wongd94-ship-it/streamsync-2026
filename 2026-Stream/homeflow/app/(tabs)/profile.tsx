import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  Linking,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/hooks/use-auth';
import { STUDY_COORDINATOR } from '@/lib/consent/consent-document';
import { notifyStudyDatesChanged, useStudyDates } from '@/hooks/use-study-dates';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { saveSurgeryDate, saveStudyTimeline } from '@/src/services/throneFirestore';
import { useAppTheme, type AppearanceMode } from '@/lib/theme/ThemeContext';
import { FontSize, FontWeight } from '@/lib/theme/typography';
import { StanfordColors } from '@/constants/theme';
import { resyncHistoricalHealthKit, type BackfillProgress } from '@/src/services/healthkitSync';

// Same lazy-load pattern used by the eligibility screen so the calendar is
// optional at bundle time but renders when the package is present.
let DateTimePicker: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DateTimePicker = require('react-native-ui-datepicker').default;
} catch {
  // graceful degradation — the fallback copy is rendered if this is missing
}

function toIsoDay(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

const APPEARANCE_OPTIONS: { value: AppearanceMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const RESYNC_OPTIONS: { days: number; label: string }[] = [
  { days: 30, label: 'Last 30 days' },
  { days: 60, label: 'Last 60 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 120, label: 'Last 120 days' },
  { days: 365, label: 'Last 1 year' },
];

export default function ProfileScreen() {
  const { theme, appearance, setAppearance } = useAppTheme();
  const { colors: c } = theme;
  const router = useRouter();
  const { user, signOut } = useAuth();
  const study = useStudyDates();
  // Profile-tab load instrumentation — one-line log at mount + when study
  // data finishes loading so perf regressions are visible in device logs.
  // Uses Date.now() (not performance.now) for portability across web + RN.
  const mountedAtRef = React.useRef<number>(Date.now());
  useEffect(() => {
    console.info('[Profile]', JSON.stringify({
      event: 'mount',
      uid: user?.id ?? null,
      time: new Date(mountedAtRef.current).toISOString(),
    }));
  }, [user?.id]);
  useEffect(() => {
    if (!study.isLoading) {
      console.info('[Profile]', JSON.stringify({
        event: 'study-dates-ready',
        msSinceMount: Date.now() - mountedAtRef.current,
      }));
    }
  }, [study.isLoading]);
  const [showSurgeryDateModal, setShowSurgeryDateModal] = useState(false);
  const [surgeryDateValue, setSurgeryDateValue] = useState<Date>(new Date());
  const [savingSurgeryDate, setSavingSurgeryDate] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [resyncProgress, setResyncProgress] = useState<BackfillProgress | null>(null);
  const [showResyncModal, setShowResyncModal] = useState(false);

  // INVARIANT: this is the ONLY path that takes an authenticated user back
  // to the login screen. App-launch routing must not call signOut() — the
  // Firebase Auth session is persisted via getReactNativePersistence in
  // lib/firebase.ts, and the per-uid onboarding flag is written by
  // OnboardingService.complete(uid). Keep this confined here so that
  // reopening the app always lands the user on the dashboard.
  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
            router.replace('/(auth)/login' as Href);
          } catch (error: any) {
            Alert.alert('Error', error?.message || 'Failed to sign out.');
          }
        },
      },
    ]);
  };

  // The in-Profile "Re-request HealthKit Permissions" affordance moved to
  // the /permissions-status screen alongside the per-type status matrix
  // (see app/permissions-status.tsx). Kept here as a stub-free tree so the
  // Profile tab has one less Firestore/HealthKit reason to re-render.

  const handleOpenResyncModal = () => {
    if (resyncing) return;
    if (!user?.id) {
      Alert.alert('Sign in required', 'Sign in before re-syncing your HealthKit data.');
      return;
    }
    setShowResyncModal(true);
  };

  const runResync = async (lookbackDays: number) => {
    setShowResyncModal(false);
    setResyncing(true);
    setResyncProgress(null);
    try {
      const result = await resyncHistoricalHealthKit({
        lookbackDays,
        onProgress: (p) => setResyncProgress(p),
      });

      const windowLabel = lookbackDays === 365 ? '1 year' : `${lookbackDays} days`;
      if (result.ok) {
        Alert.alert(
          'Historical data synced',
          `Pulled ${windowLabel} of history. Uploaded ${result.totalWritten} new sample(s). ${result.totalSkipped} already existed and were left untouched.`,
        );
      } else {
        const failedMetrics = Object.entries(result.perMetric)
          .filter(([, r]) => r.error)
          .map(([m]) => m)
          .join(', ');
        Alert.alert(
          'Partial sync',
          `Pulled ${windowLabel} of history. Uploaded ${result.totalWritten} new sample(s). Some metrics failed: ${failedMetrics || 'unknown'}.`,
        );
      }
    } catch (error: any) {
      Alert.alert('Re-sync failed', error?.message || 'Please try again.');
    } finally {
      setResyncing(false);
      setResyncProgress(null);
    }
  };

  const handleSaveSurgeryDate = async () => {
    if (!user?.id) {
      Alert.alert('Unavailable', 'You need to be signed in to update your study timeline.');
      return;
    }
    const isoDay = toIsoDay(surgeryDateValue);

    setSavingSurgeryDate(true);
    try {
      await saveSurgeryDate(user.id, isoDay);
      const data = await OnboardingService.getData();
      await saveStudyTimeline(user.id, {
        studyPathway: 'surgery',
        anchorDateType: 'surgery',
        surgeryDate: isoDay,
        urodynamicsDate: data.eligibility?.urodynamicsDate ?? null,
      });
      await OnboardingService.updateData({
        eligibility: {
          ...data.eligibility,
          hasIPhone: data.eligibility?.hasIPhone ?? true,
          hasBPHDiagnosis: data.eligibility?.hasBPHDiagnosis ?? true,
          consideringSurgery: true,
          hasPlannedUrodynamicStudy: data.eligibility?.hasPlannedUrodynamicStudy ?? true,
          isEligible: data.eligibility?.isEligible ?? true,
          studyPathway: 'surgery',
          anchorDateType: 'surgery',
          surgeryDate: isoDay,
          urodynamicsDate: data.eligibility?.urodynamicsDate,
        },
      });
      notifyStudyDatesChanged();
      setShowSurgeryDateModal(false);
    } catch (error: any) {
      Alert.alert('Unable to Save', error?.message || 'Please try again.');
    } finally {
      setSavingSurgeryDate(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.screenTitle, { color: c.textPrimary }]}>
          Profile
        </Text>

        {/* 1. Account */}
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <View style={styles.cardHeader}>
            <IconSymbol name="person.circle.fill" size={17} color={c.textTertiary} />
            <Text style={[styles.cardLabel, { color: c.textTertiary }]}>Account</Text>
          </View>
          {user ? (
            <>
              <Text style={[styles.accountName, { color: c.textPrimary }]}>
                {user.firstName} {user.lastName}
              </Text>
              <Text style={[styles.accountEmail, { color: c.textSecondary }]}>
                {user.email}
              </Text>
            </>
          ) : (
            <Text style={[styles.placeholderText, { color: c.textTertiary }]}>
              Not signed in.
            </Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: c.card }]}>
          <View style={styles.cardHeader}>
            <IconSymbol name="calendar.badge.clock" size={17} color={c.accent} />
            <Text style={[styles.cardLabel, { color: c.textSecondary }]}>Study Timeline</Text>
          </View>
          <Text style={[styles.accountName, { color: c.textPrimary }]}>
            {study.pathwayLabel}
          </Text>
          <Text style={[styles.accountEmail, { color: c.textSecondary }]}>
            {study.phaseLabel}
          </Text>
          <Text style={[styles.placeholderText, { color: c.textTertiary, marginTop: 10 }]}>
            {study.timelineCaption}
          </Text>
          {study.canTransitionToSurgery && !study.surgery.date ? (
            <TouchableOpacity
              style={[styles.contactButton, { backgroundColor: c.background, marginTop: 14 }]}
              onPress={() => {
                setSurgeryDateValue(new Date());
                setShowSurgeryDateModal(true);
              }}
              activeOpacity={0.7}
            >
              <IconSymbol name="calendar.badge.plus" size={15} color={c.accent} />
              <Text style={[styles.contactButtonText, { color: c.textSecondary }]}>
                Add surgery date
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* 2. Appearance — iOS-style segmented control */}
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <View style={styles.cardHeader}>
            <IconSymbol name="circle.lefthalf.filled" size={17} color={c.textSecondary} />
            <Text style={[styles.cardLabel, { color: c.textSecondary }]}>Appearance</Text>
          </View>
          <View style={[styles.segmentedControl, { backgroundColor: c.secondaryFill }]}>
            {APPEARANCE_OPTIONS.map((opt) => {
              const isSelected = appearance === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.segment,
                    isSelected && [styles.segmentSelected, { backgroundColor: c.card }],
                  ]}
                  onPress={() => setAppearance(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      { color: c.textSecondary },
                      isSelected && { color: c.textPrimary, fontWeight: FontWeight.semibold },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 3. Study Consent & Data Permissions — iOS Settings-style rows */}
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <TouchableOpacity
            style={styles.rowButton}
            onPress={() => router.push('/consent-viewer' as Href)}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <IconSymbol name="doc.text.fill" size={18} color={c.accent} />
              <Text style={[styles.rowLabel, { color: c.textPrimary }]}>
                Study Consent
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={14} color={c.textTertiary} />
          </TouchableOpacity>

          <View style={[styles.rowDivider, { backgroundColor: c.separator }]} />

          <TouchableOpacity
            style={styles.rowButton}
            onPress={() => router.push('/permissions-status' as Href)}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <IconSymbol name="lock.shield" size={18} color={c.semanticSuccess} />
              <Text style={[styles.rowLabel, { color: c.textPrimary }]}>
                Data Permissions
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={14} color={c.textTertiary} />
          </TouchableOpacity>

          <View style={[styles.rowDivider, { backgroundColor: c.separator }]} />

          <TouchableOpacity
            style={styles.rowButton}
            onPress={handleOpenResyncModal}
            disabled={resyncing}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <IconSymbol name="arrow.triangle.2.circlepath" size={18} color={c.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: c.textPrimary }]}>
                  Re-sync HealthKit Data
                </Text>
                {resyncing ? (
                  <Text style={[styles.rowSublabel, { color: c.textTertiary }]}>
                    {resyncProgress
                      ? `Syncing ${resyncProgress.metric}… ${resyncProgress.written} new, ${resyncProgress.skipped} existing`
                      : 'Starting…'}
                  </Text>
                ) : (
                  <Text style={[styles.rowSublabel, { color: c.textTertiary }]}>
                    Pulls missing historical data; never overwrites.
                  </Text>
                )}
              </View>
            </View>
            {resyncing ? (
              <ActivityIndicator size="small" color={c.accent} />
            ) : (
              <IconSymbol name="chevron.right" size={14} color={c.textTertiary} />
            )}
          </TouchableOpacity>

          <View style={[styles.rowDivider, { backgroundColor: c.separator }]} />

          <TouchableOpacity
            style={styles.rowButton}
            onPress={() => router.push('/privacy-policy' as Href)}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <IconSymbol name="hand.raised.shield.fill" size={18} color={c.accent} />
              <Text style={[styles.rowLabel, { color: c.textPrimary }]}>
                Privacy Policy
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={14} color={c.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* 4a. AI-assisted help — opens the same chat the sync-alert
            notification routes to, with triggerReason "participant-initiated"
            so Claude knows the participant came in unprompted. */}
        <TouchableOpacity
          style={[styles.card, { backgroundColor: c.card }]}
          onPress={() =>
            router.push({
              pathname: '/support-chat',
              params: { trigger: 'participant-initiated' },
            } as unknown as Href)
          }
          activeOpacity={0.7}
        >
          <View style={styles.cardHeader}>
            <IconSymbol name="message.fill" size={17} color={c.textSecondary} />
            <Text style={[styles.cardLabel, { color: c.textSecondary }]}>
              Get help with sync issues
            </Text>
          </View>
          <Text style={[styles.contactName, { color: c.textPrimary }]}>
            Chat with StreamSync Support
          </Text>
          <Text style={[styles.contactRole, { color: c.textTertiary }]}>
            AI Assistant — answers in seconds, escalates to the research team if needed
          </Text>
        </TouchableOpacity>

        {/* 4b. Contact / Support */}
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <View style={styles.cardHeader}>
            <IconSymbol name="phone.fill" size={17} color={c.textSecondary} />
            <Text style={[styles.cardLabel, { color: c.textSecondary }]}>
              Contact for study questions
            </Text>
          </View>
          <Text style={[styles.contactName, { color: c.textPrimary }]}>
            {STUDY_COORDINATOR.name}
          </Text>
          <Text style={[styles.contactRole, { color: c.textTertiary }]}>
            {STUDY_COORDINATOR.role}
          </Text>

          <View style={styles.contactActions}>
            <TouchableOpacity
              style={[styles.contactButton, { backgroundColor: c.background }]}
              onPress={() => Linking.openURL(`mailto:${STUDY_COORDINATOR.email}`)}
              activeOpacity={0.7}
            >
              <IconSymbol name="envelope.fill" size={15} color={c.accent} />
              <Text style={[styles.contactButtonText, { color: c.textSecondary }]}>
                {STUDY_COORDINATOR.email}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.contactButton, { backgroundColor: c.background }]}
              onPress={() => Linking.openURL(`tel:${STUDY_COORDINATOR.phone}`)}
              activeOpacity={0.7}
            >
              <IconSymbol name="phone.fill" size={15} color={c.accent} />
              <Text style={[styles.contactButtonText, { color: c.textSecondary }]}>
                {STUDY_COORDINATOR.phone}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity
          style={[styles.signOutButton, { backgroundColor: c.card }]}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <IconSymbol name="rectangle.portrait.and.arrow.right" size={18} color="#D64545" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal
        visible={showResyncModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowResyncModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowResyncModal(false)}
        >
          <Pressable
            style={[styles.modalContent, { backgroundColor: c.card }]}
            onPress={() => {}}
          >
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: c.textPrimary }]}>
              Re-sync HealthKit Data
            </Text>
            <Text style={[styles.modalSubhead, { color: c.textTertiary, textAlign: 'center' }]}>
              Choose how far back to pull historical data. Samples already uploaded will not be overwritten.
            </Text>

            {RESYNC_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.days}
                style={[styles.resyncOption, { backgroundColor: c.background, borderColor: c.separator }]}
                onPress={() => runResync(opt.days)}
                activeOpacity={0.7}
              >
                <Text style={[styles.resyncOptionLabel, { color: c.textPrimary }]}>
                  {opt.label}
                </Text>
                <IconSymbol name="chevron.right" size={14} color={c.textTertiary} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: c.secondaryFill, marginTop: 12 }]}
              onPress={() => setShowResyncModal(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.modalButtonText, { color: c.textPrimary }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showSurgeryDateModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSurgeryDateModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowSurgeryDateModal(false)}
        >
          <Pressable
            style={[styles.modalContent, { backgroundColor: c.card }]}
            onPress={() => {}}
          >
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: c.textPrimary }]}>
              Select Surgery Date
            </Text>
            <Text style={[styles.modalSubhead, { color: c.textTertiary }]}>
              Pick the day of your scheduled BPH surgery. Your study timeline will move into the BPH surgery pathway.
            </Text>

            <View style={[styles.selectedDateRow, { backgroundColor: c.background, borderColor: c.separator }]}>
              <IconSymbol name="calendar" size={18} color={c.accent} />
              <Text style={[styles.selectedDateText, { color: c.textPrimary }]}>
                {formatDate(surgeryDateValue)}
              </Text>
            </View>

            <View style={styles.calendarWrap}>
              {DateTimePicker ? (
                <DateTimePicker
                  mode="single"
                  date={surgeryDateValue}
                  onChange={({ date }: { date: any }) => {
                    if (!date) return;
                    const native =
                      date instanceof Date
                        ? date
                        : new Date(typeof date.valueOf === 'function' ? date.valueOf() : date);
                    setSurgeryDateValue(native);
                  }}
                  styles={{
                    day_label: { color: c.textPrimary },
                    outside_label: { color: c.textTertiary },
                    disabled_label: { color: c.textTertiary, opacity: 0.35 },
                    weekday_label: { color: c.textSecondary },
                    month_selector_label: { color: c.textPrimary, fontWeight: '600' },
                    year_selector_label: { color: c.textPrimary, fontWeight: '600' },
                    today: {
                      borderWidth: 1,
                      borderColor: StanfordColors.cardinal,
                      borderRadius: 999,
                    },
                    today_label: { color: StanfordColors.cardinal },
                    selected: { backgroundColor: StanfordColors.cardinal, borderRadius: 999 },
                    selected_label: { color: '#FFFFFF', fontWeight: '600' },
                  }}
                />
              ) : (
                <Text style={[styles.placeholderText, { color: c.textTertiary, textAlign: 'center' }]}>
                  Calendar unavailable. Please update the app and try again.
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: c.accent, opacity: savingSurgeryDate ? 0.7 : 1 }]}
              onPress={handleSaveSurgeryDate}
              activeOpacity={0.7}
              disabled={savingSurgeryDate}
            >
              <Text style={styles.modalButtonText}>
                {savingSurgeryDate ? 'Saving...' : 'Save Surgery Date'}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Data Permissions modal retired in favor of /permissions-status route.
          The per-type status matrix (with iOS read-permission-quirk copy)
          lives at app/permissions-status.tsx. */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    // Leaves room for the liquid-glass tab bar (position: absolute) so the
    // sign-out button isn't hidden behind it.
    paddingBottom: 120,
  },
  screenTitle: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.37,
    marginBottom: 20,
  },

  // Cards — iOS grouped style
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  cardLabel: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.2,
  },

  // Account info
  accountName: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.semibold,
    color: '#2C3E50',
  },
  accountNameDark: {
    color: '#D4D8E8',
  },
  accountEmail: {
    fontSize: FontSize.footnote,
    color: '#7A7F8E',
    marginTop: 2,
  },
  accountEmailDark: {
    color: '#6B7394',
  },
  placeholderText: {
    fontSize: FontSize.subhead,
    lineHeight: 22,
    fontStyle: 'italic',
  },

  // Segmented control — iOS style
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: 9,
    padding: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 7,
  },
  segmentSelected: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.medium,
  },

  // Sign out
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  signOutText: {
    fontSize: FontSize.subhead,
    fontWeight: FontWeight.semibold,
    color: '#D64545',
  },

  // Tappable row buttons — iOS Settings style
  rowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowLabel: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.regular,
  },
  rowSublabel: {
    fontSize: FontSize.footnote,
    marginTop: 2,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 44,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingRight: 4,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 8,
    marginRight: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: FontSize.subhead,
    lineHeight: 22,
  },

  // Contact
  contactName: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.semibold,
  },
  contactRole: {
    fontSize: FontSize.footnote,
    marginTop: 2,
    marginBottom: 14,
  },
  contactActions: {
    gap: 8,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  contactButtonText: {
    fontSize: FontSize.subhead,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  modalContent: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 20,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#C7C7CC',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
    marginBottom: 12,
  },
  modalBody: {
    fontSize: FontSize.subhead,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  modalSubhead: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.medium,
    marginBottom: 12,
    textAlign: 'left',
  },
  modalButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  modalButtonText: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.semibold,
    color: '#FFFFFF',
  },
  selectedDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  selectedDateText: {
    fontSize: FontSize.body,
    fontWeight: FontWeight.semibold,
  },
  calendarWrap: {
    marginBottom: 8,
  },
  resyncOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  resyncOptionLabel: {
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },
});
