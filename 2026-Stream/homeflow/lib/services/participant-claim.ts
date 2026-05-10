/**
 * Client helper for the `claimParticipant` Cloud Function.
 *
 * Called after every successful sign-in. If the researcher-created a
 * pending patients/{id} record with the signed-in user's email, this
 * callable flips the record to `active` and writes the users/{uid}
 * mirror. No-op when there is no pending record (returning user path).
 *
 * All errors are swallowed — the claim is a best-effort post-auth
 * convenience, not a gating step. If the network call fails, the user
 * still signs in successfully; the next sign-in will retry the claim.
 */

import { getAuth } from '@/src/services/firestore';

const FUNCTIONS_BASE_URL =
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ||
  'https://us-central1-streamsync-8ae79.cloudfunctions.net';

export interface ClaimParticipantResult {
  claimed: boolean;
  participantId?: string;
  reason?: string;
}

export async function claimParticipantRecord(): Promise<ClaimParticipantResult> {
  try {
    const user = getAuth().currentUser;
    if (!user) {
      return { claimed: false, reason: 'No authenticated user' };
    }
    const token = await user.getIdToken();
    const res = await fetch(`${FUNCTIONS_BASE_URL}/claimParticipant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[claimParticipant] non-2xx', res.status, text);
      return { claimed: false, reason: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as ClaimParticipantResult & { status?: string };
    return {
      claimed: Boolean(json.claimed),
      participantId: json.participantId,
      reason: json.reason,
    };
  } catch (err) {
    console.warn('[claimParticipant] error', err);
    return {
      claimed: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
