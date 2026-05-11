/**
 * LiquidGlassBottomBar
 *
 * A frosted opaque platter that sits at the bottom of a screen, hosting one
 * or more action buttons. Scrolling content fades into the bar then is fully
 * covered — keeps CTAs readable on top of long scrollers.
 */

import React from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LGColors } from '@/lib/theme/liquidGlass';
import { useAppTheme } from '@/lib/theme/ThemeContext';

interface Props {
  children?: React.ReactNode;
  style?: ViewStyle;
  /** If false the bar floats without the frosted platter (rare). */
  withPlatter?: boolean;
}

export function LiquidGlassBottomBar({
  children,
  style,
  withPlatter = true,
}: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isDark } = theme;

  const overlay = isDark
    ? 'rgba(20,26,30,0.92)'
    : 'rgba(238,234,224,0.92)';

  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: 16 + insets.bottom * 0.5 },
        style,
      ]}
      pointerEvents="box-none"
    >
      {withPlatter && (
        <>
          {Platform.OS !== 'web' && (
            <BlurView
              intensity={70}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          )}
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: overlay }]}
          />
          {/* fade top edge */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -32,
              left: 0,
              right: 0,
              height: 32,
              backgroundColor: isDark
                ? 'rgba(20,26,30,0.45)'
                : 'rgba(238,234,224,0.45)',
              opacity: 0.6,
            }}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              { borderTopWidth: StyleSheet.hairlineWidth, borderColor: LGColors.hair },
            ]}
          />
        </>
      )}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 16,
    paddingHorizontal: 20,
    zIndex: 10,
  },
  content: {
    gap: 12,
  },
});

export default LiquidGlassBottomBar;
