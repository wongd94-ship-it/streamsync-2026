/**
 * Continue Button
 *
 * Primary action button for onboarding screens with loading state.
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
  ViewStyle,
} from 'react-native';
import { StanfordColors, Colors } from '@/constants/theme';
import { FontSize, FontWeight } from '@/lib/theme/typography';
import { LGShadowStrong } from '@/lib/theme/liquidGlass';

interface ContinueButtonProps {
  title?: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'text';
  style?: ViewStyle;
}

export function ContinueButton({
  title = 'Continue',
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  style,
}: ContinueButtonProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const isDisabled = disabled || loading;

  const getBackgroundColor = () => {
    if (variant === 'text') return 'transparent';
    if (variant === 'secondary') {
      return colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7';
    }
    if (isDisabled) {
      return colorScheme === 'dark' ? '#2C2C2E' : '#E5E5EA';
    }
    return StanfordColors.cardinal;
  };

  const getTextColor = () => {
    if (variant === 'text') return StanfordColors.cardinal;
    if (variant === 'secondary') return colors.text;
    if (isDisabled) return colors.icon;
    return '#FFFFFF';
  };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        variant === 'text' && styles.textButton,
        variant === 'primary' && !isDisabled && LGShadowStrong,
        { backgroundColor: getBackgroundColor() },
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.86}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? '#FFFFFF' : StanfordColors.cardinal}
          size="small"
        />
      ) : (
        <Text style={[styles.text, { color: getTextColor() }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  textButton: {
    height: 48,
  },
  text: {
    fontSize: 19,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.3,
  },
});
