#!/usr/bin/env node
/**
 * Diagnostic: verify HealthKit historical-upload data landed in Firestore
 * for a given test email. Reports per-metric doc counts, latest sample,
 * stored shape, and any sync-state error messages.
 *
 *   node scripts/check-hk-data.js test10@test.com
 */

const admin = require("firebase-admin");

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/check-hk-data.js <email>");
  process.exit(1);
}

// Full roster of quantity-sample metrics from healthkitSync.ts METRIC_CONFIG.
// Sleep is keyed by night-date (different shape) and handled separately.
const QUANTITY_METRICS = [
  {key: "heartRate",                 unit: "count/min"},
  {key: "stepCount",                 unit: "count"},
  {key: "heartRateVariabilitySDNN",  unit: "ms"},
  {key: "respiratoryRate",           unit: "count/min"},
  {key: "walkingHeartRateAverage",   unit: "count/min"},
  {key: "walkingSpeed",              unit: "m/s"},
  {key: "walkingStepLength",         unit: "cm"},
  {key: "appleWalkingSteadiness",    unit: "%"},
  {key: "sixMinuteWalkTestDistance", unit: "m"},
  {key: "uvExposure",                unit: "count"},
  {key: "oxygenSaturation",          unit: "%"},
  {key: "vo2Max",                    unit: "ml/(kg*min)"},
  {key: "appleStandTime",            unit: "min"},
  {key: "appleMoveTime",             unit: "min"},
  {key: "activeEnergyBurned",        unit: "kcal"},
  {key: "distanceWalkingRunning",    unit: "m"},
  {key: "timeInDaylight",            unit: "min"},
];

function fmt(v, w) {
  return String(v).padStart(w);
}

function fmtDate(ts) {
  if (!ts) return "              ?              ";
  try {
    return ts.toDate().toISOString();
  } catch {
    return String(ts);
  }
}

(async function main() {
  admin.initializeApp({projectId: "streamsync-8ae79"});
  const db = admin.firestore();
  const auth = admin.auth();

  const userRecord = await auth.getUserByEmail(email).catch(() => null);
  if (!userRecord) {
    console.error(`No Firebase Auth user found for email: ${email}`);
    process.exit(1);
  }
  const uid = userRecord.uid;
  console.log(`\n=== HealthKit sync report for ${email} ===`);
  console.log(`uid: ${uid}\n`);

  let ok = 0;
  let zero = 0;

  for (const {key, unit: expectedUnit} of QUANTITY_METRICS) {
    const path = `users/${uid}/hk_${key}`;
    const count = await db.collection(path).count().get().catch(() => null);
    const total = count?.data().count ?? 0;
    const latestSnap = await db.collection(path)
      .orderBy("endDate", "desc").limit(1).get().catch(() => null);

    if (total === 0 || !latestSnap || latestSnap.empty) {
      console.log(`  ❌ hk_${key.padEnd(28)} docs=${fmt(0, 6)}  (expected unit: ${expectedUnit})`);
      zero += 1;
      continue;
    }
    ok += 1;
    const latest = latestSnap.docs[0].data();
    const value = latest.value;
    const unit = latest.unit;
    const endIso = fmtDate(latest.endDate);
    const src = latest.sourceName || "?";
    const unitMatch = unit === expectedUnit ? " " : "⚠";
    const valueOk = typeof value === "number" && Number.isFinite(value) ? " " : "⚠";
    console.log(
      `  ✅ hk_${key.padEnd(28)} docs=${fmt(total, 6)}  latest=${endIso}  value=${String(value).padStart(10)} ${unit.padEnd(12)}${unitMatch}${valueOk}  src=${src}`,
    );
  }

  // Sleep (night-keyed)
  const sleepPath = `users/${uid}/hk_sleep`;
  const sleepCount = await db.collection(sleepPath).count().get().catch(() => null);
  const sleepTotal = sleepCount?.data().count ?? 0;
  const sleepSnap = await db.collection(sleepPath).orderBy("date", "desc").limit(1).get().catch(() => null);
  if (sleepTotal === 0 || !sleepSnap || sleepSnap.empty) {
    console.log(`  ❌ hk_sleep                     nights=${fmt(0, 3)}`);
    zero += 1;
  } else {
    ok += 1;
    const latestNight = sleepSnap.docs[0].data();
    const samples = latestNight.samples || [];
    console.log(
      `  ✅ hk_sleep                     nights=${fmt(sleepTotal, 3)}  latest-night=${latestNight.date}  samples-in-latest=${samples.length}`,
    );
    if (samples.length > 0) {
      const firstStage = samples[0].stage;
      console.log(`     sample stage on latest night: "${firstStage}"`);
    }
  }

  console.log(`\n${ok} of ${ok + zero} metrics have data.\n`);

  // Show the full stored shape of one representative sample so we can
  // confirm the on-disk format is readable.
  console.log(`=== Sample document shapes ===`);
  for (const key of ["heartRate", "activeEnergyBurned", "vo2Max", "sixMinuteWalkTestDistance"]) {
    const path = `users/${uid}/hk_${key}`;
    const snap = await db.collection(path).limit(1).get().catch(() => null);
    if (!snap || snap.empty) continue;
    const doc = snap.docs[0];
    const data = doc.data();
    console.log(`\n  hk_${key}/${doc.id}:`);
    for (const [k, v] of Object.entries(data)) {
      let display;
      if (v instanceof admin.firestore.Timestamp) {
        display = `Timestamp(${v.toDate().toISOString()})`;
      } else if (v && typeof v === "object") {
        display = JSON.stringify(v);
      } else {
        display = typeof v === "string" ? `"${v}"` : String(v);
      }
      console.log(`    ${k.padEnd(14)} ${typeof v === "object" && v instanceof admin.firestore.Timestamp ? "Timestamp" : typeof v}  ${display}`);
    }
  }

  // Show one sleep sample shape too
  if (sleepSnap && !sleepSnap.empty) {
    const d = sleepSnap.docs[0].data();
    console.log(`\n  hk_sleep/${sleepSnap.docs[0].id}:`);
    console.log(`    date         string   "${d.date}"`);
    console.log(`    samples      array    ${(d.samples || []).length} items, first = ${JSON.stringify((d.samples || [])[0] ?? null)}`);
  }

  console.log(`\n=== All subcollections under users/${uid} ===`);
  const subs = await db.collection("users").doc(uid).listCollections();
  for (const sub of subs) {
    const c = await sub.count().get().catch(() => null);
    console.log(`  ${sub.id.padEnd(40)}  ${c?.data().count ?? "?"} docs`);
  }
  console.log("");
  process.exit(0);
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
