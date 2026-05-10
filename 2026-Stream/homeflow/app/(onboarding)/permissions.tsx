/**
 * Permissions Screen
 *
 * Requests HealthKit, Clinical Records (Apple Health),
 * and Notifications. HealthKit and Notifications are required.
 * Throne setup happens post-onboarding (device ships separately).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { useRouter, Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, StanfordColors, Spacing } from '@/constants/theme';
import { OnboardingStep } from '@/lib/constants';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { ThroneService } from '@/lib/services/throne-service';
import {
  areClinicalRecordsAvailable,
  requestClinicalPermissions,
  requestHealthPermissions,
} from '@/lib/services/healthkit';
import { syncFhirPrefill } from '@/src/services/fhirPrefillSync';
import { syncClinicalNotes } from '@/src/services/clinicalNotesSync';
import {
  requestNotificationPermissions,
  getNotificationPermissionStatus,
} from '@/lib/services/notification-service';
import {
  OnboardingProgressBar,
  PermissionCard,
  ContinueButton,
  PermissionStatus,
} from '@/components/onboarding';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function PermissionsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [healthKitStatus, setHealthKitStatus] = useState<PermissionStatus>('not_determined');
  const [clinicalStatus, setClinicalStatus] = useState<PermissionStatus>('not_determined');
  const [throneStatus, setThroneStatus] = useState<PermissionStatus>('not_determined');
  const [notificationsStatus, setNotificationsStatus] = useState<PermissionStatus>('not_determined');
  const [isLoading, setIsLoading] = useState(false);

  // HealthKit and Notifications are required (on iOS)
  const healthKitOk = healthKitStatus === 'granted' || Platform.OS !== 'ios';
  const notificationsOk = notificationsStatus === 'granted' || Platform.OS !== 'ios';
  const canContinue = healthKitOk && notificationsOk;

  useEffect(() => {
    let cancelled = false;
    async function checkStatus() {
      const thronePermission = await ThroneService.getPermissionStatus();
      if (!cancelled) setThroneStatus(thronePermission);

      const notifStatus = await getNotificationPermissionStatus();
      if (!cancelled) setNotificationsStatus(notifStatus);

      const onboardingData = await OnboardingService.getData();
      if (!cancelled && onboardingData.permissions?.clinicalRecords) {
        setClinicalStatus(onboardingData.permissions.clinicalRecords);
      }
    }
    checkStatus();
    return () => { cancelled = true; };
  }, []);

  const handleHealthKitRequest = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert(
        'HealthKit Not Available',
        'HealthKit is only available on iOS devices. For demo purposes, you can continue.',
        [{ text: 'OK' }]
      );
      setHealthKitStatus('granted');
      return;
    }

    setHealthKitStatus('loading');

    try {
      const result = await requestHealthPermissions();
      setHealthKitStatus(result.success ? 'granted' : 'denied');

      if (!result.success) {
        Alert.alert(
          'Permission Required',
          'HealthKit access is required for the study. Please enable it in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else if (result.success && result.dataVerified === false) {
        // Authorization was requested (or was already decided by iOS) but the
        // test query returned no data.  This most likely means the permission
        // dialog was previously shown and dismissed/denied — iOS won't show it
        // again.  Guide the user to Settings to re-enable access.
        Alert.alert(
          'Check Health Permissions',
          'Apple Health was enabled, but no health data was returned. This can happen if the permission dialog was dismissed in a previous session.\n\nTo fix this: go to Settings → Health → Data Access & Devices → StreamSync and turn on all categories.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      }
    } catch {
      setHealthKitStatus('denied');
      Alert.alert('Error', 'Failed to request HealthKit permissions. Please try again.');
    }
  }, []);

  const handleClinicalRecordsRequest = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      setClinicalStatus('skipped');
      return;
    }

    if (!areClinicalRecordsAvailable()) {
      setClinicalStatus('denied');
      Alert.alert(
        'Clinical Records Not Available',
        'Clinical records are not available on this device or Apple Health account.',
        [{ text: 'OK' }],
      );
      return;
    }

    setClinicalStatus('loading');

    try {
      const result = await requestClinicalPermissions();
      setClinicalStatus(result.success ? 'granted' : 'denied');

      if (result.success) {
        // Kick off sync immediately so the medical-history screen can read
        // fresh HealthKit clinical records from Firestore. Fire-and-forget —
        // we don't want to block the permissions UI on the sync.
        syncFhirPrefill().catch((err) =>
          console.warn('[Permissions] post-auth FHIR prefill sync error:', err),
        );
        syncClinicalNotes().catch((err) =>
          console.warn('[Permissions] post-auth clinical notes sync error:', err),
        );
      } else {
        Alert.alert(
          'Clinical Records Access',
          'Clinical records access was not granted. You can enable it later in Settings or continue without it.',
          [
            { text: 'Continue', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
    } catch {
      setClinicalStatus('denied');
      Alert.alert('Error', 'Failed to request clinical records permissions. Please try again.');
    }
  }, []);

  const handleClinicalRecordsSkip = useCallback(() => {
    setClinicalStatus('skipped');
  }, []);

  // Throne setup moved post-onboarding — device ships separately via mail
  // and is linked to the user automatically by matching email. See
  // app/throne-setup-guide.tsx for the post-arrival in-app setup flow.

  const handleNotificationsRequest = useCallback(async () => {
    try {
      const granted = await requestNotificationPermissions();
      setNotificationsStatus(granted ? 'granted' : 'denied');
      if (!granted) {
        Alert.alert(
          'Notifications Disabled',
          'Notifications are required so we can remind you about surveys and Throne setup. You can enable them in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to request notification permissions. Please try again.');
    }
  }, []);

  const handleContinue = async () => {
    setIsLoading(true);
    try {
      await OnboardingService.updateData({
        permissions: {
          healthKit: healthKitStatus as 'granted' | 'denied' | 'not_determined',
          clinicalRecords: clinicalStatus as 'granted' | 'denied' | 'not_determined' | 'skipped',
          throne: throneStatus as 'granted' | 'denied' | 'not_determined' | 'skipped',
          smartProvider: 'skipped',
          notifications: notificationsStatus as 'granted' | 'denied' | 'not_determined',
        },
      });
      await OnboardingService.goToStep(OnboardingStep.MEDICAL_HISTORY);
      router.push('/(onboarding)/medical-history' as Href);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <OnboardingProgressBar currentStep={OnboardingStep.PERMISSIONS} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.titleContainer}>
          <IconSymbol name={'lock.shield.fill' as any} size={32} color={StanfordColors.cardinal} />
          <Text style={[styles.title, { color: colors.text }]}>
            App Permissions
          </Text>
        </View>

        <Text style={[styles.description, { color: colors.icon }]}>
          StreamSync needs access to your health data to track your activity, sleep, and symptoms.
          Apple Health Clinical Records can also import medications, procedures, conditions, and notes when they are available on your device.
          Your data is encrypted and only used for research purposes.
        </Text>

        <PermissionCard
          title="Apple Health"
          description="Access step count, heart rate, sleep data, and activity levels from your iPhone and Apple Watch."
          icon="heart.fill"
          status={healthKitStatus}
          onRequest={handleHealthKitRequest}
        />

        <PermissionCard
          title="Notifications"
          description="Receive reminders for follow-up surveys, Throne setup, and when data stops syncing. Required so we can reach you during the study."
          icon="bell.fill"
          status={notificationsStatus}
          onRequest={handleNotificationsRequest}
          controlStyle="toggle"
        />

        {Platform.OS === 'ios' && (
          <PermissionCard
            title="Apple Health Clinical Records"
            description="Import medications, lab results, conditions, procedures, and clinical notes from Apple Health if they are available on your device."
            icon="cross.case.fill"
            status={clinicalStatus}
            onRequest={handleClinicalRecordsRequest}
            onSkip={handleClinicalRecordsSkip}
            optional
            footerLinkLabel="View Privacy Policy"
            onFooterLinkPress={() => router.push('/privacy-policy' as Href)}
          />
        )}

        <View
          style={[
            styles.infoBox,
            { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7' },
          ]}
        >
          <IconSymbol name="lock.shield.fill" size={20} color={colors.icon} />
          <Text style={[styles.infoText, { color: colors.icon }]}>
            You can change these permissions at any time in your device Settings.
            Your data is never sold or shared with third parties.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {!canContinue && (
          <Text style={[styles.footerHint, { color: colors.icon }]}>
            {!healthKitOk && !notificationsOk
              ? 'Apple Health and Notifications access are required to continue'
              : !healthKitOk
              ? 'Apple Health access is required to continue'
              : 'Notifications access is required to continue'}
          </Text>
        )}
        <ContinueButton
          title="Continue"
          onPress={handleContinue}
          disabled={!canContinue}
          loading={isLoading}
        />
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: Spacing.sm },
  scrollView: { flex: 1 },
  scrollContent: { padding: Spacing.screenHorizontal },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  title: { fontSize: 28, fontWeight: '700' },
  description: {
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 12,
    padding: Spacing.md,
    gap: 12,
    marginTop: Spacing.sm,
  },
  infoText: { fontSize: 14, lineHeight: 20, flex: 1 },
  footer: {
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  footerHint: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 20,
  },
  iconRow: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: 'rgba(140,21,21,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 16,
  },
  confirmButton: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 10,
  },
  cancelText: {
    fontSize: 15,
  },
  systemButton: {
    width: '100%',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  systemTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  systemSubtitle: {
    marginTop: 4,
    fontSize: 13,
  },
});
