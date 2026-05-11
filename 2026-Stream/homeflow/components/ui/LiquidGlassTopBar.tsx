/**
 * LiquidGlassTopBar
 *
 * A floating back-chevron pill + optional title + trailing slot. Sits at the
 * top of every Liquid Glass screen — no big nav bar, just a glass "puck".
 */

import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { LGColors } from '@/lib/theme/liquidGlass';
import { useAppTheme } from '@/lib/theme/ThemeContext';

interface Props {
  label?: string;
  trailing?: React.ReactNode;
  onBack?: () => void;
  /** Hide the back button (e.g. on the welcome / root screen). */
  hideBack?: boolean;
  style?: ViewStyle;
}

export function LiquidGlassTopBar({
  label,
  trailing,
  onBack,
  hideBack,
  style,
}: Props) {
  const { theme } = useAppTheme();
  const { isDark } = theme;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const ink = isDark ? LGColors.darkInk : LGColors.ink;
  const overlay = isDark
    ? 'rgba(20,26,30,0.55)'
    : 'rgba(255,255,255,0.65)';

  const goBack = () => {
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
  };

  return (
    <View
      style={[
        styles.bar,
        { paddingTop: insets.top + 6 },
        style,
      ]}
    >
      <View style={styles.row}>
        {hideBack ? (
          <View style={styles.slot} />
        ) : (
          <Pressable
            onPress={goBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [
              styles.puck,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            {Platform.OS !== 'web' && (
              <BlurView
                intensity={60}
                tint={isDark ? 'dark' : 'light'}
                style={[StyleSheet.absoluteFill, { borderRadius: 24 }]}
              />
            )}
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: overlay,
                  borderRadius: 24,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: isDark
                    ? 'rgba(255,255,255,0.08)'
                    : 'rgba(255,255,255,0.85)',
                },
              ]}
            />
            <IconSymbol name="chevron.left" size={20} color={ink} />
          </Pressable>
        )}

        {label ? (
          <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
            {label}
          </Text>
        ) : (
          <View />
        )}

        <View style={[styles.slot, styles.trailingSlot]}>{trailing}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    zIndex: 5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  puck: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slot: { minWidth: 48 },
  trailingSlot: { alignItems: 'flex-end' },
  label: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
});

export default LiquidGlassTopBar;
