/**
 * LiquidGlassCard
 *
 * A translucent, blurred-background surface that matches iOS 26's
 * "Liquid Glass" material. Renders an expo-blur `BlurView` underneath a
 * subtly-tinted overlay with a hairline specular border and soft shadow.
 *
 * Usage:
 *   <LiquidGlassCard style={styles.card}>…</LiquidGlassCard>
 *
 * Props forward all View props, plus:
 *   tint         — 'light' | 'dark' | 'default' (auto-picks from theme if omitted)
 *   intensity    — 0..100 blur strength (default 60)
 *   borderRadius — rounded corner radius (default 20)
 */

import React from 'react';
import {
  StyleProp,
  StyleSheet,
  View,
  ViewProps,
  ViewStyle,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useAppTheme } from '@/lib/theme/ThemeContext';

export interface LiquidGlassCardProps extends ViewProps {
  tint?: 'light' | 'dark' | 'default';
  intensity?: number;
  borderRadius?: number;
  /** Optional accent colour for a subtle inner glow along the top edge. */
  accent?: string;
}

export function LiquidGlassCard({
  children,
  style,
  tint,
  intensity = 60,
  borderRadius = 20,
  accent,
  ...rest
}: LiquidGlassCardProps) {
  const { theme } = useAppTheme();
  const { isDark } = theme;

  // Pick a sensible default tint based on theme. On iOS we prefer `light`
  // in light mode and `dark` in dark mode — matches how Apple's built-in
  // Liquid Glass surfaces auto-invert.
  const effectiveTint: 'light' | 'dark' | 'default' =
    tint ?? (isDark ? 'dark' : 'light');

  // Subtle overlay on top of the blur so the card has some tonal separation
  // from whatever is behind it. In dark mode we lift the surface slightly;
  // in light mode we cool the tint so it doesn't wash into the background.
  const overlayColor = isDark
    ? 'rgba(28, 28, 30, 0.42)'
    : 'rgba(255, 255, 255, 0.55)';

  // Hairline border mimicking the specular edge Apple uses.
  const borderColor = isDark
    ? 'rgba(255,255,255,0.10)'
    : 'rgba(255,255,255,0.75)';

  const shadow: ViewStyle = Platform.select({
    ios: {
      shadowColor: isDark ? '#000' : '#0F172A',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: isDark ? 0.32 : 0.12,
      shadowRadius: 18,
    },
    android: { elevation: 6 },
    default: {},
  })!;

  const resolvedStyle: StyleProp<ViewStyle> = [
    { borderRadius, borderWidth: StyleSheet.hairlineWidth, borderColor },
    shadow,
    style,
  ];

  return (
    <View style={resolvedStyle} {...rest}>
      <BlurView
        intensity={intensity}
        tint={effectiveTint}
        style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: overlayColor, borderRadius },
        ]}
      />
      {accent ? (
        <View
          pointerEvents="none"
          style={[
            styles.accentGlow,
            { backgroundColor: accent, borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius },
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  accentGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    opacity: 0.35,
  },
});
