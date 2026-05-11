/**
 * LiquidGlassButton
 *
 * The primary 68pt-tall Liquid Glass CTA. Three variants:
 *   - primary  : solid sea color, white text, drop shadow
 *   - glass    : frosted glass platter, ink text
 *   - ghost    : transparent, sea text (used for "Learn more" / "Not now")
 *
 * Designed for elderly readability — minimum 64pt tap target, 21pt font.
 */

import React from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LGColors, LGShadowStrong } from '@/lib/theme/liquidGlass';
import { useAppTheme } from '@/lib/theme/ThemeContext';

interface Props {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'glass' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading icon (RN element). */
  icon?: React.ReactNode;
  style?: ViewStyle;
  /** Stretch to full width (default true). */
  full?: boolean;
  accessibilityLabel?: string;
}

export function LiquidGlassButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  style,
  full = true,
  accessibilityLabel,
}: Props) {
  const { theme } = useAppTheme();
  const { isDark } = theme;
  const isInteractive = !!onPress && !disabled && !loading;

  if (variant === 'primary') {
    return (
      <TouchableOpacity
        onPress={isInteractive ? onPress : undefined}
        activeOpacity={0.86}
        disabled={!isInteractive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        style={[
          baseStyles.button,
          full && baseStyles.full,
          {
            backgroundColor: disabled ? '#9AB0B7' : LGColors.sea,
          },
          !disabled && LGShadowStrong,
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={baseStyles.row}>
            {icon}
            <Text style={[baseStyles.text, { color: '#fff' }]}>{title}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  if (variant === 'glass') {
    const tint = isDark ? 'dark' : 'light';
    return (
      <TouchableOpacity
        onPress={isInteractive ? onPress : undefined}
        activeOpacity={0.86}
        disabled={!isInteractive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        style={[
          baseStyles.button,
          full && baseStyles.full,
          baseStyles.glassBorder,
          { backgroundColor: 'transparent', overflow: 'hidden' },
          style,
        ]}
      >
        {Platform.OS !== 'web' && (
          <BlurView
            intensity={60}
            tint={tint}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.10)'
                : 'rgba(255,255,255,0.65)',
            },
          ]}
        />
        {loading ? (
          <ActivityIndicator color={isDark ? '#fff' : LGColors.sea} />
        ) : (
          <View style={baseStyles.row}>
            {icon}
            <Text
              style={[
                baseStyles.text,
                { color: isDark ? LGColors.darkInk : LGColors.ink },
              ]}
            >
              {title}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  // ghost
  return (
    <TouchableOpacity
      onPress={isInteractive ? onPress : undefined}
      activeOpacity={0.7}
      disabled={!isInteractive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={[
        baseStyles.button,
        full && baseStyles.full,
        { backgroundColor: 'transparent' },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={LGColors.sea} />
      ) : (
        <View style={baseStyles.row}>
          {icon}
          <Text style={[baseStyles.text, { color: LGColors.sea }]}>
            {title}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const baseStyles = StyleSheet.create({
  button: {
    height: 64,
    borderRadius: 32,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: { alignSelf: 'stretch' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  text: {
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  glassBorder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(22,36,44,0.10)',
  },
});

export default LiquidGlassButton;
