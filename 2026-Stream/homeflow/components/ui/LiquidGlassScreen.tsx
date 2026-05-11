/**
 * LiquidGlassScreen
 *
 * Drop-in screen wrapper that paints the Liquid Glass backdrop, sets the
 * status bar to dark, and provides a `position: 'relative'` container so
 * absolute-positioned bottom bars / FABs land in the right spot.
 *
 * The wrapper does NOT add safe-area padding by default — the children
 * decide which edges to respect via their own components (TopBar, BottomBar).
 */

import React from 'react';
import {
  Platform,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LiquidGlassBackdrop } from './LiquidGlassBackdrop';
import { useAppTheme } from '@/lib/theme/ThemeContext';

type Variant = 'default' | 'welcome' | 'home' | 'survey' | 'chat' | 'alert';

interface Props {
  children?: React.ReactNode;
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
}

export function LiquidGlassScreen({
  children,
  variant = 'default',
  style,
}: Props) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.root, style]}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <LiquidGlassBackdrop variant={variant} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: 'relative',
    // Ensure children that use overflow can still clip cleanly without
    // affecting the backdrop, which is drawn under everything.
    backgroundColor: Platform.OS === 'web' ? '#E9E5DD' : 'transparent',
  },
});

export default LiquidGlassScreen;
