import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { SupportChatBubble } from '@/components/support-chat/SupportChatBubble';
import { LGColors } from '@/lib/theme/liquidGlass';

function LiquidGlassTabBarBackground() {
  const { theme } = useAppTheme();
  const { isDark } = theme;
  // Liquid Glass dock — frosted platter with warmer overlay + hairline
  // specular edge so it reads as floating over the colored backdrop.
  const overlay = isDark
    ? 'rgba(22,28,32,0.62)'
    : 'rgba(255,255,255,0.68)';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <BlurView
        intensity={90}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: overlay }]} />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: StyleSheet.hairlineWidth * 2,
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.10)'
            : 'rgba(255,255,255,0.85)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: LGColors.hair,
        }}
      />
    </View>
  );
}

export default function TabLayout() {
  const { theme } = useAppTheme();
  const { isDark, colors } = theme;

  const activeTint = colors.accent;
  const inactiveTint = isDark ? '#8E8E93' : '#6B6B70';

  return (
    <View style={styles.fill}>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: inactiveTint,
        headerShown: false,
        tabBarButton: HapticTab,
        // Transparent tab bar + liquid-glass background component. Setting
        // `position: absolute` on iOS lets the blur sit over screen content
        // like Apple's native tab bars do.
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          ...Platform.select({
            ios: { position: 'absolute' },
            default: {},
          }),
        },
        tabBarBackground: () => <LiquidGlassTabBarBackground />,
        tabBarLabelStyle: {
          fontWeight: '600',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="voiding"
        options={{
          title: 'Voiding',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="drop.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="health"
        options={{
          title: 'Health',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="heart.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="person.fill" color={color} />,
        }}
      />

      {/* Hide old tabs that still have files — prevents expo-router from auto-adding them */}
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="contacts" options={{ href: null }} />
      <Tabs.Screen name="schedule" options={{ href: null }} />
    </Tabs>
    {/* Floating AI Support bubble — overlays every tab. Positioned by the
        component itself so it sits just above the liquid-glass tab bar. */}
    <SupportChatBubble />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
