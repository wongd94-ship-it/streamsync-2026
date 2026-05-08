import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import type { ActivityInsight } from '@/lib/services/health-summary';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { FontSize, FontWeight } from '@/lib/theme/typography';

interface ActivitySectionProps {
  insight: ActivityInsight;
}

export function ActivitySection({ insight }: ActivitySectionProps) {
  const [expanded, setExpanded] = useState(false);
  const { theme } = useAppTheme();
  const { colors: c } = theme;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => setExpanded(!expanded)}
      style={[styles.card, { backgroundColor: c.card }]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <IconSymbol name="figure.walk" size={17} color={c.semanticSuccess} />
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Activity</Text>
        </View>
        <IconSymbol
          name="chevron.right"
          size={14}
          color={c.textTertiary}
          style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
        />
      </View>

      <Text style={[styles.headline, { color: c.textPrimary }]}>
        {insight.headline}
      </Text>
      {insight.windowLabel && (
        <Text style={[styles.windowLabel, { color: c.textTertiary }]}>
          {insight.windowLabel}
        </Text>
      )}
      <Text style={[styles.supporting, { color: c.textSecondary }]}>
        {insight.supportingText}
      </Text>

      {expanded && (
        <View style={styles.details}>
          <Text style={[styles.detailRow, { color: c.textTertiary }]}>
            Steps: {insight.steps.toLocaleString()}
          </Text>
          <Text style={[styles.detailRow, { color: c.textTertiary }]}>
            Energy burned: {Math.round(insight.energyBurned)} kcal
          </Text>
          <Text style={[styles.detailRow, { color: c.textTertiary }]}>
            Distance: {(insight.distance / 1000).toFixed(1)} km
          </Text>
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
  windowLabel: {
    fontSize: FontSize.caption ?? 12,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  supporting: {
    fontSize: FontSize.subhead,
    lineHeight: 22,
  },
  details: {
    marginTop: 16,
  },
  detailRow: {
    fontSize: FontSize.subhead,
    marginTop: 8,
  },
});
