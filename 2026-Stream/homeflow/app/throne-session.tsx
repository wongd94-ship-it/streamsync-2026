/**
 * Throne Session Detail Screen
 *
 * Displays session header fields, summary stats (Qmax, Qavg, Volume),
 * and a time-series flow curve rendered as a View-based bar chart.
 *
 * Route: /throne-session?id=SE-xxx
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useAuth } from '@/lib/auth/auth-context';
import { DEV_FIREBASE_UID, DEMO_THRONE_UID } from '@/lib/constants';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { FontSize, FontWeight } from '@/lib/theme/typography';
import {
  fetchSessions,
  fetchMetricsForSession,
  type ThroneSession,
  type ThroneMetric,
} from '@/src/services/throneFirestore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function durationString(startTs: string, endTs: string): string {
  const ms = new Date(endTs).getTime() - new Date(startTs).getTime();
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  unit,
  color,
  isDark,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
  isDark: boolean;
}) {
  return (
    <View style={[statStyles.card, { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }]}>
      <Text style={[statStyles.label, { color: isDark ? '#EBEBF599' : '#3C3C4399' }]}>
        {label}
      </Text>
      <View style={statStyles.valueRow}>
        <Text style={[statStyles.value, { color }]}>{value}</Text>
        <Text style={[statStyles.unit, { color: isDark ? '#EBEBF560' : '#3C3C4360' }]}>
          {unit}
        </Text>
      </View>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 4,
  },
  label: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
    marginBottom: 4,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  value: {
    fontSize: FontSize.titleMedium,
    fontWeight: FontWeight.bold,
  },
  unit: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.medium,
  },
});

/** Simple View-based bar chart for the flow curve. */
function FlowCurveChart({
  flowPoints,
  isDark,
  accentColor,
}: {
  flowPoints: { ts: Date; value: number }[];
  isDark: boolean;
  accentColor: string;
}) {
  const chartWidth = Dimensions.get('window').width - 64; // padding
  const chartHeight = 160;

  if (flowPoints.length === 0) {
    return (
      <View style={[chartStyles.empty, { height: chartHeight }]}>
        <Text style={{ color: isDark ? '#EBEBF560' : '#3C3C4360', fontSize: FontSize.subhead }}>
          No flow data recorded
        </Text>
      </View>
    );
  }

  const maxVal = Math.max(...flowPoints.map((p) => p.value), 1);
  const barWidth = Math.max(2, Math.floor(chartWidth / flowPoints.length) - 1);

  return (
    <View style={[chartStyles.container, { height: chartHeight, width: chartWidth }]}>
      {/* Y-axis labels */}
      <View style={chartStyles.yAxis}>
        <Text style={[chartStyles.axisLabel, { color: isDark ? '#EBEBF560' : '#3C3C4360' }]}>
          {maxVal.toFixed(1)}
        </Text>
        <Text style={[chartStyles.axisLabel, { color: isDark ? '#EBEBF560' : '#3C3C4360' }]}>
          0
        </Text>
      </View>

      {/* Bars */}
      <View style={chartStyles.barArea}>
        {/* Grid lines */}
        <View style={[chartStyles.gridLine, { top: 0, borderColor: isDark ? '#38383A' : '#E5E5EA' }]} />
        <View style={[chartStyles.gridLine, { top: '50%', borderColor: isDark ? '#38383A' : '#E5E5EA' }]} />
        <View style={[chartStyles.gridLine, { bottom: 0, borderColor: isDark ? '#38383A' : '#E5E5EA' }]} />

        <View style={chartStyles.barRow}>
          {flowPoints.map((point, i) => {
            const heightPct = (point.value / maxVal) * 100;
            return (
              <View
                key={i}
                style={{
                  width: barWidth,
                  height: `${heightPct}%`,
                  backgroundColor: accentColor,
                  borderRadius: 1,
                  opacity: 0.85,
                }}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  yAxis: {
    width: 36,
    justifyContent: 'space-between',
    paddingRight: 6,
  },
  axisLabel: {
    fontSize: FontSize.chartAxis,
    textAlign: 'right',
  },
  barArea: {
    flex: 1,
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
  },
  empty: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ThroneSessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useAppTheme();
  const { isDark, colors: c } = theme;
  const { user } = useAuth();
  const uid = user?.id ?? (__DEV__ ? DEV_FIREBASE_UID : null);

  const [session, setSession] = useState<ThroneSession | undefined>();
  const [sessionMetrics, setSessionMetrics] = useState<ThroneMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!id || !uid) return;
      try {
        // Fetch the signed-in user's own throne session data — was
        // previously hardcoded to DEMO_THRONE_UID, which leaked another
        // account's session onto the detail screen.
        const [allSessions, metrics] = await Promise.all([
          fetchSessions(uid),
          fetchMetricsForSession(uid, id),
        ]);
        if (!cancelled) {
          setSession(allSessions.find((s) => s.id === id));
          setSessionMetrics(metrics);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id, uid]);

  // Extract summary stats
  const stats = useMemo(() => {
    // Prefer urine.flow.raw, fall back to urine.flow
    let flowMetrics = sessionMetrics.filter((m) => m.series === 'urine.flow.raw');
    if (flowMetrics.length === 0) {
      flowMetrics = sessionMetrics.filter((m) => m.series === 'urine.flow');
    }
    const qmaxMetric = sessionMetrics.find((m) => m.series === 'urine.flow.max');
    const qavgMetric = sessionMetrics.find((m) => m.series === 'urine.flow.avg');
    const volumeMetric = sessionMetrics.find((m) => m.series === 'urine.volume');

    const flowValues = flowMetrics
      .map((m) => (typeof m.value === 'number' ? m.value : parseFloat(String(m.value))))
      .filter(Number.isFinite);

    return {
      qmax: qmaxMetric ? Number(qmaxMetric.value) : (flowValues.length ? Math.max(...flowValues) : null),
      qavg: qavgMetric ? Number(qavgMetric.value) : (flowValues.length ? flowValues.reduce((a, b) => a + b, 0) / flowValues.length : null),
      volume: volumeMetric ? Number(volumeMetric.value) : null,
      flowPoints: flowMetrics.map((m) => ({
        ts: new Date(m.ts),
        value: typeof m.value === 'number' ? m.value : parseFloat(String(m.value)) || 0,
      })),
    };
  }, [sessionMetrics]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <View style={styles.headerBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={[styles.backText, { color: c.accent }]}>Back</Text>
          </Pressable>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <View style={styles.headerBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={[styles.backText, { color: c.accent }]}>Back</Text>
          </Pressable>
        </View>
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: c.textSecondary }]}>
            Session not found
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      {/* Nav bar */}
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.backText, { color: c.accent }]}>{'‹ Back'}</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Session Detail</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── Session Header ──────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.sessionStatus, {
              color: session.status === 'DONE' ? '#34C759' : c.textSecondary,
            }]}>
              {session.status}
            </Text>
            {session.tags.length > 0 && (
              <View style={styles.tagsRow}>
                {session.tags.map((tag) => (
                  <View
                    key={tag}
                    style={[styles.tag, { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}
                  >
                    <Text style={[styles.tagText, { color: c.textSecondary }]}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <InfoRow label="Start" value={formatTimestamp(session.startTs)} color={c} />
          <InfoRow label="End" value={formatTimestamp(session.endTs)} color={c} />
          <InfoRow label="Duration" value={durationString(session.startTs, session.endTs)} color={c} />
          <InfoRow label="Device" value={session.deviceId} color={c} />
          <InfoRow label="Metrics" value={String(session.metricCount)} color={c} />
          <InfoRow label="ID" value={session.id.replace('SE-', '')} color={c} mono />
        </View>

        {/* ── Summary Stats ───────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Summary</Text>
        <View style={styles.statsRow}>
          <StatCard
            label="Qmax"
            value={stats.qmax !== null ? stats.qmax.toFixed(1) : '—'}
            unit="mL/s"
            color={c.accent}
            isDark={isDark}
          />
          <StatCard
            label="Qavg"
            value={stats.qavg !== null ? stats.qavg.toFixed(1) : '—'}
            unit="mL/s"
            color={isDark ? '#BF5AF2' : '#AF52DE'}
            isDark={isDark}
          />
          <StatCard
            label="Volume"
            value={stats.volume !== null ? Math.round(stats.volume).toString() : '—'}
            unit="mL"
            color="#34C759"
            isDark={isDark}
          />
        </View>

        {/* ── Flow Curve ──────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Flow curve</Text>
        <View style={[styles.card, { backgroundColor: c.card, paddingVertical: 16 }]}>
          <FlowCurveChart
            flowPoints={stats.flowPoints}
            isDark={isDark}
            accentColor={c.accent}
          />

          {/* X-axis time labels */}
          {stats.flowPoints.length > 0 && (
            <View style={styles.xAxis}>
              <Text style={[styles.axisText, { color: isDark ? '#EBEBF560' : '#3C3C4360' }]}>
                {stats.flowPoints[0].ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Text>
              <Text style={[styles.axisText, { color: isDark ? '#EBEBF560' : '#3C3C4360' }]}>
                {stats.flowPoints[stats.flowPoints.length - 1].ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
          )}
        </View>

        {/* ── Raw Flow Data Table ─────────────────────────────── */}
        {stats.flowPoints.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
              Flow data ({stats.flowPoints.length} points)
            </Text>
            <View style={[styles.card, { backgroundColor: c.card, paddingHorizontal: 0 }]}>
              {/* Table header */}
              <View style={[styles.tableRow, styles.tableHeader, { borderBottomColor: c.separator }]}>
                <Text style={[styles.tableCell, styles.tableCellTime, { color: c.textSecondary }]}>
                  Time
                </Text>
                <Text style={[styles.tableCell, styles.tableCellValue, { color: c.textSecondary }]}>
                  Flow (mL/s)
                </Text>
              </View>
              {stats.flowPoints.map((point, i) => (
                <View
                  key={i}
                  style={[
                    styles.tableRow,
                    i < stats.flowPoints.length - 1 && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth },
                  ]}
                >
                  <Text style={[styles.tableCell, styles.tableCellTime, { color: c.textPrimary }]}>
                    {point.ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                  </Text>
                  <Text
                    style={[
                      styles.tableCell,
                      styles.tableCellValue,
                      { color: point.value > 0 ? c.accent : c.textTertiary },
                      { fontVariant: ['tabular-nums'] },
                    ]}
                  >
                    {point.value.toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Info Row helper ──────────────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  color,
  mono,
}: {
  label: string;
  value: string;
  color: { textPrimary: string; textSecondary: string; separator: string };
  mono?: boolean;
}) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: color.separator }]}>
      <Text style={[styles.infoLabel, { color: color.textSecondary }]}>{label}</Text>
      <Text
        style={[
          styles.infoValue,
          { color: color.textPrimary },
          mono && { fontFamily: 'Menlo', fontSize: 12 },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backText: {
    fontSize: FontSize.body,
    fontWeight: FontWeight.regular,
  },
  headerTitle: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.semibold,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: FontSize.body,
  },
  card: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sessionStatus: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tagsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    fontSize: FontSize.subhead,
    fontWeight: FontWeight.medium,
  },
  infoValue: {
    fontSize: FontSize.subhead,
    fontWeight: FontWeight.regular,
    maxWidth: '60%',
  },
  sectionLabel: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.semibold,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: -4,
    marginBottom: 8,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingLeft: 36,
  },
  axisText: {
    fontSize: FontSize.chartAxis,
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tableHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 6,
  },
  tableCell: {
    fontSize: FontSize.footnote,
  },
  tableCellTime: {
    flex: 1,
  },
  tableCellValue: {
    width: 80,
    textAlign: 'right',
    fontWeight: FontWeight.medium,
  },
});
