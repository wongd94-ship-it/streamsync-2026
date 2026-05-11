/**
 * Voiding Dashboard Screen
 *
 * Clinical-style uroflow dashboard with:
 *  - Trend charts (Day / Week / Month)
 *  - Summary averages
 *  - Pre vs Post surgery comparison
 *  - Recent session list with tap-to-detail
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LiquidGlassBackdrop } from '@/components/ui/LiquidGlassBackdrop';
import { router } from 'expo-router';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { FontSize, FontWeight } from '@/lib/theme/typography';
import { useAuth } from '@/lib/auth/auth-context';
import { DEV_FIREBASE_UID, DEMO_THRONE_UID } from '@/lib/constants';
import {
  fetchSessions,
  fetchMetricsBatch,
  fetchSurgeryDate,
  saveSurgeryDate,
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
  computeSummaryStats,
  computeComparisonStats,
  filterComparisonWindows,
  groupByDay,
  type RangeKey,
  type ComparisonWindowDays,
  type PostWindowMode,
  type BucketPoint,
  type SummaryStats,
  type ComparisonStats,
} from '@/src/data/voidingAggregation';
import {
  METRIC_LABELS,
  METRIC_UNITS,
  METRIC_KEYS,
  type VoidMetricKey,
} from '@/src/data/voidingFieldMap';

// ─── Constants ────────────────────────────────────────────────────────────────

const RANGE_LABELS: Record<RangeKey, string> = {
  '1d': 'Day',
  '1w': 'Week',
  '1m': 'Month',
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const WINDOW_OPTIONS: ComparisonWindowDays[] = [14, 30];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(startTs: string, endTs: string): string {
  const ms = new Date(endTs).getTime() - new Date(startTs).getTime();
  const sec = Math.round(ms / 1000);
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return min === 0 ? `${s}s` : `${min}m ${s}s`;
}

function formatMetricValue(value: number | null, key: VoidMetricKey): string {
  if (value === null) return '—';
  if (key === 'durationSeconds') {
    const min = Math.floor(value / 60);
    const sec = Math.round(value % 60);
    return min > 0 ? `${min}m ${sec}s` : `${Math.round(value)}s`;
  }
  return value.toFixed(1);
}

function formatDateLabel(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function deltaSign(v: number | null): string {
  if (v === null) return '';
  return v >= 0 ? '+' : '';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Segmented pill row used for range and window selectors. */
function PillRow<T extends string | number>({
  options,
  selected,
  onSelect,
  labelFn,
  c,
}: {
  options: T[];
  selected: T;
  onSelect: (v: T) => void;
  labelFn: (v: T) => string;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
}) {
  return (
    <View style={pillStyles.row}>
      {options.map(opt => {
        const active = opt === selected;
        return (
          <Pressable
            key={String(opt)}
            onPress={() => onSelect(opt)}
            style={[
              pillStyles.pill,
              { backgroundColor: active ? c.accent : c.secondaryFill },
            ]}
          >
            <Text style={[pillStyles.text, { color: active ? '#FFFFFF' : c.textPrimary }]}>
              {labelFn(opt)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const pillStyles = StyleSheet.create({
  row:  { flexDirection: 'row', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  text: { fontSize: FontSize.caption, fontWeight: FontWeight.semibold },
});

/** A single metric summary card. */
function StatCard({
  label,
  value,
  unit,
  c,
}: {
  label: string;
  value: string;
  unit: string;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
}) {
  return (
    <View style={[statStyles.card, { backgroundColor: c.card }]}>
      <Text style={[statStyles.label, { color: c.textSecondary }]}>{label}</Text>
      <View style={statStyles.valueRow}>
        <Text style={[statStyles.value, { color: c.textPrimary }]}>{value}</Text>
        {value !== '—' && (
          <Text style={[statStyles.unit, { color: c.textTertiary }]}>{unit}</Text>
        )}
      </View>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card:     { flex: 1, borderRadius: 12, padding: 14, marginHorizontal: 4 },
  label:    { fontSize: FontSize.micro, fontWeight: FontWeight.medium, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  value:    { fontSize: FontSize.titleMedium, fontWeight: FontWeight.bold },
  unit:     { fontSize: FontSize.caption, fontWeight: FontWeight.medium },
});

/** Bar chart — same approach as throne-session.tsx FlowCurveChart. */
function TrendBarChart({
  data,
  accentColor,
  c,
}: {
  data: BucketPoint[];
  accentColor: string;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
}) {
  const chartWidth = Dimensions.get('window').width - 32 - 32 - 36; // screen - px*2 - card px*2 - yAxis
  const chartHeight = 100;

  if (data.length === 0) {
    return (
      <View style={[chartStyles.empty, { height: chartHeight }]}>
        <Text style={[chartStyles.emptyText, { color: c.textTertiary }]}>
          No data for this period
        </Text>
      </View>
    );
  }

  const maxVal = Math.max(...data.map(d => d.value), 0.01);
  const barWidth = Math.max(8, Math.floor((chartWidth - (data.length - 1) * 4) / data.length));

  return (
    <View>
      <View style={[chartStyles.chartRow, { height: chartHeight }]}>
        {/* Y-axis */}
        <View style={chartStyles.yAxis}>
          <Text style={[chartStyles.axisLabel, { color: c.textTertiary }]}>
            {maxVal.toFixed(1)}
          </Text>
          <Text style={[chartStyles.axisLabel, { color: c.textTertiary }]}>0</Text>
        </View>

        {/* Bar area */}
        <View style={chartStyles.barArea}>
          {/* Grid lines */}
          <View style={[chartStyles.gridLine, { top: 0, borderColor: c.separator }]} />
          <View style={[chartStyles.gridLine, { top: '50%', borderColor: c.separator }]} />
          <View style={[chartStyles.gridLine, { bottom: 0, borderColor: c.separator }]} />

          <View style={chartStyles.barRow}>
            {data.map((pt, i) => {
              const heightPct = (pt.value / maxVal) * 100;
              return (
                <View key={i} style={chartStyles.barWrapper}>
                  <View
                    style={{
                      width: barWidth,
                      height: `${heightPct}%` as `${number}%`,
                      backgroundColor: accentColor,
                      borderRadius: 3,
                      opacity: 0.85,
                    }}
                  />
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* X-axis labels */}
      <View style={[chartStyles.xRow, { paddingLeft: 36 }]}>
        {data.map((pt, i) => {
          // Show every label or sparse if many
          const showLabel = data.length <= 7 || i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 5) === 0;
          return (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              {showLabel && (
                <Text style={[chartStyles.xLabel, { color: c.textTertiary }]}>
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

const chartStyles = StyleSheet.create({
  chartRow:  { flexDirection: 'row', alignItems: 'stretch' },
  yAxis:     { width: 36, justifyContent: 'space-between', paddingRight: 6, alignItems: 'flex-end' },
  axisLabel: { fontSize: FontSize.chartAxis },
  barArea:   { flex: 1, position: 'relative' },
  gridLine:  { position: 'absolute', left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  barRow:    { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 4, paddingBottom: 0 },
  barWrapper:{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  xRow:      { flexDirection: 'row', marginTop: 4 },
  xLabel:    { fontSize: FontSize.chartAxis },
  empty:     { justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: FontSize.footnote },
});

/** One column of the pre/post comparison card. */
function ComparisonColumn({
  title,
  subtitle,
  stats,
  hasEnoughData,
  c,
}: {
  title: string;
  subtitle: string;
  stats: SummaryStats;
  hasEnoughData: boolean;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
}) {
  const rows: { label: string; value: string; unit: string }[] = [
    {
      label: 'Avg Flow',
      value: stats.avgFlowRate !== null ? stats.avgFlowRate.toFixed(1) : '—',
      unit:  'mL/s',
    },
    {
      label: 'Volume',
      value: stats.avgVolume !== null ? Math.round(stats.avgVolume).toString() : '—',
      unit:  'mL',
    },
    {
      label: 'Duration',
      value: stats.avgDuration !== null
        ? (stats.avgDuration >= 60
          ? `${Math.floor(stats.avgDuration / 60)}m ${Math.round(stats.avgDuration % 60)}s`
          : `${Math.round(stats.avgDuration)}s`)
        : '—',
      unit: '',
    },
    {
      label: 'Voids',
      value: String(stats.voidCount),
      unit:  '',
    },
  ];

  return (
    <View style={cmpStyles.column}>
      <Text style={[cmpStyles.columnTitle, { color: c.textPrimary }]}>{title}</Text>
      <Text style={[cmpStyles.columnSub, { color: c.textSecondary }]}>{subtitle}</Text>

      {!hasEnoughData ? (
        <Text style={[cmpStyles.noData, { color: c.textTertiary }]}>
          Not enough data yet
        </Text>
      ) : (
        rows.map(row => (
          <View key={row.label} style={cmpStyles.row}>
            <Text style={[cmpStyles.rowLabel, { color: c.textSecondary }]}>{row.label}</Text>
            <View style={cmpStyles.rowValueRow}>
              <Text style={[cmpStyles.rowValue, { color: c.textPrimary }]}>{row.value}</Text>
              {row.unit ? (
                <Text style={[cmpStyles.rowUnit, { color: c.textTertiary }]}> {row.unit}</Text>
              ) : null}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const cmpStyles = StyleSheet.create({
  column:      { flex: 1 },
  columnTitle: { fontSize: FontSize.footnote, fontWeight: FontWeight.semibold, marginBottom: 2 },
  columnSub:   { fontSize: FontSize.micro, marginBottom: 10 },
  noData:      { fontSize: FontSize.caption, fontStyle: 'italic', marginTop: 8 },
  row:         { marginBottom: 8 },
  rowLabel:    { fontSize: FontSize.micro, fontWeight: FontWeight.medium, marginBottom: 2 },
  rowValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  rowValue:    { fontSize: FontSize.subhead, fontWeight: FontWeight.semibold },
  rowUnit:     { fontSize: FontSize.micro, fontWeight: FontWeight.regular },
});

/** Delta badge shown below the comparison columns. */
function DeltaBadge({
  label,
  delta,
  deltaPct,
  unit,
  c,
}: {
  label: string;
  delta: number | null;
  deltaPct: number | null;
  unit: string;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
}) {
  if (delta === null) return null;

  const sign = delta >= 0 ? '+' : '';
  const pctStr = deltaPct !== null ? ` (${deltaSign(deltaPct)}${deltaPct.toFixed(0)}%)` : '';

  return (
    <View style={[deltaStyles.badge, { backgroundColor: c.secondaryFill }]}>
      <Text style={[deltaStyles.text, { color: c.textSecondary }]}>
        {label}:{' '}
        <Text style={{ color: c.textPrimary, fontWeight: FontWeight.semibold }}>
          {sign}{delta.toFixed(1)} {unit}
        </Text>
        <Text style={{ color: c.textTertiary }}>{pctStr}</Text>
      </Text>
    </View>
  );
}

const deltaStyles = StyleSheet.create({
  badge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginTop: 10 },
  text:  { fontSize: FontSize.caption },
});

// ─── Surgery Date Picker Modal ────────────────────────────────────────────────

function SurgeryDateModal({
  visible,
  initialDate,
  onCancel,
  onConfirm,
  c,
}: {
  visible: boolean;
  initialDate: Date;
  onCancel: () => void;
  onConfirm: (date: Date) => void;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
}) {
  const [year,  setYear]  = useState(initialDate.getFullYear());
  const [month, setMonth] = useState(initialDate.getMonth() + 1); // 1-based
  const [day,   setDay]   = useState(initialDate.getDate());

  const daysInMonth = new Date(year, month, 0).getDate();
  const clampedDay  = Math.min(day, daysInMonth);

  const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  function increment(
    setter: React.Dispatch<React.SetStateAction<number>>,
    min: number,
    max: number,
  ) {
    setter(v => v < max ? v + 1 : min);
  }

  function decrement(
    setter: React.Dispatch<React.SetStateAction<number>>,
    min: number,
    max: number,
  ) {
    setter(v => v > min ? v - 1 : max);
  }

  function handleConfirm() {
    const safeDay = Math.min(clampedDay, daysInMonth);
    const d = new Date(year, month - 1, safeDay, 12, 0, 0);
    onConfirm(d);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={mdlStyles.overlay}>
        <View style={[mdlStyles.sheet, { backgroundColor: c.card }]}>
          <Text style={[mdlStyles.title, { color: c.textPrimary }]}>Surgery Date</Text>
          <Text style={[mdlStyles.sub, { color: c.textSecondary }]}>
            Used to separate pre- and post-surgery data
          </Text>

          <View style={mdlStyles.pickersRow}>
            {/* Month */}
            <View style={mdlStyles.pickerCol}>
              <Text style={[mdlStyles.pickerLabel, { color: c.textTertiary }]}>Month</Text>
              <Pressable onPress={() => increment(setMonth, 1, 12)} hitSlop={10}>
                <Text style={[mdlStyles.arrow, { color: c.accent }]}>▲</Text>
              </Pressable>
              <Text style={[mdlStyles.pickerValue, { color: c.textPrimary }]}>
                {MONTH_NAMES[month - 1]}
              </Text>
              <Pressable onPress={() => decrement(setMonth, 1, 12)} hitSlop={10}>
                <Text style={[mdlStyles.arrow, { color: c.accent }]}>▼</Text>
              </Pressable>
            </View>

            {/* Day */}
            <View style={mdlStyles.pickerCol}>
              <Text style={[mdlStyles.pickerLabel, { color: c.textTertiary }]}>Day</Text>
              <Pressable onPress={() => increment(setDay, 1, daysInMonth)} hitSlop={10}>
                <Text style={[mdlStyles.arrow, { color: c.accent }]}>▲</Text>
              </Pressable>
              <Text style={[mdlStyles.pickerValue, { color: c.textPrimary }]}>
                {String(clampedDay).padStart(2, '0')}
              </Text>
              <Pressable onPress={() => decrement(setDay, 1, daysInMonth)} hitSlop={10}>
                <Text style={[mdlStyles.arrow, { color: c.accent }]}>▼</Text>
              </Pressable>
            </View>

            {/* Year */}
            <View style={mdlStyles.pickerCol}>
              <Text style={[mdlStyles.pickerLabel, { color: c.textTertiary }]}>Year</Text>
              <Pressable onPress={() => increment(setYear, 2020, 2035)} hitSlop={10}>
                <Text style={[mdlStyles.arrow, { color: c.accent }]}>▲</Text>
              </Pressable>
              <Text style={[mdlStyles.pickerValue, { color: c.textPrimary }]}>{year}</Text>
              <Pressable onPress={() => decrement(setYear, 2020, 2035)} hitSlop={10}>
                <Text style={[mdlStyles.arrow, { color: c.accent }]}>▼</Text>
              </Pressable>
            </View>
          </View>

          <View style={mdlStyles.buttonRow}>
            <Pressable
              onPress={onCancel}
              style={[mdlStyles.btn, { backgroundColor: c.secondaryFill }]}
            >
              <Text style={[mdlStyles.btnText, { color: c.textSecondary }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              style={[mdlStyles.btn, { backgroundColor: c.accent }]}
            >
              <Text style={[mdlStyles.btnText, { color: '#FFFFFF' }]}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const mdlStyles = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', alignItems: 'center' },
  sheet:       { borderRadius: 20, padding: 24, width: '80%', alignItems: 'center' },
  title:       { fontSize: FontSize.headline, fontWeight: FontWeight.semibold, marginBottom: 4 },
  sub:         { fontSize: FontSize.footnote, textAlign: 'center', marginBottom: 24 },
  pickersRow:  { flexDirection: 'row', gap: 24, marginBottom: 28 },
  pickerCol:   { alignItems: 'center', gap: 8, minWidth: 56 },
  pickerLabel: { fontSize: FontSize.micro, fontWeight: FontWeight.medium, textTransform: 'uppercase', letterSpacing: 0.3 },
  arrow:       { fontSize: FontSize.headline, fontWeight: FontWeight.semibold },
  pickerValue: { fontSize: FontSize.titleSmall, fontWeight: FontWeight.semibold, minWidth: 44, textAlign: 'center' },
  buttonRow:   { flexDirection: 'row', gap: 12 },
  btn:         { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  btnText:     { fontSize: FontSize.subhead, fontWeight: FontWeight.semibold },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function VoidingScreen() {
  const { theme } = useAppTheme();
  const { isDark, colors: c } = theme;
  const { user } = useAuth();
  const uid = user?.id ?? (__DEV__ ? DEV_FIREBASE_UID : null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [range,          setRange]          = useState<RangeKey>('1w');
  const [metric,         setMetric]         = useState<VoidMetricKey>('avgFlowRate');
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [windowDays,     setWindowDays]     = useState<ComparisonWindowDays>(14);
  const [postMode,       setPostMode]       = useState<PostWindowMode>('immediate');
  const [showDateModal,  setShowDateModal]  = useState(false);

  // ── Data state ────────────────────────────────────────────────────────────
  const [allSessions,  setAllSessions]  = useState<ThroneSession[]>([]);
  const [metricsMap,   setMetricsMap]   = useState<Map<string, ThroneMetric[]>>(new Map());
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [refreshKey,   setRefreshKey]   = useState(0);

  // ── Surgery date ──────────────────────────────────────────────────────────
  const [surgeryDate,  setSurgeryDate]  = useState<Date | null>(null);
  const [sdLoading,    setSdLoading]    = useState(true);

  // ─── Load surgery date ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadSurgeryDate() {
      if (!uid) { setSdLoading(false); return; }
      try {
        const ds = await fetchSurgeryDate(uid);
        if (!cancelled && ds) {
          setSurgeryDate(new Date(ds + 'T12:00:00'));
        }
      } catch {
        // ignore — surgery date stays null
      } finally {
        if (!cancelled) setSdLoading(false);
      }
    }

    loadSurgeryDate();
    return () => { cancelled = true; };
  }, [uid]);

  // ─── Load sessions + metrics ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const startDate = new Date(Date.now() - NINETY_DAYS_MS);
        if (!uid) return;
        // Fetch this user's own throne data — was previously hardcoded to
        // DEMO_THRONE_UID and every user saw the demo account's voids.
        const data = await fetchSessions(uid, { startDate });
        if (cancelled) return;
        setAllSessions(data);

        // Batch-fetch metrics for all sessions
        if (data.length > 0) {
          const ids = data.map(s => s.id);
          const metrics = await fetchMetricsBatch(uid, ids);
          if (cancelled) return;

          // Build a Map: sessionId → ThroneMetric[]
          const map = new Map<string, ThroneMetric[]>();
          for (const m of metrics) {
            const arr = map.get(m.sessionId);
            if (arr) arr.push(m);
            else map.set(m.sessionId, [m]);
          }
          setMetricsMap(map);
        }
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) { setLoading(false); setRefreshing(false); }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [refreshKey, uid]);

  // ─── Pull-to-refresh ──────────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey(k => k + 1);
  }, []);

  // ─── Parsed sessions (memoized) ───────────────────────────────────────────
  const parsedSessions = useMemo<ParsedVoidSession[]>(() => {
    return allSessions.map(s =>
      parseSessionWithMetrics(s, metricsMap.get(s.id) ?? []),
    );
  }, [allSessions, metricsMap]);

  // ─── Range-filtered ───────────────────────────────────────────────────────
  const rangedSessions = useMemo(
    () => filterByRange(parsedSessions, range),
    [parsedSessions, range],
  );

  // ─── Summary stats ────────────────────────────────────────────────────────
  const summaryStats = useMemo(
    () => computeSummaryStats(rangedSessions),
    [rangedSessions],
  );

  // ─── Trend chart data ─────────────────────────────────────────────────────
  const chartData = useMemo(
    () => bucketSeries(rangedSessions, range, metric),
    [rangedSessions, range, metric],
  );

  // ─── Comparison windows ───────────────────────────────────────────────────
  const { preSessions, postSessions } = useMemo(() => {
    if (!surgeryDate || !compareEnabled) {
      return { preSessions: [] as ParsedVoidSession[], postSessions: [] as ParsedVoidSession[] };
    }
    return filterComparisonWindows(parsedSessions, surgeryDate, windowDays, postMode);
  }, [parsedSessions, surgeryDate, compareEnabled, windowDays, postMode]);

  const comparisonStats: ComparisonStats = useMemo(
    () => computeComparisonStats(preSessions, postSessions),
    [preSessions, postSessions],
  );

  // ─── Session list sections ────────────────────────────────────────────────
  const sections = useMemo(() => groupByDay(rangedSessions), [rangedSessions]);

  // ─── Surgery date save ────────────────────────────────────────────────────
  async function handleSetSurgeryDate(date: Date) {
    setShowDateModal(false);
    setSurgeryDate(date);
    if (uid) {
      const ds = date.toISOString().slice(0, 10);
      try { await saveSurgeryDate(uid, ds); } catch { /* best-effort */ }
    }
  }

  // ─── Render helpers ───────────────────────────────────────────────────────
  const hasSurgeryDate  = surgeryDate !== null;
  const preHasData      = preSessions.length >= 3;
  const postHasData     = postSessions.length >= 3;

  const surgeryDateLabel = hasSurgeryDate
    ? surgeryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const postWindowLabel = postMode === 'immediate'
    ? `${windowDays}d post-op`
    : `Recent ${windowDays}d`;

  const preWindowLabel = `${windowDays}d pre-op`;

  // ─── List header component ────────────────────────────────────────────────
  const ListHeader = (
    <View>
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <View style={styles.titleRow}>
        <Text style={[styles.header, { color: c.textPrimary }]}>Voiding</Text>
        {hasSurgeryDate && !sdLoading && (
          <Pressable
            onPress={() => setShowDateModal(true)}
            style={[styles.chip, { backgroundColor: c.secondaryFill }]}
          >
            <Text style={[styles.chipText, { color: c.accent }]}>
              Pre/Post · {surgeryDateLabel}
            </Text>
          </Pressable>
        )}
      </View>

      {/* ── Range selector ────────────────────────────────────────────────── */}
      <View style={styles.controlsCard}>
        <PillRow
          options={['1d', '1w', '1m'] as RangeKey[]}
          selected={range}
          onSelect={(v) => setRange(v)}
          labelFn={r => RANGE_LABELS[r]}
          c={c}
        />
      </View>

      {/* ── Metric selector ───────────────────────────────────────────────── */}
      <View style={[styles.controlsCard, { marginTop: 0 }]}>
        <PillRow
          options={METRIC_KEYS}
          selected={metric}
          onSelect={(v) => setMetric(v)}
          labelFn={k => METRIC_LABELS[k]}
          c={c}
        />
      </View>

      {/* ── Summary Cards ─────────────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
        {RANGE_LABELS[range]} Summary
      </Text>
      <View style={[styles.statsRow, { marginHorizontal: -4 }]}>
        <StatCard
          label="Avg Flow"
          value={summaryStats.avgFlowRate !== null ? summaryStats.avgFlowRate.toFixed(1) : '—'}
          unit="mL/s"
          c={c}
        />
        <StatCard
          label="Volume"
          value={summaryStats.avgVolume !== null ? Math.round(summaryStats.avgVolume).toString() : '—'}
          unit="mL"
          c={c}
        />
        <StatCard
          label="Voids"
          value={String(summaryStats.voidCount)}
          unit=""
          c={c}
        />
      </View>

      {/* ── Trend Chart ───────────────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
        {METRIC_LABELS[metric]} Trend
      </Text>
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <View style={styles.chartMetaRow}>
          <Text style={[styles.chartMetric, { color: c.textPrimary }]}>
            {METRIC_LABELS[metric]}
          </Text>
          <Text style={[styles.chartUnit, { color: c.textTertiary }]}>
            {METRIC_UNITS[metric]}
          </Text>
        </View>
        <TrendBarChart data={chartData} accentColor={c.accent} c={c} />
      </View>

      {/* ── Pre / Post Comparison ─────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
        Pre vs Post Surgery
      </Text>

      {!hasSurgeryDate && !sdLoading ? (
        /* CTA: set surgery date */
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <Text style={[styles.ctaTitle, { color: c.textPrimary }]}>
            Compare before & after surgery
          </Text>
          <Text style={[styles.ctaBody, { color: c.textSecondary }]}>
            Add your surgery date to see how your metrics changed.
          </Text>
          <Pressable
            onPress={() => setShowDateModal(true)}
            style={[styles.ctaButton, { backgroundColor: c.accent }]}
          >
            <Text style={styles.ctaButtonText}>Set surgery date</Text>
          </Pressable>
        </View>
      ) : hasSurgeryDate ? (
        /* Comparison section */
        <View style={[styles.card, { backgroundColor: c.card }]}>
          {/* Toggle + window controls */}
          <View style={styles.cmpHeader}>
            <View style={styles.cmpToggleRow}>
              <Text style={[styles.cmpToggleLabel, { color: c.textPrimary }]}>
                Compare pre vs post
              </Text>
              <Switch
                value={compareEnabled}
                onValueChange={setCompareEnabled}
                trackColor={{ false: c.separator, true: c.accent }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>

          {compareEnabled && (
            <>
              <View style={[styles.separator, { backgroundColor: c.separator }]} />

              {/* Window size pills */}
              <View style={styles.windowControls}>
                <Text style={[styles.windowLabel, { color: c.textTertiary }]}>Window</Text>
                <PillRow
                  options={WINDOW_OPTIONS}
                  selected={windowDays}
                  onSelect={(v) => setWindowDays(v)}
                  labelFn={d => `${d}d`}
                  c={c}
                />
              </View>

              {/* Post window mode */}
              <View style={styles.windowControls}>
                <Text style={[styles.windowLabel, { color: c.textTertiary }]}>Post window</Text>
                <PillRow
                  options={['immediate', 'recent'] as PostWindowMode[]}
                  selected={postMode}
                  onSelect={(v) => setPostMode(v)}
                  labelFn={m => m === 'immediate' ? 'After surgery' : 'Most recent'}
                  c={c}
                />
              </View>

              <View style={[styles.separator, { backgroundColor: c.separator }]} />

              {/* Two-column comparison */}
              <View style={styles.cmpColumns}>
                <ComparisonColumn
                  title="PRE"
                  subtitle={preWindowLabel}
                  stats={comparisonStats.pre}
                  hasEnoughData={preHasData}
                  c={c}
                />
                <View style={[styles.cmpDivider, { backgroundColor: c.separator }]} />
                <ComparisonColumn
                  title="POST"
                  subtitle={postWindowLabel}
                  stats={comparisonStats.post}
                  hasEnoughData={postHasData}
                  c={c}
                />
              </View>

              {/* Delta badges */}
              {(preHasData && postHasData) && (
                <>
                  <DeltaBadge
                    label="Avg Flow"
                    delta={comparisonStats.deltaFlow}
                    deltaPct={comparisonStats.deltaFlowPct}
                    unit="mL/s"
                    c={c}
                  />
                  <DeltaBadge
                    label="Volume"
                    delta={comparisonStats.deltaVolume}
                    deltaPct={comparisonStats.deltaVolumePct}
                    unit="mL"
                    c={c}
                  />
                </>
              )}
            </>
          )}
        </View>
      ) : null}

      {/* ── Recent Voids header ───────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
        Recent Voids · {summaryStats.voidCount} in {RANGE_LABELS[range].toLowerCase()}
      </Text>
    </View>
  );

  // ─── Empty / loading / error states ──────────────────────────────────────
  if (error && allSessions.length === 0 && !loading) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <LiquidGlassBackdrop variant="default" />
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.centered}>
            <Text style={[styles.header, { color: c.textPrimary }]}>Voiding</Text>
            <Text style={[styles.subtitle, { color: c.textSecondary }]}>{error}</Text>
            <Pressable
              onPress={() => { setError(null); setLoading(true); setRefreshKey(k => k + 1); }}
              style={[styles.retryButton, { backgroundColor: c.accent }]}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <LiquidGlassBackdrop variant="default" />
      <SafeAreaView style={styles.container} edges={['top']}>
      {loading ? (
        <View style={styles.centered}>
          <Text style={[styles.header, { color: c.textPrimary }]}>Voiding</Text>
          <ActivityIndicator size="large" color={c.accent} style={{ marginTop: 24 }} />
          <Text style={[styles.subtitle, { color: c.textSecondary, marginTop: 12 }]}>
            Loading sessions…
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={[styles.subtitle, { color: c.textSecondary }]}>
                No sessions in this period.
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={c.accent}
            />
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
                {section.title}
              </Text>
              <Text style={[styles.sectionCount, { color: c.textSecondary }]}>
                {section.data.length} void{section.data.length !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <SessionCard session={item} c={c} isDark={isDark} />
          )}
        />
      )}

      {/* Surgery Date Picker Modal */}
      <SurgeryDateModal
        visible={showDateModal}
        initialDate={surgeryDate ?? new Date()}
        onCancel={() => setShowDateModal(false)}
        onConfirm={handleSetSurgeryDate}
        c={c}
      />
      </SafeAreaView>
    </View>
  );
}

// ─── Session Card ─────────────────────────────────────────────────────────────

function SessionCard({
  session,
  c,
  isDark,
}: {
  session: ParsedVoidSession;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
  isDark: boolean;
}) {
  return (
    <Pressable
      style={[styles.card, { backgroundColor: c.card }]}
      onPress={() => router.push({ pathname: '/throne-session', params: { id: session.id } })}
    >
      <View style={styles.cardRow}>
        <Text style={[styles.cardTime, { color: c.textPrimary }]}>
          {session.timestamp.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true,
          })}
        </Text>
        <Text style={[styles.cardStatus, {
          color: session.status === 'DONE' ? c.semanticSuccess : c.textSecondary,
        }]}>
          {session.status}
        </Text>
      </View>

      <View style={styles.cardRow}>
        <View style={styles.metricChips}>
          {session.avgFlowRate !== null && (
            <MetricChip label="Qavg" value={`${session.avgFlowRate.toFixed(1)} mL/s`} c={c} isDark={isDark} />
          )}
          {session.voidedVolume !== null && (
            <MetricChip label="Vol" value={`${Math.round(session.voidedVolume)} mL`} c={c} isDark={isDark} />
          )}
          {session.durationSeconds !== null && (
            <MetricChip
              label="Dur"
              value={formatDuration(session.startTs, session.endTs)}
              c={c}
              isDark={isDark}
            />
          )}
        </View>
        <Text style={[styles.cardChevron, { color: c.textTertiary }]}>›</Text>
      </View>

      {session.tags.length > 0 && (
        <View style={styles.tagsRow}>
          {session.tags.map(tag => (
            <View key={tag} style={[styles.tag, { backgroundColor: c.secondaryFill }]}>
              <Text style={[styles.tagText, { color: c.textSecondary }]}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

function MetricChip({
  label,
  value,
  c,
  isDark,
}: {
  label: string;
  value: string;
  c: ReturnType<typeof useAppTheme>['theme']['colors'];
  isDark: boolean;
}) {
  return (
    <View style={[chipStyles.chip, { backgroundColor: c.secondaryFill }]}>
      <Text style={[chipStyles.label, { color: c.textTertiary }]}>{label} </Text>
      <Text style={[chipStyles.value, { color: c.textPrimary }]}>{value}</Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  chip:  { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  label: { fontSize: FontSize.micro, fontWeight: FontWeight.medium },
  value: { fontSize: FontSize.micro, fontWeight: FontWeight.semibold },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:     { flex: 1 },
  centered:      { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  list:          { paddingHorizontal: 16, paddingBottom: 120 },
  emptyState:    { paddingTop: 24, alignItems: 'center' },

  header:        { fontSize: FontSize.display, fontWeight: FontWeight.bold, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  subtitle:      { fontSize: FontSize.subhead, textAlign: 'center', lineHeight: 22 },
  retryButton:   { marginTop: 20, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12 },
  retryText:     { fontSize: FontSize.subhead, fontWeight: FontWeight.semibold, color: '#FFFFFF' },

  titleRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   paddingRight: 16, marginBottom: 4 },
  chip:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16 },
  chipText:      { fontSize: FontSize.micro, fontWeight: FontWeight.semibold },

  controlsCard:  { paddingHorizontal: 16, marginBottom: 10 },

  sectionLabel:  { fontSize: FontSize.footnote, fontWeight: FontWeight.semibold, marginTop: 20, marginBottom: 8, marginLeft: 4 },
  statsRow:      { flexDirection: 'row', marginBottom: 4 },

  card:          { borderRadius: 14, padding: 16, marginBottom: 10 },
  chartMetaRow:  { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 12 },
  chartMetric:   { fontSize: FontSize.footnote, fontWeight: FontWeight.semibold },
  chartUnit:     { fontSize: FontSize.micro },

  // CTA card
  ctaTitle:      { fontSize: FontSize.subhead, fontWeight: FontWeight.semibold, marginBottom: 6 },
  ctaBody:       { fontSize: FontSize.footnote, lineHeight: 18, marginBottom: 16 },
  ctaButton:     { paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  ctaButtonText: { fontSize: FontSize.subhead, fontWeight: FontWeight.semibold, color: '#FFFFFF' },

  // Comparison
  cmpHeader:     { marginBottom: 4 },
  cmpToggleRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cmpToggleLabel:{ fontSize: FontSize.subhead, fontWeight: FontWeight.medium },
  separator:     { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  windowControls:{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  windowLabel:   { fontSize: FontSize.micro, fontWeight: FontWeight.medium, minWidth: 72 },
  cmpColumns:    { flexDirection: 'row', gap: 0 },
  cmpDivider:    { width: StyleSheet.hairlineWidth, marginHorizontal: 16 },

  // Session list
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
                   paddingTop: 8, paddingBottom: 6 },
  sectionTitle:  { fontSize: FontSize.subhead, fontWeight: FontWeight.semibold },
  sectionCount:  { fontSize: FontSize.caption, fontWeight: FontWeight.medium },

  cardRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardTime:      { fontSize: FontSize.subhead, fontWeight: FontWeight.semibold },
  cardStatus:    { fontSize: FontSize.micro, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  metricChips:   { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 },
  cardChevron:   { fontSize: FontSize.headline, fontWeight: '300', paddingLeft: 8 },

  tagsRow:       { flexDirection: 'row', gap: 6, marginTop: 4 },
  tag:           { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText:       { fontSize: FontSize.micro, fontWeight: FontWeight.medium },
});
