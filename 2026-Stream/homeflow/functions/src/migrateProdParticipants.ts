/**
 * One-shot migration: legacy UDS users → new patients schema.
 *
 * Context — pre-launch audit (2026-04-18) identified three real
 * participants still enrolled under the retired "streamsync-uds" studyId
 * whose email ended up in the `throneUserId` field instead of
 * `throneAccountEmail`. These three must survive the schema collapse
 * rather than being wiped. All other users/* docs are test accounts and
 * are untouched here.
 *
 *   henryj@well.com
 *   rthus@acmebyte.com
 *   bellskitchen@hushmail.com
 *
 * What this migration does for each target email (idempotent):
 *   1. Look up Firebase Auth user record by email.
 *   2. Read users/{uid} root doc.
 *   3. If a patients/* doc already exists for this firebaseUid, skip.
 *   4. Otherwise write a minimal patients/* doc with:
 *        studyId=STUDY_ID, pathway="uds", status="active",
 *        email, throneAccountEmail=email, throneUserId=null,
 *        firebaseUid=<uid>, upcomingVisit=null, pendingPathwayChange=null
 *      PHI fields (firstName, lastName, dob, phoneNumber) are written as
 *      null — researchers will fill them in via a future edit UI. The
 *      schema is set up to tolerate nulls for legacy migrations.
 *   5. Update users/{uid}:
 *        - throneUserId:        FieldValue.delete()
 *        - throneUserIdSetAt:   FieldValue.delete()
 *        - throneAccountEmail:  email (normalized)
 *        - studyId:             STUDY_ID
 *        - pathway:             "uds"
 *        - updatedAt:           now
 *      PHI fields on the users root (firstName/lastName/phoneNumber) are
 *      NOT stripped here — that happens in the Cross-cutting PHI pass
 *      only after the Profile tab's display-name swap has shipped.
 *   6. Upsert throne_research_participants/{email_lowercase} with
 *      firebaseUid, enrolledAt (preserved if present), throneAccountCreated=false.
 *
 * Running:
 *   POST /migrateProdParticipants with a researcher bearer token.
 *   Body: { dryRun?: boolean, emails?: string[] } (defaults to the three
 *   target emails above).
 *   Safe to re-run — already-migrated participants are skipped.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {STUDY_ID} from "./studyConfig";

const DEFAULT_TARGETS = [
  "henryj@well.com",
  "rthus@acmebyte.com",
  "bellskitchen@hushmail.com",
] as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function looksLikeEmail(value: string | null | undefined): value is string {
  return typeof value === "string" && EMAIL_REGEX.test(value.trim());
}

export interface MigrationAction {
  email: string;
  action: "migrated" | "skipped" | "error";
  reason?: string;
  participantId?: string;
  firebaseUid?: string;
  dryRun?: boolean;
}

export async function migrateProdParticipants(
  db: admin.firestore.Firestore,
  authClient: admin.auth.Auth,
  opts: {
    dryRun: boolean;
    emails: string[];
    researcherUid: string;
  },
): Promise<{actions: MigrationAction[]}> {
  const actions: MigrationAction[] = [];

  for (const raw of opts.emails) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;

    try {
      // 1. Firebase Auth lookup
      let authUser: admin.auth.UserRecord;
      try {
        authUser = await authClient.getUserByEmail(email);
      } catch {
        actions.push({email, action: "skipped", reason: "No Firebase Auth user with this email"});
        continue;
      }

      // 2. users/{uid} read
      const userRef = db.collection("users").doc(authUser.uid);
      const userSnap = await userRef.get();
      const userData = userSnap.exists ? (userSnap.data() ?? {}) : {};

      // 3. Idempotency — skip if a patients doc already points at this uid
      const existingPatient = await db
        .collection("patients")
        .where("firebaseUid", "==", authUser.uid)
        .limit(1)
        .get();
      if (!existingPatient.empty) {
        actions.push({
          email,
          action: "skipped",
          reason: `patients/${existingPatient.docs[0].id} already exists for this uid`,
          firebaseUid: authUser.uid,
          participantId: existingPatient.docs[0].id,
        });
        continue;
      }

      // Recover the Throne account email: prefer the explicit field, else
      // the bogus email-shaped throneUserId, else fall back to the auth email.
      const rawThroneAccountEmail = typeof userData.throneAccountEmail === "string" ?
        userData.throneAccountEmail.trim().toLowerCase() :
        "";
      const rawThroneUserId = typeof userData.throneUserId === "string" ?
        userData.throneUserId.trim() :
        "";
      const recoveredThroneEmail = rawThroneAccountEmail ||
        (looksLikeEmail(rawThroneUserId) ? rawThroneUserId.toLowerCase() : email);

      if (recoveredThroneEmail !== email) {
        // Surface the discrepancy rather than silently coercing — the
        // sacred invariant requires Streamsync auth email == Throne email.
        logger.warn("Migration: Streamsync email != recovered Throne email", {
          email,
          recoveredThroneEmail,
          uid: authUser.uid,
        });
      }

      const now = new Date().toISOString();
      const participantRef = db.collection("patients").doc();
      const participantId = participantRef.id;

      const participantDoc = {
        id: participantId,
        studyId: STUDY_ID,
        pathway: "uds" as const,
        // PHI — unknown for migrated records, filled in later by researcher.
        firstName: null,
        lastName: null,
        dob: null,
        phoneNumber: null,
        email,
        throneAccountEmail: email,
        throneUserId: null,
        upcomingVisit: null,
        pendingPathwayChange: null,
        firebaseUid: authUser.uid,
        status: "active" as const,
        enrolledAt: typeof userData.enrolledAt === "string" ?
          userData.enrolledAt :
          now,
        createdAt: now,
        updatedAt: now,
        enrolledBy: opts.researcherUid,
        studyKey: "uds",
        migrationSource: "migrateProdParticipants@2026-04-18",
      };

      const userUpdate = {
        throneUserId: admin.firestore.FieldValue.delete(),
        throneUserIdSetAt: admin.firestore.FieldValue.delete(),
        throneAccountEmail: email,
        studyId: STUDY_ID,
        pathway: "uds" as const,
        updatedAt: now,
      };

      const throneRegistryRef = db
        .collection("throne_research_participants")
        .doc(email);
      const throneRegistryDoc = {
        email,
        firebaseUid: authUser.uid,
        enrolledAt: typeof userData.enrolledAt === "string" ?
          userData.enrolledAt :
          now,
        throneAccountCreated: false,
        lastSyncAt: null,
      };

      if (opts.dryRun) {
        actions.push({
          email,
          action: "migrated",
          participantId,
          firebaseUid: authUser.uid,
          dryRun: true,
        });
        continue;
      }

      const batch = db.batch();
      batch.set(participantRef, participantDoc);
      batch.set(userRef, userUpdate, {merge: true});
      batch.set(throneRegistryRef, throneRegistryDoc, {merge: true});
      await batch.commit();

      logger.info("Migration: migrated participant", {
        email,
        participantId,
        firebaseUid: authUser.uid,
      });
      actions.push({
        email,
        action: "migrated",
        participantId,
        firebaseUid: authUser.uid,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Migration: error", {email, message});
      actions.push({email, action: "error", reason: message});
    }
  }

  return {actions};
}

export function defaultMigrationTargets(): string[] {
  return Array.from(DEFAULT_TARGETS);
}
