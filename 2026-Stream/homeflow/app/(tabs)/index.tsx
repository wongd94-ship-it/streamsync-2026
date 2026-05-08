/**
 * Home Screen — StreamSync Wellness Dashboard
 *
 * Displays:
 *  - Throne Science uroflow module (7-day chart with metric toggle)
 *  - Apple HealthKit module (activity rings, sleep, vitals)
 *  - Study dates and timeline
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { LiquidGlassCard } from '@/components/ui/LiquidGlassCard';
import { STORAGE_KEYS, DEV_FIREBASE_UID, DEMO_THRONE_UID } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { notifyOnboardingComplete } from '@/hooks/use-onboarding-status';
import { useStudyDates } from '@/hooks/use-study-dates';
import { SurgeryCompleteModal } from '@/components/home/SurgeryCompleteModal';
import { useAuth } from '@/lib/auth/auth-context';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { FontSize, FontWeight } from '@/lib/theme/typography';
import { useHealthSummary } from '@/hooks/use-health-summary';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/src/services/firebase';
import {
  fetchSessions,
  fetchMetricsBatch,
  type ThroneSession,
  type ThroneMetric,
} from '@/src/services/throneFirestore';
import {
  parseSessionWithMetrics,
  type ParsedVoidSession,
} from '@/src/data/parseVoidingSession';
import {
  filterByRange,
  bucketSeries,
  type BucketPoint,
} from '@/src/data/voidingAggregation';
import {
  METRIC_LABELS,
  METRIC_UNITS,
  METRIC_KEYS,
  type VoidMetricKey,
} from '@/src/data/voidingFieldMap';

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const MOVE_GOAL_KCAL = 500;
const EXERCISE_GOAL_MIN = 30;
const STEPS_GOAL = 10_000;

// ─── Activity Ring Component ──────────────────────────────────────────────────

/**
 * Draws a single circular progress ring using the two-half-disc technique.
 * Works without any SVG library.
 */
function CircleRing({
  pct,
  color,
  size,
  strokeWidth,
  bgColor,
}: {
  pct: number;
  color: string;
  size: number;
  strokeWidth: number;
  bgColor: string;
}) {
  const r = Math.max(0, Math.min(1, isNaN(pct) ? 0 : pct));
  const half = size / 2;
  const innerSize = size - strokeWidth * 2;

  const rightDeg = r <= 0.5 ? -180 + r * 360 : 0;
  const leftDeg = r <= 0.5 ? -180 : -180 + (r - 0.5) * 360;

  return (
    <View style={{ width: size, height: size }}>
      {/* Gray track disc */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: half,
          backgroundColor: `${color}30`,
        }}
      />

      {/* Right half fill */}
      <View
        style={{
          position: 'absolute',
          width: half,
          height: size,
          left: half,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            right: 0,
            borderRadius: half,
            backgroundColor: color,
            transform: [{ rotate: `${rightDeg}deg` }],
          }}
        />
      </View>

      {/* Left half fill — only shown past 50% */}
      {r > 0.5 && (
        <View
          style={{
            position: 'absolute',
            width: half,
            height: size,
            left: 0,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              position: 'absolute',
              width: size,
              height: size,
              left: 0,
              borderRadius: half,
              backgroundColor: color,
              transform: [{ rotate: `${leftDeg}deg` }],
            }}
          />
        </View>
      )}

      {/* Inner cutout to create ring appearance */}
      <View
        style={{
          position: 'absolute',
          top: strokeWidth,
          left: strokeWidth,
          width: innerSize,
          height: innerSize,
          borderRadius: innerSize / 2,
          backgroundColor: bgColor,
        }}
      />
    </View>
  );
}

/** Three concentric activity rings (Move / Exercise / Steps). */
function ActivityRings({
  movePct,
  exercisePct,
  stepsPct,
  cardColor,
}: {
  movePct: number;
  exercisePct: number;
  stepsPct: number;
  cardColor: string;
}) {
  const STROKE = 10;
  const GAP = 3;
  const OUTER = 86;
  const MIDDLE = OUTER - STROKE * 2 - GAP * 2;
  const INNER = MIDDLE - STROKE * 2 - GAP * 2;

  const middleOffset = STROKE + GAP;
  const innerOffset = STROKE * 2 + GAP * 2;

  return (
    <View style={{ width: OUTER, height: OUTER }}>
      <CircleRing pct={movePct} color="#FF375F" size={OUTER} strokeWidth={STROKE} bgColor={cardColor} />
      <View style={{ position: 'absolute', top: middleOffset, left: middleOffset }}>
        <CircleRing pct={exercisePct} color="#30D158" size={MIDDLE} strokeWidth={STROKE} bgColor={cardColor} />
      </View>
      <View style={{ position: 'absolute', top: innerOffset, left: innerOffset }}>
        <CircleRing pct={stepsPct} color="#32ADE6" size={INNER} strokeWidth={STROKE} bgColor={cardColor} />
      </View>
    </View>
  );
}

// ─── Mini bar chart ───────────────────────────────────────────────────────────

function MiniBarChart({
  data,
  accentColor,
  c,
}: {
  data: BucketPoint[];
  accentColor: string;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
}) {
  const CHART_HEIGHT = 80;
  const screenW = Dimensions.get('window').width;
  const chartW = screenW - 32 * 2 - 16 * 2 - 36; // screen - screenPad*2 - cardPad*2 - yAxis

  if (data.length === 0) {
    return (
      <View style={[miniChartStyles.empty, { height: CHART_HEIGHT }]}>
        <Text style={[miniChartStyles.emptyText, { color: c.textTertiary }]}>
          No data this week
        </Text>
      </View>
    );
  }

  const maxVal = Math.max(...data.map((d) => d.value), 0.01);
  const barW = Math.max(6, Math.floor((chartW - (data.length - 1) * 4) / data.length));

  return (
    <View>
      <View style={[miniChartStyles.chartRow, { height: CHART_HEIGHT }]}>
        {/* Y-axis */}
        <View style={miniChartStyles.yAxis}>
          <Text style={[miniChartStyles.axisLabel, { color: c.textTertiary }]}>
            {maxVal.toFixed(1)}
          </Text>
          <Text style={[miniChartStyles.axisLabel, { color: c.textTertiary }]}>0</Text>
        </View>

        {/* Bars */}
        <View style={miniChartStyles.barArea}>
          <View style={[miniChartStyles.gridLine, { top: 0, borderColor: c.separator }]} />
          <View style={[miniChartStyles.gridLine, { top: '50%', borderColor: c.separator }]} />
          <View style={[miniChartStyles.gridLine, { bottom: 0, borderColor: c.separator }]} />
          <View style={miniChartStyles.barRow}>
            {data.map((pt, i) => (
              <View key={i} style={miniChartStyles.barWrapper}>
                <View
                  style={{
                    width: barW,
                    height: `${(pt.value / maxVal) * 100}%` as `${number}%`,
                    backgroundColor: accentColor,
                    borderRadius: 3,
                    opacity: 0.85,
                  }}
                />
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* X labels */}
      <View style={[miniChartStyles.xRow, { paddingLeft: 36 }]}>
        {data.map((pt, i) => {
          const show =
            data.length <= 7 ||
            i === 0 ||
            i === data.length - 1 ||
            i % Math.ceil(data.length / 5) === 0;
          return (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              {show && (
                <Text style={[miniChartStyles.xLabel, { color: c.textTertiary }]}>
                  {pt.label}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const miniChartStyles = StyleSheet.create({
  chartRow: { flexDirection: 'row', alignItems: 'stretch' },
  yAxis: { width: 36, justifyContent: 'space-between', paddingRight: 6, alignItems: 'flex-end' },
  axisLabel: { fontSize: FontSize.chartAxis },
  barArea: { flex: 1, position: 'relative' },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  barWrapper: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  xRow: { flexDirection: 'row', marginTop: 4 },
  xLabel: { fontSize: FontSize.chartAxis },
  empty: { justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: FontSize.footnote },
});

// ─── Metric pill row ──────────────────────────────────────────────────────────

function MetricPills({
  selected,
  onSelect,
  c,
}: {
  selected: VoidMetricKey;
  onSelect: (k: VoidMetricKey) => void;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
}) {
  return (
    <View style={pillStyles.row}>
      {METRIC_KEYS.map((key) => {
        const active = key === selected;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            style={[
              pillStyles.pill,
              { backgroundColor: active ? c.accent : c.secondaryFill },
            ]}
          >
            <Text style={[pillStyles.text, { color: active ? '#FFFFFF' : c.textPrimary }]}>
              {METRIC_LABELS[key]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const pillStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  text: { fontSize: FontSize.caption, fontWeight: FontWeight.semibold },
});

// ─── Vitals row ───────────────────────────────────────────────────────────────

function VitalRow({
  icon,
  label,
  value,
  color,
  c,
  isLast,
}: {
  icon: string;
  label: string;
  value: string;
  color: string;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
  isLast?: boolean;
}) {
  return (
    <>
      <View style={vitalStyles.row}>
        <View style={[vitalStyles.iconBox, { backgroundColor: `${color}20` }]}>
          <IconSymbol name={icon as any} size={16} color={color} />
        </View>
        <Text style={[vitalStyles.label, { color: c.textSecondary }]}>{label}</Text>
        <Text style={[vitalStyles.value, { color: c.textPrimary }]}>{value}</Text>
      </View>
      {!isLast && <View style={[vitalStyles.divider, { backgroundColor: c.separator }]} />}
    </>
  );
}

const vitalStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  iconBox: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: FontSize.subhead },
  value: { fontSize: FontSize.subhead, fontWeight: FontWeight.semibold },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 40 },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMetricSummary(sessions: ParsedVoidSession[], metric: VoidMetricKey): string {
  const vals = sessions.map((s) => s[metric]).filter((v): v is number => v !== null);
  if (vals.length === 0) return '—';
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (metric === 'durationSeconds') {
    const sec = Math.round(avg);
    if (sec >= 60) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    return `${sec}s`;
  }
  return avg.toFixed(1);
}

function daysUntil(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Scheduled for today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) return '';
  return `${diff} days from now`;
}

// Legacy glass surface helper — retained only so older call sites compile.
// LiquidGlassCard now handles tint/blur/border/shadow natively.

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { theme } = useAppTheme();
  const { colors: t, isDark } = theme;
  const { user } = useAuth();
  const uid = user?.id ?? (__DEV__ ? DEV_FIREBASE_UID : null);
  const study = useStudyDates();

  const [showSurgeryModal, setShowSurgeryModal] = useState(false);
  const [showDevSheet, setShowDevSheet] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // ─── Auto-show Surgery Complete modal (once, when surgery date first passes) ─
  useEffect(() => {
    if (study.isLoading || study.primaryType !== 'surgery' || !study.hasPrimaryPassed) return;

    async function maybeShowModal() {
      const already = await AsyncStorage.getItem(STORAGE_KEYS.SURGERY_MODAL_SHOWN);
      if (!already) {
        await AsyncStorage.setItem(STORAGE_KEYS.SURGERY_MODAL_SHOWN, 'true');
        setShowSurgeryModal(true);
      }
    }

    maybeShowModal();
  }, [study.isLoading, study.primaryType, study.hasPrimaryPassed]);

  // ─── Throne data ───────────────────────────────────────────────────────────

  const [sessions, setSessions] = useState<ParsedVoidSession[]>([]);
  const [throneLoading, setThroneLoading] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<VoidMetricKey>('avgFlowRate');

  // Auto-refresh when the Cloud Function completes a sync (throne_sync/state.lastRunAt changes).
  // Keyed on the SIGNED-IN user's uid, not the demo account, so each user
  // only sees refresh signals for their own Throne ingestion runs.
  useEffect(() => {
    if (!uid) return;
    let prevLastRunAt: string | null = null;
    const unsub = onSnapshot(
      doc(db, `users/${uid}/throne_sync/state`),
      (snap) => {
        const lastRunAt = snap.data()?.lastRunAt ?? null;
        if (prevLastRunAt !== null && lastRunAt !== prevLastRunAt) {
          setRefreshKey((k) => k + 1);
        }
        prevLastRunAt = lastRunAt;
      },
      (err) => console.warn('[Throne] sync state listener error:', err),
    );
    return unsub;
  }, [uid]);

  useEffect(() => {
    let cancelled = false;

    async function loadThroneData() {
      setThroneLoading(true);
      try {
        const since = new Date(Date.now() - WEEK_MS);
        if (!uid) return;
        // Fetch this user's own throne data — was previously hardcoded to
        // DEMO_THRONE_UID which leaked another tester's sessions onto
        // every dashboard.
        const raw: ThroneSession[] = await fetchSessions(uid, { startDate: since });
        if (cancelled) return;

        const ids = raw.map((s) => s.id);
        const allMetrics: ThroneMetric[] = await fetchMetricsBatch(uid, ids);
        if (cancelled) return;

        // Build sessionId → ThroneMetric[] map (same as voiding.tsx)
        const metricsMap = new Map<string, ThroneMetric[]>();
        for (const m of allMetrics) {
          const arr = metricsMap.get(m.sessionId);
          if (arr) arr.push(m);
          else metricsMap.set(m.sessionId, [m]);
        }

        // Keep all sessions (no status filter) — same as voiding.tsx
        const parsed: ParsedVoidSession[] = raw
          .map((s) => parseSessionWithMetrics(s, metricsMap.get(s.id) ?? []));

        if (!cancelled) setSessions(parsed);
      } catch {
        // silent — empty state shows
      } finally {
        if (!cancelled) setThroneLoading(false);
      }
    }

    loadThroneData();
    return () => { cancelled = true; };
  }, [refreshKey, uid]);

  const weekSessions = useMemo(
    () => filterByRange(sessions, '1w'),
    [sessions],
  );

  const chartData = useMemo(
    () => bucketSeries(weekSessions, '1w', selectedMetric),
    [weekSessions, selectedMetric],
  );

  const metricAvg = useMemo(
    () => formatMetricSummary(weekSessions, selectedMetric),
    [weekSessions, selectedMetric],
  );

  // ─── HealthKit data ────────────────────────────────────────────────────────

  const { summary: health, isLoading: healthLoading, refresh: refreshHealth } = useHealthSummary();

  const activity = health?.activity ?? null;
  const sleep = health?.raw.sleep ?? null;
  const vitals = health?.raw.vitals ?? null;

  const movePct = activity ? Math.min(1, activity.energyBurned / MOVE_GOAL_KCAL) : 0;
  const exercisePct = activity ? Math.min(1, activity.activeMinutes / EXERCISE_GOAL_MIN) : 0;
  const stepsPct = activity ? Math.min(1, activity.steps / STEPS_GOAL) : 0;

  const sleepLabel = sleep
    ? `${Math.floor(sleep.totalAsleepMinutes / 60)}h ${sleep.totalAsleepMinutes % 60}m`
    : '—';

  const hrLabel = vitals?.heartRate?.average
    ? `${Math.round(vitals.heartRate.average)} bpm`
    : vitals?.restingHeartRate
    ? `${Math.round(vitals.restingHeartRate)} bpm`
    : '—';

  const restingHrLabel = vitals?.restingHeartRate
    ? `${Math.round(vitals.restingHeartRate)} bpm`
    : '—';

  const hrvLabel = vitals?.hrv
    ? `${Math.round(vitals.hrv)} ms`
    : '—';

  // ─── Refresh ───────────────────────────────────────────────────────────────

  const onRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    refreshHealth();
  }, [refreshHealth]);

  const handleResetOnboarding = () => {
    Alert.alert(
      'Reset Onboarding?',
      'This will clear all onboarding progress and restart from the beginning.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              // Pass the current user's uid so the per-uid finished flag is
              // cleared alongside shared onboarding state. Without this, the
              // reset would only wipe the pre-auth scratch and leave the
              // user's completion flag behind.
              await OnboardingService.reset(user?.id ?? null);
              notifyOnboardingComplete();
            } catch {
              Alert.alert('Error', 'Failed to reset onboarding');
            }
          },
        },
      ],
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={throneLoading || healthLoading}
            onRefresh={onRefresh}
            tintColor={t.accent}
          />
        }
      >
        {/* Header */}
        <View style={[styles.heroShell, { backgroundColor: isDark ? '#0A0A0C' : '#EAF2FF' }]}>
          <View style={[styles.heroGlow, styles.heroGlowPrimary, { backgroundColor: isDark ? 'rgba(94,158,255,0.18)' : 'rgba(46,124,246,0.14)' }]} />
          <View style={[styles.heroGlow, styles.heroGlowSecondary, { backgroundColor: isDark ? 'rgba(48,209,88,0.16)' : 'rgba(52,199,89,0.12)' }]} />
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={[styles.dateLabel, { color: t.textTertiary }]}>
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>
              <Text style={[styles.greetingNormal, { color: t.textPrimary }]}>
                Welcome to
              </Text>
              <Text style={[styles.greeting, { color: t.textPrimary }]}>
                StreamSync
              </Text>
            </View>
            {__DEV__ && (
              <TouchableOpacity
                style={[styles.devPill, { backgroundColor: t.secondaryFill }]}
                onPress={() => setShowDevSheet(true)}
                activeOpacity={0.7}
              >
                <IconSymbol name="wrench.fill" size={13} color={t.textTertiary} />
                <Text style={[styles.devPillText, { color: t.textTertiary }]}>Dev</Text>
              </TouchableOpacity>
            )}
          </View>
          <LiquidGlassCard
            borderRadius={28}
            intensity={70}
            accent={t.accent}
            style={styles.heroCard}
          >
            <View style={styles.heroCardTopRow}>
              <Text style={[styles.heroEyebrow, { color: t.textTertiary }]}>Current pathway</Text>
              <Text style={[styles.heroTitle, { color: t.textPrimary }]}>
                {study.pathwayLabel}
              </Text>
            </View>
            <Text style={[styles.heroDate, { color: t.textPrimary }]}>
              {study.primaryDate ? study.phaseLabel : 'Add a study date during onboarding'}
            </Text>
            <Text style={[styles.heroBody, { color: t.textSecondary }]}>
              {study.primaryDate ? study.phaseDescription : 'Your dashboard timeline will update once your study pathway is scheduled.'}
            </Text>
          </LiquidGlassCard>
        </View>

        <View style={styles.dateGrid}>
          <LiquidGlassCard style={styles.glassCard}>
            <View style={styles.cardHeader}>
              <IconSymbol name="calendar.badge.clock" size={17} color={t.accent} />
              <Text style={[styles.cardLabel, { color: t.textSecondary }]}>Surgery date</Text>
            </View>
            <Text style={[styles.cardValue, { color: t.textPrimary }]}>
              {study.isLoading ? 'Loading...' : study.surgery.label}
            </Text>
            {!!study.surgery.date && (
              <Text style={[styles.cardSubtext, { color: t.textTertiary }]}>
                {daysUntil(study.surgery.date) || 'Completed'}
              </Text>
            )}
          </LiquidGlassCard>

          <LiquidGlassCard style={styles.glassCard}>
            <View style={styles.cardHeader}>
              <IconSymbol name="waveform.path.ecg" size={17} color={t.semanticSuccess} />
              <Text style={[styles.cardLabel, { color: t.textSecondary }]}>Urodynamic study</Text>
            </View>
            <Text style={[styles.cardValue, { color: t.textPrimary }]}>
              {study.isLoading ? 'Loading...' : study.urodynamics.label}
            </Text>
            {!!study.urodynamics.date && (
              <Text style={[styles.cardSubtext, { color: t.textTertiary }]}>
                {daysUntil(study.urodynamics.date) || 'Completed'}
              </Text>
            )}
          </LiquidGlassCard>
        </View>

        {!study.isLoading && (
          <LiquidGlassCard style={[styles.glassCard, styles.timelineGlassCard]}>
            <View style={styles.cardHeader}>
              <IconSymbol name="calendar" size={17} color={t.semanticSuccess} />
              <Text style={[styles.cardLabel, { color: t.textSecondary }]}>Study timeline</Text>
            </View>
            <View style={styles.timelineTrack}>
              <View style={[styles.timelineFill, { backgroundColor: `${t.accent}1F`, borderColor: `${t.accent}24` }]} />
            </View>
            <View style={styles.timelineRow}>
              <View style={styles.timelineItem}>
                <Text style={[styles.timelineLabel, { color: t.textTertiary }]}>Current phase</Text>
                <Text style={[styles.timelineValue, { color: t.textPrimary }]}>
                  {study.phaseLabel}
                </Text>
              </View>
              <View style={[styles.timelineDivider, { backgroundColor: t.separator }]} />
              <View style={styles.timelineItem}>
                <Text style={[styles.timelineLabel, { color: t.textTertiary }]}>Timeline end</Text>
                <Text style={[styles.timelineValue, { color: t.textPrimary }]}>
                  {study.timelineEndLabel}
                </Text>
              </View>
            </View>
            <Text style={[styles.cardSubtext, { color: t.textTertiary, marginTop: 12 }]}>
              {study.timelineCaption}
            </Text>
          </LiquidGlassCard>
        )}

        {/* ─── Throne Science Module ─────────────────────────────────────── */}
        <LiquidGlassCard style={styles.moduleCard}>
          <View style={styles.moduleHeader}>
            <View style={styles.moduleHeaderLeft}>
              <View style={[styles.moduleIconBox, { backgroundColor: '#5E4AE320' }]}>
                <IconSymbol name="drop.fill" size={16} color="#5E4AE3" />
              </View>
              <View>
                <Text style={[styles.moduleTitle, { color: t.textPrimary }]}>
                  Throne Science
                </Text>
                <Text style={[styles.moduleSubtitle, { color: t.textTertiary }]}>
                  Uroflow · Past 7 days
                </Text>
              </View>
            </View>
          </View>

          {/* Metric toggles */}
          <MetricPills selected={selectedMetric} onSelect={setSelectedMetric} c={t} />

          {/* Summary stat */}
          <View style={styles.metricSummaryRow}>
            <Text style={[styles.metricSummaryValue, { color: t.textPrimary }]}>
              {throneLoading ? '—' : metricAvg}
            </Text>
            <Text style={[styles.metricSummaryUnit, { color: t.textTertiary }]}>
              {' '}{METRIC_UNITS[selectedMetric]}
            </Text>
            <Text style={[styles.metricSummaryLabel, { color: t.textTertiary }]}>
              {'  '}avg {METRIC_LABELS[selectedMetric].toLowerCase()}
            </Text>
          </View>

          {/* Bar chart */}
          {throneLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={t.accent} />
            </View>
          ) : (
            <MiniBarChart data={chartData} accentColor="#5E4AE3" c={t} />
          )}
        </LiquidGlassCard>

        {/* ─── Apple HealthKit Module ────────────────────────────────────── */}
        <LiquidGlassCard style={styles.moduleCard}>
          <View style={styles.moduleHeader}>
            <View style={styles.moduleHeaderLeft}>
              <View style={[styles.moduleIconBox, { backgroundColor: `${t.semanticError}20` }]}>
                <IconSymbol name="heart.fill" size={16} color={t.semanticError} />
              </View>
              <View>
                <Text style={[styles.moduleTitle, { color: t.textPrimary }]}>
                  Apple Health
                </Text>
                <Text style={[styles.moduleSubtitle, { color: t.textTertiary }]}>
                  {"Today's summary"}
                </Text>
              </View>
            </View>
          </View>

          {healthLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={t.accent} />
            </View>
          ) : Platform.OS !== 'ios' ? (
            <Text style={[styles.platformNote, { color: t.textTertiary }]}>
              Apple Health is only available on iOS.
            </Text>
          ) : (
            <>
              {/* Activity rings + stats */}
              <View style={styles.activityRow}>
                <ActivityRings
                  movePct={movePct}
                  exercisePct={exercisePct}
                  stepsPct={stepsPct}
                  cardColor={t.card}
                />

                <View style={styles.activityStats}>
                  <View style={styles.activityStatRow}>
                    <View style={[styles.ringDot, { backgroundColor: '#FF375F' }]} />
                    <Text style={[styles.activityStatLabel, { color: t.textSecondary }]}>
                      Move
                    </Text>
                    <Text style={[styles.activityStatValue, { color: t.textPrimary }]}>
                      {activity ? `${Math.round(activity.energyBurned)} kcal` : '—'}
                    </Text>
                  </View>
                  <View style={styles.activityStatRow}>
                    <View style={[styles.ringDot, { backgroundColor: '#30D158' }]} />
                    <Text style={[styles.activityStatLabel, { color: t.textSecondary }]}>
                      Exercise
                    </Text>
                    <Text style={[styles.activityStatValue, { color: t.textPrimary }]}>
                      {activity ? `${activity.activeMinutes} min` : '—'}
                    </Text>
                  </View>
                  <View style={styles.activityStatRow}>
                    <View style={[styles.ringDot, { backgroundColor: '#32ADE6' }]} />
                    <Text style={[styles.activityStatLabel, { color: t.textSecondary }]}>
                      Steps
                    </Text>
                    <Text style={[styles.activityStatValue, { color: t.textPrimary }]}>
                      {activity ? activity.steps.toLocaleString() : '—'}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={[styles.sectionDivider, { backgroundColor: t.separator }]} />

              {/* Sleep, Heart Rate, Resting Heart Rate, HRV */}
              <VitalRow
                icon="moon.fill"
                label="Sleep"
                value={sleepLabel}
                color="#BF5AF2"
                c={t}
              />
              <VitalRow
                icon="heart.fill"
                label="Heart Rate"
                value={hrLabel}
                color="#FF375F"
                c={t}
              />
              <VitalRow
                icon="heart.fill"
                label="Resting Heart Rate"
                value={restingHrLabel}
                color="#FF6B35"
                c={t}
              />
              <VitalRow
                icon="waveform.path.ecg"
                label="Heart Rate Variability"
                value={hrvLabel}
                color="#30D158"
                c={t}
                isLast
              />
            </>
          )}
        </LiquidGlassCard>

        {/* Recovery plan card removed — StreamSync is a research app and
            does not provide medical instructions or post-op guidance.
            Discharge instructions live with the participant's care team. */}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Surgery Complete Modal */}
      <SurgeryCompleteModal
        visible={showSurgeryModal}
        onDismiss={() => setShowSurgeryModal(false)}
      />

      {/* Dev Tools Sheet */}
      {__DEV__ && (
        <Modal
          visible={showDevSheet}
          animationType="slide"
          transparent
          onRequestClose={() => setShowDevSheet(false)}
        >
          <Pressable style={styles.sheetOverlay} onPress={() => setShowDevSheet(false)}>
            <Pressable
              style={[styles.sheetContent, { backgroundColor: t.card }]}
              onPress={() => {}}
            >
              <View style={styles.sheetHandle} />
              <Text style={[styles.sheetTitle, { color: t.textTertiary }]}>Developer Tools</Text>

              <TouchableOpacity
                style={[styles.sheetButton, { backgroundColor: t.background }]}
                onPress={() => {
                  setShowDevSheet(false);
                  setTimeout(() => setShowSurgeryModal(true), 300);
                }}
                activeOpacity={0.7}
              >
                <IconSymbol name="checkmark.circle.fill" size={18} color={t.semanticSuccess} />
                <Text style={[styles.sheetButtonText, { color: t.textPrimary }]}>
                  Trigger Surgery Complete
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sheetButton, { backgroundColor: t.background }]}
                onPress={() => {
                  setShowDevSheet(false);
                  setTimeout(handleResetOnboarding, 300);
                }}
                activeOpacity={0.7}
              >
                <IconSymbol name="sparkles" size={18} color={t.accent} />
                <Text style={[styles.sheetButtonText, { color: t.textPrimary }]}>
                  Reset Onboarding
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetCancel}
                onPress={() => setShowDevSheet(false)}
                activeOpacity={0.7}
              >
                <Text style={[styles.sheetCancelText, { color: t.accent }]}>Close</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  // paddingBottom leaves room for the liquid-glass tab bar which now sits
  // absolutely on top of the scroll content.
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 110 },

  heroShell: {
    borderRadius: 30,
    padding: 18,
    marginBottom: 14,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
  },
  heroGlowPrimary: {
    top: -60,
    right: -30,
  },
  heroGlowSecondary: {
    bottom: -100,
    left: -40,
  },
  heroCard: {
    marginTop: 10,
    padding: 20,
  },
  heroCardTopRow: {
    marginBottom: 2,
  },
  heroEyebrow: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: FontSize.titleMedium,
    fontWeight: FontWeight.bold,
  },
  heroDate: {
    fontSize: FontSize.titleLarge,
    fontWeight: FontWeight.bold,
    marginTop: 16,
  },
  heroBody: {
    fontSize: FontSize.subhead,
    lineHeight: 20,
    marginTop: 8,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerText: { flex: 1 },
  dateLabel: { fontSize: FontSize.footnote, fontWeight: FontWeight.regular, marginBottom: 2 },
  greetingNormal: { fontSize: FontSize.display, fontWeight: FontWeight.bold, letterSpacing: 0.37 },
  greeting: { fontSize: FontSize.display, fontWeight: FontWeight.bold, letterSpacing: 0.37, fontStyle: 'italic' },
  devPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    marginTop: 20,
  },
  devPillText: { fontSize: FontSize.caption, fontWeight: FontWeight.medium },

  dateGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  // Layout-only wrapper for LiquidGlassCard; the card handles blur/border/shadow.
  glassCard: {
    flex: 1,
    padding: 18,
    marginBottom: 12,
  },
  timelineGlassCard: {
    flex: undefined,
  },
  timelineTrack: {
    height: 12,
    borderRadius: 999,
    marginBottom: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(120,120,128,0.12)',
  },
  timelineFill: {
    width: '58%',
    height: '100%',
    borderRadius: 999,
    borderWidth: 1,
  },

  // Module cards (Throne + HealthKit) — LiquidGlassCard owns visuals.
  moduleCard: {
    padding: 18,
    marginBottom: 12,
    gap: 12,
  },
  moduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moduleHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  moduleIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleTitle: { fontSize: FontSize.headline, fontWeight: FontWeight.bold },
  moduleSubtitle: { fontSize: FontSize.caption, marginTop: 1 },

  // Metric summary
  metricSummaryRow: { flexDirection: 'row', alignItems: 'baseline' },
  metricSummaryValue: { fontSize: FontSize.titleLarge, fontWeight: FontWeight.bold },
  metricSummaryUnit: { fontSize: FontSize.subhead, fontWeight: FontWeight.medium },
  metricSummaryLabel: { fontSize: FontSize.footnote },

  // Loading
  loadingRow: { height: 80, alignItems: 'center', justifyContent: 'center' },
  platformNote: { fontSize: FontSize.subhead, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },

  // Activity rings section
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  activityStats: { flex: 1, gap: 10 },
  activityStatRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ringDot: { width: 8, height: 8, borderRadius: 4 },
  activityStatLabel: { flex: 1, fontSize: FontSize.footnote },
  activityStatValue: { fontSize: FontSize.footnote, fontWeight: FontWeight.semibold },
  sectionDivider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },

  // Legacy cards (surgery, timeline, etc.)
  card: { borderRadius: 12, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  cardLabel: { fontSize: FontSize.footnote, fontWeight: FontWeight.semibold, letterSpacing: 0.2 },
  accentBorder: {
    borderLeftWidth: 3,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  cardValue: { fontSize: FontSize.titleMedium, fontWeight: FontWeight.bold, letterSpacing: 0.35 },
  cardSubtext: { fontSize: FontSize.subhead, fontWeight: FontWeight.regular, marginTop: 4 },
  timelineRow: { flexDirection: 'row', alignItems: 'center' },
  timelineItem: { flex: 1 },
  timelineLabel: { fontSize: FontSize.footnote, fontWeight: FontWeight.regular, marginBottom: 2 },
  timelineValue: { fontSize: FontSize.headline, fontWeight: FontWeight.semibold },
  timelineDivider: { width: StyleSheet.hairlineWidth, height: 32, marginHorizontal: 16 },
  reminderCard: { borderRadius: 12, padding: 16, marginBottom: 12 },
  reminderContent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  reminderTextContainer: { flex: 1 },
  reminderTitle: { fontSize: FontSize.subhead, fontWeight: FontWeight.semibold, marginBottom: 2 },
  reminderBody: { fontSize: FontSize.footnote, lineHeight: 18 },
  allSetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  allSetText: { fontSize: FontSize.subhead, fontWeight: FontWeight.regular },

  // Dev sheet
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  sheetContent: { borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 20, paddingBottom: 40 },
  sheetHandle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#C7C7CC',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.2,
    marginBottom: 16,
    textAlign: 'center',
  },
  sheetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
  },
  sheetButtonText: { fontSize: FontSize.headline, fontWeight: FontWeight.regular },
  sheetCancel: { alignItems: 'center', padding: 14, marginTop: 4 },
  sheetCancelText: { fontSize: FontSize.headline, fontWeight: FontWeight.semibold },
});
