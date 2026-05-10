/**
 * Permission Card
 *
 * Card component for requesting individual permissions
 * with status indicator and action button.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { FontSize, FontWeight } from '@/lib/theme/typography';

export type PermissionStatus = 'not_determined' | 'granted' | 'denied' | 'skipped' | 'loading';

interface PermissionCardProps {
  title: string;
  description: string;
  icon: string;
  status: PermissionStatus;
  onRequest: () => void;
  onSkip?: () => void;
  optional?: boolean;
  comingSoon?: boolean;
  controlStyle?: 'button' | 'toggle';
  footerLinkLabel?: string;
  onFooterLinkPress?: () => void;
}

export function PermissionCard({
  title,
  description,
  icon,
  status,
  onRequest,
  onSkip,
  optional = false,
  comingSoon = false,
  controlStyle = 'button',
  footerLinkLabel,
  onFooterLinkPress,
}: PermissionCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const getStatusColor = () => {
    switch (status) {
      case 'granted':
        return '#34C759'; // iOS green
      case 'denied':
        return '#FF3B30'; // iOS red
      case 'skipped':
        return colors.icon;
      default:
        return colors.icon;
    }
  };

  const getStatusIcon = (): string => {
    switch (status) {
      case 'granted':
        return 'checkmark.circle.fill';
      case 'denied':
        return 'xmark.circle.fill';
      case 'skipped':
        return 'minus.circle';
      default:
        return 'circle';
    }
  };

  const getButtonText = () => {
    if (comingSoon) return 'Coming Soon';
    switch (status) {
      case 'granted':
        return 'Enabled';
      case 'denied':
        return 'Open Settings';
      case 'skipped':
        return 'Skipped';
      case 'loading':
        return 'Requesting...';
      default:
        return 'Enable';
    }
  };

  const isDisabled = status === 'granted' || status === 'loading' || comingSoon;
  const showToggle = controlStyle === 'toggle';
  const toggleValue = status === 'granted';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
          borderColor: status === 'granted' ? '#34C759' : colors.border,
        },
      ]}
    >
      <View style={styles.header}>
        <View
          style={[
            styles.iconContainer,
            {
              backgroundColor:
                status === 'granted'
                  ? 'rgba(52, 199, 89, 0.1)'
                  : colorScheme === 'dark'
                  ? '#2C2C2E'
                  : '#F2F2F7',
            },
          ]}
        >
          <IconSymbol
            name={icon as any}
            size={28}
            color={status === 'granted' ? '#34C759' : StanfordColors.cardinal}
          />
        </View>
        <View style={styles.statusContainer}>
          <IconSymbol
            name={getStatusIcon() as any}
            size={20}
            color={getStatusColor()}
          />
        </View>
      </View>

      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.description, { color: colors.icon }]}>
        {comingSoon ? 'Throne integration coming soon. You can set this up later.' : description}
      </Text>

      <View style={styles.actions}>
        {showToggle ? (
          <View style={styles.toggleRow}>
            <View style={styles.toggleCopy}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>
                {toggleValue ? 'Enabled' : 'Enable'}
              </Text>
              {status === 'denied' && (
                <Text style={[styles.toggleHint, { color: colors.icon }]}>
                  Open Settings if you previously declined
                </Text>
              )}
            </View>
            {status === 'loading' ? (
              <ActivityIndicator color={StanfordColors.cardinal} size="small" />
            ) : (
              <Switch
                value={toggleValue}
                onValueChange={() => {
                  if (!toggleValue) onRequest();
                }}
                disabled={comingSoon || status === 'loading'}
                trackColor={{ false: '#D1D1D6', true: '#8BC48A' }}
                thumbColor={toggleValue ? '#34C759' : '#FFFFFF'}
                ios_backgroundColor="#D1D1D6"
              />
            )}
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.button,
              {
                backgroundColor: isDisabled
                  ? colorScheme === 'dark'
                    ? '#2C2C2E'
                    : '#F2F2F7'
                  : StanfordColors.cardinal,
              },
            ]}
            onPress={onRequest}
            disabled={isDisabled}
          >
            {status === 'loading' ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text
                style={[
                  styles.buttonText,
                  {
                    color: isDisabled
                      ? colors.icon
                      : '#FFFFFF',
                  },
                ]}
              >
                {getButtonText()}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {optional && status === 'not_determined' && onSkip && (
          <TouchableOpacity style={styles.skipButton} onPress={onSkip}>
            <Text style={[styles.skipText, { color: colors.icon }]}>Skip for now</Text>
          </TouchableOpacity>
        )}
      </View>

      {footerLinkLabel && onFooterLinkPress ? (
        <TouchableOpacity
          style={styles.footerLinkButton}
          onPress={onFooterLinkPress}
          activeOpacity={0.7}
        >
          <Text style={styles.footerLinkText}>{footerLinkLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContainer: {
    padding: 4,
  },
  title: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.semibold,
    marginBottom: 4,
  },
  description: {
    fontSize: FontSize.footnote,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  footerLinkButton: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
  },
  footerLinkText: {
    color: StanfordColors.cardinal,
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.medium,
  },
  toggleRow: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleCopy: {
    flex: 1,
    paddingRight: Spacing.sm,
  },
  toggleLabel: {
    fontSize: FontSize.subhead,
    fontWeight: FontWeight.semibold,
  },
  toggleHint: {
    fontSize: FontSize.footnote,
    marginTop: 2,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  buttonText: {
    fontSize: FontSize.subhead,
    fontWeight: FontWeight.semibold,
  },
  skipButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  skipText: {
    fontSize: FontSize.footnote,
  },
});
