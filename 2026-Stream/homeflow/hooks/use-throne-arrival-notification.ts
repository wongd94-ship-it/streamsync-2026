/**
 * useThroneArrivalNotification
 *
 * Schedules local notifications for Throne device arrival (~5 days)
 * and setup reminder (~7 days) after enrollment.
 *
 * Uses the consent date as a proxy for enrollment date since consent
 * is recorded during the in-clinic onboarding visit.
 *
 * Safe to call on every render — uses a module-level Set to run once
 * per uid per app session.
 */

import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/lib/constants';
import { scheduleThroneArrivalNotification } from '@/lib/services/notification-service';
import { useAuth } from '@/hooks/use-auth';

const _scheduledUids = new Set<string>();

export function useThroneArrivalNotification(): void {
  const { user } = useAuth();

  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    if (_scheduledUids.has(uid)) return;

    _scheduledUids.add(uid);

    async function schedule() {
      const consentDate = await AsyncStorage.getItem(STORAGE_KEYS.CONSENT_DATE);
      if (!consentDate) return;

      const enrolledAt = new Date(consentDate);
      if (isNaN(enrolledAt.getTime())) return;

      await scheduleThroneArrivalNotification(enrolledAt);
    }

    schedule().catch((err) => {
      console.warn('[ThroneNotification] Failed to schedule:', err);
      _scheduledUids.delete(uid!);
    });
  }, [user?.id]);
}
