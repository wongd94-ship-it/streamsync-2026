/**
 * LiquidGlassTitle
 *
 * Big readable page-title block — used right under the LiquidGlassTopBar.
 * Matches the design's SSTitle component (eyebrow + 32pt title + 19pt body).
 */

import React from 'react';
import { StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { LGColors } from '@/lib/theme/liquidGlass';
import { useAppTheme } from '@/lib/theme/ThemeContext';

interface Props {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  align?: 'left' | 'center';
  style?: ViewStyle;
  titleStyle?: TextStyle;
}

export function LiquidGlassTitle({
  eyebrow,
  title,
  subtitle,
  align = 'left',
  style,
  titleStyle,
}: Props) {
  const { theme } = useAppTheme();
  const { isDark } = theme;
  const ink = isDark ? LGColors.darkInk : LGColors.ink;
  const ink2 = isDark ? LGColors.darkInk2 : LGColors.ink2;
  const ink3 = isDark ? LGColors.darkInk3 : LGColors.ink3;

  return (
    <View style={[styles.wrap, { alignItems: align === 'center' ? 'center' : 'flex-start' }, style]}>
      {!!eyebrow && (
        <Text style={[styles.eyebrow, { color: ink3 }]}>
          {eyebrow}
        </Text>
      )}
      {!!title && (
        <Text
          style={[
            styles.title,
            { color: ink, textAlign: align },
            titleStyle,
          ]}
        >
          {title}
        </Text>
      )}
      {!!subtitle && (
        <Text style={[styles.subtitle, { color: ink2, textAlign: align }]}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 18,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.9,
    lineHeight: 36,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 17,
    fontWeight: '400',
    letterSpacing: -0.2,
    lineHeight: 23,
  },
});

export default LiquidGlassTitle;
