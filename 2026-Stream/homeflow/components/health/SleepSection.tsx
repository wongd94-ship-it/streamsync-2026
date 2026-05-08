import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DurationBar } from './DurationBar';
import type { SleepInsight } from '@/lib/services/health-summary';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { FontSize, FontWeight } from '@/lib/theme/typography';

interface SleepSectionProps {
  insight: SleepInsight;
}

/**
 * Format a fractional-hours value as "7h 30m" for readable display.
 * Falls back to "—" when the input isn't a finite number — protects
 * the UI from upstream NaN bugs without lying about the data.
 */
function formatHoursAndMinutes(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Sleep efficiency = (minutes asleep ÷ minutes in bed) × 100. Good
 * sleep is typically ≥85%; below ~75% often signals insomnia or
 * frequent waking. We show both the number AND a one-word
 * interpretation so the participant doesn't have to know the cutoffs.
 */
function efficiencyLabel(efficiency: number): {
  label: string;
  color: 'good' | 'okay' | 'low';
} {
  if (!Number.isFinite(efficiency)) return { label: '—', color: 'okay' };
  if (efficiency >= 85) return { label: 'Excellent', color: 'good' };
  if (efficiency >= 75) return { label: 'Good', color: 'good' };
  if (efficiency >= 65) return { label: 'Fair', color: 'okay' };
  return { label: 'Low', color: 'low' };
}

export function SleepSection({ insight }: SleepSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const { theme } = useAppTheme();
  const { isDark, colors: c } = theme;

  const accent = isDark ? '#BF5AF2' : '#AF52DE'; // systemPurple — sleep
  const eff = efficiencyLabel(insight.efficiency);
  const effColor =
    eff.color === 'good'
      ? c.semanticSuccess
      : eff.color === 'low'
        ? c.semanticError
        : c.semanticWarning;

  // Compute time-in-bed by inverting the efficiency formula. Avoids a
  // type change on SleepInsight and keeps this presentation logic local.
  const totalMinutes = insight.totalHours * 60;
  const inBedMinutes =
    insight.efficiency > 0
      ? Math.round((totalMinutes / insight.efficiency) * 100)
      : totalMinutes;

  const totalLabel = formatHoursAndMinutes(insight.totalHours);
  const baselineLabel = formatHoursAndMinutes(insight.baselineHours);
  const inBedLabel = formatMinutes(inBedMinutes);

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => setExpanded(!expanded)}
      style={[styles.card, { backgroundColor: c.card }]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <IconSymbol name="moon.fill" size={17} color={accent} />
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Sleep</Text>
        </View>
        <IconSymbol
          name="chevron.right"
          size={14}
          color={c.textTertiary}
          style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
        />
      </View>

      <Text style={[styles.headline, { color: c.textPrimary }]}>
        {/* Replace the legacy "{totalHours} hours" string with the
            formatted "Xh Ym" version. Headlines coming from
            derive-insights still embed the raw number, so we strip and
            replace; if the regex doesn't match (older insight shape) we
            fall through to the original headline. */}
        {insight.headline.replace(
          /about [\d.]+ hours/,
          `about ${totalLabel}`,
        )}
      </Text>
      <Text style={[styles.supporting, { color: c.textSecondary }]}>
        {insight.supportingText}
      </Text>

      {expanded && (
        <View style={styles.details}>
          <DurationBar
            fill={insight.barFill}
            valueLabel={totalLabel}
            baselineLabel={`${baselineLabel} avg`}
          />

          <View style={styles.metricRow}>
            <Text style={[styles.metricLabel, { color: c.textTertiary }]}>
              Asleep
            </Text>
            <Text style={[styles.metricValue, { color: c.textPrimary }]}>
              {totalLabel}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={[styles.metricLabel, { color: c.textTertiary }]}>
              In bed
            </Text>
            <Text style={[styles.metricValue, { color: c.textPrimary }]}>
              {inBedLabel}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={[styles.metricLabel, { color: c.textTertiary }]}>
              Sleep efficiency
            </Text>
            <Text style={[styles.metricValue, { color: effColor }]}>
              {Number.isFinite(insight.efficiency) ? `${insight.efficiency}%` : '—'} · {eff.label}
            </Text>
          </View>
          <Text style={[styles.efficiencyHelp, { color: c.textTertiary }]}>
            How much of your time in bed was actually asleep. ≥85% is excellent;
            below 75% often means restless sleep or frequent waking.
          </Text>

          {insight.stages && (
            <View style={styles.stagesContainer}>
              <Text style={[styles.stagesHeader, { color: c.textSecondary }]}>
                Sleep stages
              </Text>
              <View style={styles.metricRow}>
                <Text style={[styles.metricLabel, { color: c.textTertiary }]}>
                  Deep
                </Text>
                <Text style={[styles.metricValue, { color: c.textPrimary }]}>
                  {formatMinutes(insight.stages.deep)}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={[styles.metricLabel, { color: c.textTertiary }]}>
                  Core
                </Text>
                <Text style={[styles.metricValue, { color: c.textPrimary }]}>
                  {formatMinutes(insight.stages.core)}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={[styles.metricLabel, { color: c.textTertiary }]}>
                  REM
                </Text>
                <Text style={[styles.metricValue, { color: c.textPrimary }]}>
                  {formatMinutes(insight.stages.rem)}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={[styles.metricLabel, { color: c.textTertiary }]}>
                  Awake
                </Text>
                <Text style={[styles.metricValue, { color: c.textPrimary }]}>
                  {formatMinutes(insight.stages.awake)}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.2,
  },
  headline: {
    fontSize: FontSize.titleSmall,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.38,
    marginBottom: 4,
  },
  supporting: {
    fontSize: FontSize.subhead,
    lineHeight: 22,
  },
  details: {
    marginTop: 16,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 10,
  },
  metricLabel: {
    fontSize: FontSize.subhead,
  },
  metricValue: {
    fontSize: FontSize.subhead,
    fontWeight: FontWeight.semibold,
  },
  efficiencyHelp: {
    fontSize: FontSize.caption ?? 12,
    lineHeight: 16,
    marginTop: 6,
  },
  stagesContainer: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(120, 120, 128, 0.2)',
  },
  stagesHeader: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
});
