/**
 * useIPSSTaskSetup
 *
 * Seeds the three post-surgery IPSS follow-up tasks into the local Scheduler
 * exactly once, as soon as:
 *   1. The scheduler is ready
 *   2. A real (non-placeholder) surgery date is available
 *
 * Safe to call on every render — it checks for existing tasks before writing
 * and uses a ref to avoid redundant async calls within the same session.
 */

import { useEffect, useRef } from 'react';
import { useStandard } from '@/lib/services/standard-context';
import { useStudyDates } from '@/hooks/use-study-dates';
import { createIPSSFollowUpTasks, createIPSSPostUdsTasks, IPSS_TASK_IDS } from '@/lib/tasks/ipss-tasks';
import { scheduleIPSSNotifications } from '@/lib/services/notification-service';

export function useIPSSTaskSetup(): void {
  const { scheduler } = useStandard();
  const study = useStudyDates();
  const seededKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scheduler) return;
    if (study.isLoading) return;

    async function seed() {
      const seedKey = `${study.studyPathway ?? 'none'}:${study.surgery.date ?? 'none'}:${study.urodynamics.date ?? 'none'}`;
      if (seededKeyRef.current === seedKey) return;

      if (study.studyPathway === 'surgery' && study.surgery.date) {
        await scheduler.deleteTask(IPSS_TASK_IDS.POST_UDS).catch(() => {});
        if (!scheduler.getTask(IPSS_TASK_IDS.ONE_MONTH)) {
          const tasks = createIPSSFollowUpTasks(study.surgery.date);
          await Promise.all(tasks.map((t) => scheduler.createOrUpdateTask(t)));
        }
        await scheduleIPSSNotifications('surgery', study.surgery.date);
      } else if (study.studyPathway === 'urodynamics' && study.urodynamics.date) {
        await Promise.all([
          scheduler.deleteTask(IPSS_TASK_IDS.ONE_MONTH).catch(() => {}),
          scheduler.deleteTask(IPSS_TASK_IDS.TWO_MONTH).catch(() => {}),
          scheduler.deleteTask(IPSS_TASK_IDS.THREE_MONTH).catch(() => {}),
        ]);
        if (!scheduler.getTask(IPSS_TASK_IDS.POST_UDS)) {
          const tasks = createIPSSPostUdsTasks(study.urodynamics.date);
          await Promise.all(tasks.map((t) => scheduler.createOrUpdateTask(t)));
        }
        await scheduleIPSSNotifications('uds', study.urodynamics.date);
      } else {
        await Promise.all([
          scheduler.deleteTask(IPSS_TASK_IDS.ONE_MONTH).catch(() => {}),
          scheduler.deleteTask(IPSS_TASK_IDS.TWO_MONTH).catch(() => {}),
          scheduler.deleteTask(IPSS_TASK_IDS.THREE_MONTH).catch(() => {}),
          scheduler.deleteTask(IPSS_TASK_IDS.POST_UDS).catch(() => {}),
        ]);
      }

      seededKeyRef.current = seedKey;
    }

    seed().catch((err) => {
      console.error('[IPSS] Failed to seed follow-up tasks:', err);
    });
  }, [scheduler, study.isLoading, study.studyPathway, study.surgery.date, study.urodynamics.date]);
}
