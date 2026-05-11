/**
 * Floating Support-Chat Bubble
 *
 * A FAB-style "💬" button rendered above every authenticated tab. Tap → opens
 * the AI Support chat (resuming any existing open thread, e.g. one started by
 * a researcher from the dashboard). A red badge shows when there are
 * researcher messages newer than the last time the user opened the chat.
 *
 * Mounted once at the (tabs) layout level so it persists across tab switches
 * and never needs to be re-attached on each screen.
 */

import React, { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import {
  subscribeToActiveChat,
  type ActiveChatStatus,
} from '@/lib/services/support-chat-service';
import { useAuth } from '@/hooks/use-auth';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { LGColors } from '@/lib/theme/liquidGlass';

// Sea-teal Liquid Glass bubble — sparkle icon, layered specular highlight.
const SEA = LGColors.sea;
const TEAL = LGColors.teal;

interface Props {
  /**
   * Optional override — if false, the bubble is hidden. Useful for the chat
   * screen itself (the bubble shouldn't appear over its own destination).
   */
  visible?: boolean;
  /**
   * Optional vertical offset applied above the safe-area / tab-bar inset.
   * Defaults to 12, which puts the bubble just above the tab bar.
   */
  bottomOffset?: number;
}

export function SupportChatBubble({ visible = true, bottomOffset = 12 }: Props) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const tabBarHeight = useTabBarHeightSafe();
  const [status, setStatus] = useState<ActiveChatStatus>({
    chatId: null,
    triggerReason: null,
    lastActivity: null,
    unreadResearcherMessages: 0,
  });

  // Pulse animation when an unread message lands. Subtle — once per change.
  const pulseScale = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = subscribeToActiveChat(setStatus);
    return unsub;
  }, [isAuthenticated]);

  useEffect(() => {
    if (status.unreadResearcherMessages > 0) {
      Animated.sequence([
        Animated.timing(pulseScale, {
          toValue: 1.08,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseScale, {
          toValue: 1,
          duration: 220,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [status.unreadResearcherMessages, pulseScale]);

  if (!visible || !isAuthenticated) return null;

  const handlePress = () => {
    router.push({
      pathname: '/support-chat',
      params: { trigger: 'participant-initiated' },
    } as unknown as Href);
  };

  const showBadge = status.unreadResearcherMessages > 0;

  const containerStyle: ViewStyle = {
    position: 'absolute',
    right: 16,
    bottom: tabBarHeight + bottomOffset,
  };

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer]}>
      <Animated.View
        style={[
          containerStyle,
          {
            transform: [{ scale: pulseScale }],
          },
        ]}
      >
        <TouchableOpacity
          onPress={handlePress}
          activeOpacity={0.86}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={
            showBadge
              ? `StreamSync Support — ${status.unreadResearcherMessages} new message${status.unreadResearcherMessages === 1 ? '' : 's'}`
              : 'StreamSync Support'
          }
        >
          {/* Layered gradient — teal corner over sea base for the design's
              sea→teal diagonal wash, plus a top specular highlight. */}
          <View style={[StyleSheet.absoluteFillObject, styles.tealCorner]} />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: 'rgba(255,255,255,0.32)',
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
            }}
          />
          <IconSymbol name="sparkles" size={26} color="#FFFFFF" />
          {showBadge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {status.unreadResearcherMessages > 9 ? '9+' : String(status.unreadResearcherMessages)}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

/**
 * `useBottomTabBarHeight` only works inside a `<Tabs>` navigator; on screens
 * that aren't part of one (modals, root) it throws. Wrap it so we can mount
 * the bubble anywhere safely.
 */
function useTabBarHeightSafe(): number {
  try {
    return useBottomTabBarHeight();
  } catch {
    return Platform.OS === 'ios' ? 96 : 56;
  }
}

const styles = StyleSheet.create({
  layer: {
    // Above standard content but doesn't block touches outside the button itself.
    elevation: 12,
    zIndex: 12,
  },
  button: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: SEA,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: SEA,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.36,
    shadowRadius: 14,
    elevation: 10,
  },
  tealCorner: {
    backgroundColor: TEAL,
    opacity: 0.55,
    top: -20,
    right: -20,
    bottom: undefined,
    left: undefined,
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
});

export default SupportChatBubble;
