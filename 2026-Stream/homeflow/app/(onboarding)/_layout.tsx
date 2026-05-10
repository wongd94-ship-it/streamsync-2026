/**
 * Onboarding Layout
 *
 * Stack navigator for onboarding flow with smooth transitions.
 * Disables back gesture to prevent users from skipping steps.
 */

import React from 'react';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/theme';

export default function OnboardingLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false, // Prevent back gesture
        animation: 'fade_from_bottom',
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          animation: 'none',
        }}
      />
      <Stack.Screen
        name="welcome"
        options={{
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="sign-in"
        options={{
          animation: 'slide_from_right',
          gestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="chat"
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="ineligible"
        options={{
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="consent"
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="account"
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="permissions"
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="medical-history"
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="baseline-survey"
        options={{
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="complete"
        options={{
          animation: 'fade',
        }}
      />
    </Stack>
  );
}
