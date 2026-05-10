import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { DEV_FIREBASE_UID } from '@/lib/constants';
import { fetchSurgeryDate, fetchUrodynamicsDate } from '@/src/services/throneFirestore';

type StudyAnchorType = 'surgery' | 'urodynamics';

interface DatedItem {
  date: string | null;
  label: string;
}

interface StudyDatesInfo {
  isLoading: boolean;
  surgery: DatedItem;
  urodynamics: DatedItem;
  studyPathway: StudyAnchorType | null;
  pathwayLabel: string;
  phaseLabel: string;
  phaseDescription: string;
  primaryType: StudyAnchorType | null;
  primaryLabel: string;
  primaryDate: string | null;
  primaryRelativeLabel: string;
  hasPrimaryPassed: boolean;
  timelineStartLabel: string;
  timelineEndLabel: string;
  timelineCaption: string;
  canTransitionToSurgery: boolean;
}

const NOT_SCHEDULED = 'Not scheduled';
const TODAY_LABEL = 'Today';
const studyDatesListeners = new Set<() => void>();

/**
 * Stale-while-revalidate cache for study-dates.
 *
 * Every Profile-tab mount triggers two Firestore reads (surgery date and
 * urodynamics date) plus an AsyncStorage read of the onboarding payload.
 * On Firestore cold-connect that adds ~300-800ms to first paint on the
 * Profile tab. The cache lets us return the last resolved StudyDatesInfo
 * synchronously on re-mount while a background revalidation runs; any
 * changes surface via the existing studyDatesListeners channel.
 *
 * Keyed by uid so multiple accounts on the same device don't pollute each
 * other; evicted on notifyStudyDatesChanged() so edits from the UI take
 * effect immediately on the next read.
 */
const CACHE_TTL_MS = 60_000;
const studyDatesCache = new Map<string, { info: StudyDatesInfo; ts: number }>();

export function notifyStudyDatesChanged(): void {
  // Any edit (e.g. setting a surgery date) invalidates all cached entries so
  // the next read pulls fresh data rather than a stale snapshot.
  studyDatesCache.clear();
  studyDatesListeners.forEach((listener) => listener());
}

function formatDateLabel(dateStr: string | null): string {
  if (!dateStr) return NOT_SCHEDULED;
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function addDays(dateStr: string, days: number): string {
  const next = new Date(`${dateStr}T12:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function daysUntilLabel(dateStr: string | null): string {
  if (!dateStr) return '';
  const today = startOfToday();
  const target = new Date(`${dateStr}T12:00:00`);
  const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'Completed';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `${diff} days away`;
}

export function useStudyDates(): StudyDatesInfo {
  const { user } = useAuth();
  const uid = user?.id ?? (__DEV__ ? DEV_FIREBASE_UID : null);
  const [reloadKey, setReloadKey] = useState(0);

  // Seed from cache if present so the Profile tab can render dated info on
  // first paint instead of showing the skeleton state while Firestore loads.
  const cachedEntry = uid ? studyDatesCache.get(uid) : undefined;
  const cacheIsFresh =
    !!cachedEntry && Date.now() - cachedEntry.ts < CACHE_TTL_MS;

  const [info, setInfo] = useState<StudyDatesInfo>(
    cachedEntry
      ? cachedEntry.info
      : {
          isLoading: true,
          surgery: { date: null, label: NOT_SCHEDULED },
          urodynamics: { date: null, label: NOT_SCHEDULED },
          studyPathway: null,
          pathwayLabel: 'No study pathway selected',
          phaseLabel: 'No active monitoring',
          phaseDescription: 'Add a study date to start your monitoring timeline.',
          primaryType: null,
          primaryLabel: 'No study date scheduled',
          primaryDate: null,
          primaryRelativeLabel: '',
          hasPrimaryPassed: false,
          timelineStartLabel: TODAY_LABEL,
          timelineEndLabel: NOT_SCHEDULED,
          timelineCaption: 'Your study timeline will appear here once a pathway is selected.',
          canTransitionToSurgery: false,
        },
  );

  useEffect(() => {
    const listener = () => setReloadKey((value) => value + 1);
    studyDatesListeners.add(listener);
    return () => {
      studyDatesListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    // If a fresh cached entry hydrated state on mount AND the caller didn't
    // explicitly ask for a reload (reloadKey === 0), skip the network hop —
    // the user will see the cached info and the next mount-with-reload-key
    // still fetches.
    if (cacheIsFresh && reloadKey === 0) {
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      try {
        let surgeryDate: string | null = null;
        let urodynamicsDate: string | null = null;

        if (uid) {
          const [firestoreSurgeryDate, firestoreUdsDate] = await Promise.all([
            fetchSurgeryDate(uid),
            fetchUrodynamicsDate(uid),
          ]);
          surgeryDate = firestoreSurgeryDate;
          urodynamicsDate = firestoreUdsDate;
        }

        const onboardingData = await OnboardingService.getData();
        surgeryDate = surgeryDate ?? onboardingData.eligibility?.surgeryDate ?? null;
        urodynamicsDate = urodynamicsDate ?? onboardingData.eligibility?.urodynamicsDate ?? null;

        const initialPathway =
          onboardingData.eligibility?.studyPathway === 'surgery'
            ? 'surgery'
            : onboardingData.eligibility?.studyPathway === 'uds'
            ? 'urodynamics'
            : onboardingData.eligibility?.anchorDateType === 'surgery'
            ? 'surgery'
            : onboardingData.eligibility?.anchorDateType === 'uds'
            ? 'urodynamics'
            : null;

        const activePathway: StudyAnchorType | null = surgeryDate
          ? 'surgery'
          : urodynamicsDate
          ? 'urodynamics'
          : initialPathway;

        const todayMs = startOfToday().getTime();

        let nextInfo: StudyDatesInfo = {
          isLoading: false,
          surgery: { date: surgeryDate, label: formatDateLabel(surgeryDate) },
          urodynamics: { date: urodynamicsDate, label: formatDateLabel(urodynamicsDate) },
          studyPathway: activePathway,
          pathwayLabel:
            activePathway === 'surgery'
              ? 'BPH Surgery Pathway'
              : activePathway === 'urodynamics'
              ? 'Urodynamic Testing Pathway'
              : 'No study pathway selected',
          phaseLabel: 'No active monitoring',
          phaseDescription: 'Add a study date to start your monitoring timeline.',
          primaryType: activePathway,
          primaryLabel: 'No study date scheduled',
          primaryDate: null,
          primaryRelativeLabel: '',
          hasPrimaryPassed: false,
          timelineStartLabel: TODAY_LABEL,
          timelineEndLabel: NOT_SCHEDULED,
          timelineCaption: 'Your study timeline will appear here once a pathway is selected.',
          canTransitionToSurgery: false,
        };

        if (activePathway === 'surgery' && surgeryDate) {
          const surgeryMs = new Date(`${surgeryDate}T12:00:00`).getTime();
          const monitoringEnd = addDays(surgeryDate, 84);
          const monitoringEndMs = new Date(`${monitoringEnd}T12:00:00`).getTime();

          nextInfo = {
            ...nextInfo,
            primaryType: 'surgery',
            primaryLabel: 'BPH Surgery',
            hasPrimaryPassed: surgeryMs < todayMs,
            timelineEndLabel: formatDateLabel(monitoringEnd),
            timelineCaption: '12 weeks of post-surgery monitoring with IPSS questionnaires at 1, 2, and 3 months.',
          };

          if (todayMs < surgeryMs) {
            nextInfo.phaseLabel = 'Pre-Surgery Monitoring';
            nextInfo.phaseDescription = 'Monitoring continues until your scheduled BPH surgery date.';
            nextInfo.primaryDate = surgeryDate;
            nextInfo.primaryRelativeLabel = daysUntilLabel(surgeryDate);
          } else if (todayMs <= monitoringEndMs) {
            nextInfo.phaseLabel = 'Post-Surgery Monitoring';
            nextInfo.phaseDescription = 'You are in the 12-week follow-up period after BPH surgery.';
            nextInfo.timelineStartLabel = formatDateLabel(surgeryDate);
            nextInfo.primaryDate = monitoringEnd;
            nextInfo.primaryRelativeLabel = daysUntilLabel(monitoringEnd);
          } else {
            nextInfo.phaseLabel = 'Post-Surgery Monitoring Complete';
            nextInfo.phaseDescription = 'Your 12-week BPH surgery monitoring window has ended.';
            nextInfo.timelineStartLabel = formatDateLabel(surgeryDate);
            nextInfo.primaryDate = monitoringEnd;
            nextInfo.primaryRelativeLabel = 'Completed';
          }
        } else if (activePathway === 'urodynamics' && urodynamicsDate) {
          const udsMs = new Date(`${urodynamicsDate}T12:00:00`).getTime();
          const postMonitoringEnd = addDays(urodynamicsDate, 14);
          const postMonitoringEndMs = new Date(`${postMonitoringEnd}T12:00:00`).getTime();

          nextInfo = {
            ...nextInfo,
            primaryType: 'urodynamics',
            primaryLabel: 'Urodynamic Testing',
            hasPrimaryPassed: udsMs < todayMs,
            timelineEndLabel: formatDateLabel(postMonitoringEnd),
            timelineCaption: '2 weeks of post-urodynamics monitoring with an IPSS questionnaire at the end of the observation period.',
            canTransitionToSurgery: true,
          };

          if (todayMs < udsMs) {
            nextInfo.phaseLabel = 'Pre-Urodynamics Monitoring';
            nextInfo.phaseDescription = 'Monitoring continues until your scheduled urodynamic study.';
            nextInfo.primaryDate = urodynamicsDate;
            nextInfo.primaryRelativeLabel = daysUntilLabel(urodynamicsDate);
          } else if (todayMs <= postMonitoringEndMs) {
            nextInfo.phaseLabel = 'Post-Urodynamics Monitoring';
            nextInfo.phaseDescription = 'You are in the 2-week observation period after urodynamic testing.';
            nextInfo.timelineStartLabel = formatDateLabel(urodynamicsDate);
            nextInfo.primaryDate = postMonitoringEnd;
            nextInfo.primaryRelativeLabel = daysUntilLabel(postMonitoringEnd);
          } else {
            nextInfo.phaseLabel = 'Urodynamics Monitoring Complete';
            nextInfo.phaseDescription = 'Your post-urodynamics observation window has ended.';
            nextInfo.timelineStartLabel = formatDateLabel(urodynamicsDate);
            nextInfo.primaryDate = postMonitoringEnd;
            nextInfo.primaryRelativeLabel = 'Completed';
          }
        }

        if (!cancelled) {
          setInfo(nextInfo);
          if (uid) {
            studyDatesCache.set(uid, { info: nextInfo, ts: Date.now() });
          }
        }
      } catch {
        if (!cancelled) {
          setInfo((prev) => ({ ...prev, isLoading: false }));
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [uid, reloadKey, cacheIsFresh]);

  return info;
}
