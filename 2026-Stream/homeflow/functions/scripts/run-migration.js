#!/usr/bin/env node
/**
 * Local runner for migrateProdParticipants.
 *
 * Uses Application Default Credentials (ADC) so you can invoke the
 * migration from a dev machine without deploying the Cloud Function
 * first. Pass --dryRun for a read-only preview, --real to actually
 * write.
 *
 *   node scripts/run-migration.js --dryRun
 *   node scripts/run-migration.js --real
 */

const admin = require("firebase-admin");
const {
  migrateProdParticipants,
  defaultMigrationTargets,
} = require("../lib/migrateProdParticipants");

const argv = process.argv.slice(2);
const dryRun = !argv.includes("--real");
const explicitEmails = argv
  .filter((a) => a.includes("@"))
  .map((e) => e.trim().toLowerCase());

(async function main() {
  admin.initializeApp({projectId: "streamsync-8ae79"});
  const db = admin.firestore();
  const authClient = admin.auth();

  const targets = explicitEmails.length ? explicitEmails : defaultMigrationTargets();

  console.log(`\n=== migrateProdParticipants (dryRun=${dryRun}) ===`);
  console.log(`Targets: ${targets.join(", ")}\n`);

  const result = await migrateProdParticipants(db, authClient, {
    dryRun,
    emails: targets,
    researcherUid: "local-migration-runner",
  });

  console.log("\n=== Actions ===");
  for (const a of result.actions) {
    console.log(JSON.stringify(a));
  }
  console.log("\nDone.\n");
  process.exit(0);
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
