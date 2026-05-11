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
  intensity = 70,
  borderRadius = 24,
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

  // Warmer overlay tuned to the Liquid Glass spec — more white so the
  // surface reads as a frosted platter floating over the colored backdrop.
  const overlayColor = isDark
    ? 'rgba(28, 30, 34, 0.55)'
    : 'rgba(255, 255, 255, 0.62)';

  // Hairline border mimicking the specular edge Apple uses.
  const borderColor = isDark
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(255,255,255,0.85)';

  const shadow: ViewStyle = Platform.select({
    ios: {
      shadowColor: isDark ? '#000' : '#16242C',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: isDark ? 0.32 : 0.08,
      shadowRadius: 22,
    },
    android: { elevation: 7 },
    default: {},
  })!;

  const resolvedStyle: StyleProp<ViewStyle> = [
    {
      borderRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor,
      overflow: 'hidden',
    },
    shadow,
    style,
  ];

  return (
    <View style={resolvedStyle} {...rest}>
      <BlurView
        intensity={intensity}
        tint={effectiveTint}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]}
      />
      {/* Inset top highlight — gives the surface its specular "lift". */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.12)'
            : 'rgba(255,255,255,0.85)',
        }}
      />
      {accent ? (
        <View
          pointerEvents="none"
          style={[
            styles.accentGlow,
            { backgroundColor: accent },
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
