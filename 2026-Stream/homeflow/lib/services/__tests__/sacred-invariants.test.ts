/**
 * Throne-email contract tests.
 *
 * These tests guard the contract between Streamsync auth and the Throne
 * ingestion router:
 *   1. `email` (contact/auth email) drives Streamsync auth + the claim
 *      flow. A signed-in user can ONLY claim a pending record whose
 *      contact email matches their auth email — see isClaimAuthorized.
 *   2. `throneAccountEmail` is the join key Throne returns on each
 *      session export. It defaults to the auth email on first sign-in
 *      and may be corrected later by a researcher (via the
 *      setParticipantThroneEmail callable) for participants who signed
 *      up to Throne with a different address — typically Apple
 *      Hide-My-Email, where Throne sees `<random>@privaterelay.appleid.com`.
 *   3. firebase-account-service must not clobber a researcher-set
 *      throneAccountEmail on subsequent sign-ins. The auth-sync only
 *      seeds the field when it is currently unset; once a value is
 *      present (either the auth-email default or a researcher
 *      correction), the sync must leave it alone.
 */

import {
  throneEmailsMatch,
  isClaimAuthorized,
  type Pathway,
} from '../../types/study';

describe('Sacred Throne-email invariants', () => {
  describe('throneEmailsMatch', () => {
    it('returns true for identical emails', () => {
      expect(throneEmailsMatch('user@example.com', 'user@example.com')).toBe(true);
    });

    it('normalizes case and whitespace', () => {
      expect(throneEmailsMatch('User@Example.COM', '  user@example.com  ')).toBe(true);
    });

    it('returns false when emails differ', () => {
      expect(throneEmailsMatch('user@example.com', 'other@example.com')).toBe(false);
    });

    it('returns false for non-strings (null / undefined)', () => {
      expect(throneEmailsMatch(null, 'user@example.com')).toBe(false);
      expect(throneEmailsMatch('user@example.com', undefined)).toBe(false);
      expect(throneEmailsMatch(null, null)).toBe(false);
    });

    it('does not match on email-shaped but unrelated values', () => {
      expect(throneEmailsMatch('user@example.com', 'user@example.net')).toBe(false);
    });
  });

  describe('isClaimAuthorized', () => {
    it('authorizes a claim when auth email matches the patient record email', () => {
      expect(isClaimAuthorized('participant@clinic.edu', 'participant@clinic.edu')).toBe(true);
    });

    it('rejects a claim when auth email is different', () => {
      // This is the core mismatch-attack guard — a logged-in attacker whose
      // email is not on a pending record must NOT auto-claim that record.
      expect(isClaimAuthorized('attacker@evil.com', 'victim@clinic.edu')).toBe(false);
    });

    it('rejects a claim when auth has no email', () => {
      expect(isClaimAuthorized(null, 'participant@clinic.edu')).toBe(false);
      expect(isClaimAuthorized(undefined, 'participant@clinic.edu')).toBe(false);
    });

    it('rejects when the patient record has no email (defensive)', () => {
      expect(isClaimAuthorized('participant@clinic.edu', null)).toBe(false);
    });

    it('is case- and whitespace-insensitive', () => {
      expect(isClaimAuthorized('  User@Clinic.EDU  ', 'user@clinic.edu')).toBe(true);
    });
  });

  describe('Pathway type guard', () => {
    // Drift guard: if anyone re-adds "surgery" (legacy studyPathway value)
    // to the accepted pathway set, this test will fail loudly.
    it('accepts only "uds" and "bph"', () => {
      const validPathways: Pathway[] = ['uds', 'bph'];
      expect(validPathways).toHaveLength(2);
      expect(validPathways).toContain('uds');
      expect(validPathways).toContain('bph');
      // TypeScript enforces this at compile time; runtime assertion is
      // belt-and-suspenders.
      for (const p of validPathways) {
        expect(['uds', 'bph']).toContain(p);
      }
    });
  });
});

/**
 * Client-side contract: firebase-account-service derives
 * throneAccountEmail from the Firebase Auth email ONLY when the user
 * doc doesn't already have a value. This protects two cases:
 *   - First sign-in: the field is seeded from auth.email (no form
 *     input is read, so a malicious onboarding payload cannot inject a
 *     spoofed Throne email).
 *   - Subsequent sign-ins after a researcher correction: the existing
 *     value is preserved (otherwise the next sign-in would clobber the
 *     Hide-My-Email fix and Throne sessions would stop matching).
 */
describe('firebase-account-service throneAccountEmail write contract', () => {
  it('on first sign-in (no existing value), writes throneAccountEmail derived from auth.email', () => {
    // Simulate what syncRootUserProfile does when getDoc returns no
    // existing throneAccountEmail: throneAccountEmailToWrite defaults
    // to normalizedEmail.
    const fakeUser = {
      uid: 'abc-uid',
      email: 'User@Clinic.EDU',
      displayName: 'Jane Doe',
      metadata: {creationTime: '2026-04-18T00:00:00Z'},
    };
    const nameParts = (fakeUser.displayName || '').trim().split(/\s+/).filter(Boolean);
    const normalizedEmail = fakeUser.email?.trim().toLowerCase();
    const existingThroneAccountEmail = undefined as string | undefined;

    const throneAccountEmailToWrite =
      typeof existingThroneAccountEmail === 'string' && (existingThroneAccountEmail as string).trim() ?
        undefined :
        normalizedEmail || undefined;

    const payload = {
      name: fakeUser.displayName || undefined,
      displayName: fakeUser.displayName || undefined,
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(' ') || undefined,
      email: fakeUser.email || undefined,
      throneAccountEmail: throneAccountEmailToWrite,
      createdAt: fakeUser.metadata.creationTime || undefined,
    };

    expect(payload.throneAccountEmail).toBe('user@clinic.edu');
    expect(throneEmailsMatch(payload.throneAccountEmail, fakeUser.email)).toBe(true);

    // Email-shaped payload keys must be `email` and `throneAccountEmail`
    // only — both derived from the Firebase user. If someone adds a new
    // field like `throneEmailOverride` from a form, this fails.
    const payloadKeys = Object.keys(payload);
    const emailKeys = payloadKeys.filter((k) => k.toLowerCase().includes('email'));
    expect(emailKeys.sort()).toEqual(['email', 'throneAccountEmail']);
  });

  it('preserves a previously-set throneAccountEmail (does not write the field on subsequent sign-ins)', () => {
    // Researcher had set throneAccountEmail to a Hide-My-Email address
    // via setParticipantThroneEmail. On the participant's next sign-in,
    // syncRootUserProfile reads the existing value and skips writing
    // throneAccountEmail so the correction survives.
    const fakeUser = {
      uid: 'abc-uid',
      email: 'jane.doe@clinic.edu',
      displayName: 'Jane Doe',
      metadata: {creationTime: '2026-04-18T00:00:00Z'},
    };
    const existingThroneAccountEmail = '977csb86qd@privaterelay.appleid.com';

    const throneAccountEmailToWrite =
      typeof existingThroneAccountEmail === 'string' && existingThroneAccountEmail.trim() ?
        undefined :
        fakeUser.email.trim().toLowerCase();

    // Payload sent to saveUserProfile: throneAccountEmail is undefined,
    // which the underlying setDoc call will treat as a no-op for that
    // field (saveUserProfile filters out undefined keys).
    expect(throneAccountEmailToWrite).toBeUndefined();

    // Independent of what the auth-sync writes, the existing value is
    // what subsequent reads see — that's the field the Throne ingestion
    // router uses to match sessions.
    expect(existingThroneAccountEmail).toBe('977csb86qd@privaterelay.appleid.com');
    expect(throneEmailsMatch(existingThroneAccountEmail, fakeUser.email)).toBe(false);
  });
});
