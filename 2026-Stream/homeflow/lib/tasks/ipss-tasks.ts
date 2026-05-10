/**
 * IPSS Follow-Up Task Definitions
 *
 * Creates one-time IPSS questionnaire tasks anchored to the patient's surgery date:
 *   - 1 month post-surgery  (day +30)
 *   - 2 months post-surgery (day +60)
 *   - 3 months post-surgery (day +90)
 *
 * Tasks are registered in the local Scheduler and keyed by IPSS_TASK_IDS so
 * we can check existence before re-seeding.
 */

import type { Task } from '@spezivibe/scheduler';

export const IPSS_TASK_IDS = {
  ONE_MONTH:   'ipss-followup-1month',
  TWO_MONTH:   'ipss-followup-2month',
  THREE_MONTH: 'ipss-followup-3month',
  POST_UDS:    'ipss-followup-post-uds',
} as const;

function addDays(surgeryDateStr: string, days: number): Date {
  const d = new Date(surgeryDateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Create a post-UDS IPSS task anchored to the urodynamics date (2 weeks after).
 */
export function createIPSSPostUdsTasks(
  urodynamicsDateStr: string,
): Omit<Task, 'createdAt'>[] {
  return [
    {
      id: IPSS_TASK_IDS.POST_UDS,
      title: 'IPSS Survey — Post-Urodynamics',
      instructions:
        'Please complete the International Prostate Symptom Score (IPSS) questionnaire 2 weeks after your urodynamics study.',
      category: 'questionnaire',
      questionnaireId: 'ipss',
      schedule: {
        startDate: addDays(urodynamicsDateStr, 14),
        recurrence: { type: 'once', date: addDays(urodynamicsDateStr, 14) },
      },
      completionPolicy: { type: 'anytime' },
    },
  ];
}

export function createIPSSFollowUpTasks(
  surgeryDateStr: string,
): Omit<Task, 'createdAt'>[] {
  return [
    {
      id: IPSS_TASK_IDS.ONE_MONTH,
      title: 'IPSS Survey — 1 Month Post-Surgery',
      instructions:
        'Please complete the International Prostate Symptom Score (IPSS) questionnaire to help us track your urinary recovery at the 1-month mark.',
      category: 'questionnaire',
      questionnaireId: 'ipss',
      schedule: {
        startDate: addDays(surgeryDateStr, 30),
        recurrence: { type: 'once', date: addDays(surgeryDateStr, 30) },
      },
      completionPolicy: { type: 'anytime' },
    },
    {
      id: IPSS_TASK_IDS.TWO_MONTH,
      title: 'IPSS Survey — 2 Months Post-Surgery',
      instructions:
        'Please complete the IPSS questionnaire to track your urinary recovery at the 2-month mark.',
      category: 'questionnaire',
      questionnaireId: 'ipss',
      schedule: {
        startDate: addDays(surgeryDateStr, 60),
        recurrence: { type: 'once', date: addDays(surgeryDateStr, 60) },
      },
      completionPolicy: { type: 'anytime' },
    },
    {
      id: IPSS_TASK_IDS.THREE_MONTH,
      title: 'IPSS Survey — 3 Months Post-Surgery',
      instructions:
        'Please complete the IPSS questionnaire to track your urinary recovery at the 3-month mark.',
      category: 'questionnaire',
      questionnaireId: 'ipss',
      schedule: {
        startDate: addDays(surgeryDateStr, 90),
        recurrence: { type: 'once', date: addDays(surgeryDateStr, 90) },
      },
      completionPolicy: { type: 'anytime' },
    },
  ];
}
