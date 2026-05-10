/**
 * Throne Research API Ingestion Module
 *
 * Fetches uroflow session data from Throne Research API,
 * normalizes sessions + metrics, and writes to Firestore
 * under each participant's user document.
 *
 * Firestore schema (per user):
 *   users/{firebaseUid}/throne_sessions/{sessionId}  — NormalizedSession
 *   users/{firebaseUid}/throne_metrics/{metricId}    — NormalizedMetric
 *   users/{firebaseUid}/throne_sync/state            — per-user sync state
 *
 * Admin collections:
 *   throneSync/{studyId}         — study-level sync cursor (Cloud Function use only)
 *   throneUserMap/{throneUserId} — Throne userId → Firebase UID reverse lookup
 *     (maintained automatically by the syncThroneUserMap Cloud Function trigger)
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ThroneMetricRaw {
  id: string;
  ts: string;
  created: string;
  updated: string;
  deleted: string | null;
  sessionId: string;
  type: string;
  value: string;
  series: string;
  durationMicros: string;
}

interface ThroneSessionRaw {
  id: string;
  tags: string[];
  created: string;
  updated: string;
  startTs: string;
  endTs: string;
  deviceId: string;
  userId: string;
  userEmail?: string | null;
  status: string;
  metrics: ThroneMetricRaw[];
}

interface ExportResponse {
  studyId: string;
  sessions: ThroneSessionRaw[];
  page: number;
  count: number;
  hasMore: boolean;
}

export interface NormalizedSession {
  id: string;
  studyId: string;
  tags: string[];
  created: string;
  updated: string;
  startTs: string;
  endTs: string;
  deviceId: string;
  userId: string;
  userEmail: string | null;
  status: string;
  metricCount: number;
}

export interface NormalizedMetric {
  id: string;
  studyId: string;
  sessionId: string;
  ts: string;
  created: string;
  updated: string;
  deleted: string | null;
  type: string;
  value: number | string;
  series: string;
  durationMicros: number;
}

interface SyncState {
  lastRunAt: string;
  lastVoidAt?: string | null;
  lastLtTs: string;
  lastStatus: "success" | "error";
  lastError: string | null;
  sessionCount: number;
  metricCount: number;
}

export interface ThroneBackfillResult {
  email: string;
  days: number;
  gtTs: string;
  ltTs: string;
  pagesFetched: number;
  scannedSessionCount: number;
  matchedSessionCount: number;
  matchedDoneWithMetricsCount: number;
  sessionCount: number;
  metricCount: number;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ThroneConfig {
  apiKey: string;
  baseUrl: string;
  timezone: string;
  studyId: string;
}

function looksLikeEmailIdentifier(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function normalizeEmailIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return looksLikeEmailIdentifier(normalized) ? normalized : null;
}

function addMapping(map: Map<string, string[]>, key: string | null, firebaseUid: string): void {
  if (!key) return;
  const existing = map.get(key) ?? [];
  if (!existing.includes(firebaseUid)) {
    existing.push(firebaseUid);
    map.set(key, existing);
  }
}

function maskEmailForLog(email: string | null): string {
  if (!email) return "(none)";
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

async function buildUserMappings(
  db: admin.firestore.Firestore,
): Promise<{
  throneUserIdToFirebase: Map<string, string[]>;
  emailToFirebase: Map<string, string[]>;
}> {
  const usersSnap = await db.collection("users").get();

  const throneUserIdToFirebase = new Map<string, string[]>();
  const emailToFirebase = new Map<string, string[]>();
  const batch = db.batch();
  let migratedEmailShapedIds = 0;

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const rawThroneUserId = typeof data.throneUserId === "string" ? data.throneUserId.trim() : "";
    const throneAccountEmail = normalizeEmailIdentifier(data.throneAccountEmail);
    const accountEmail = normalizeEmailIdentifier(data.email);

    addMapping(emailToFirebase, throneAccountEmail, doc.id);
    addMapping(emailToFirebase, accountEmail, doc.id);

    if (!rawThroneUserId) {
      continue;
    }

    if (looksLikeEmailIdentifier(rawThroneUserId)) {
      const migratedEmail = normalizeEmailIdentifier(rawThroneUserId);
      migratedEmailShapedIds++;
      addMapping(emailToFirebase, migratedEmail, doc.id);
      batch.set(doc.ref, {
        throneAccountEmail: throneAccountEmail || migratedEmail,
        throneUserId: admin.firestore.FieldValue.delete(),
        throneUserIdSetAt: admin.firestore.FieldValue.delete(),
        updatedAt: new Date().toISOString(),
      }, {merge: true});
      continue;
    }

    addMapping(throneUserIdToFirebase, rawThroneUserId, doc.id);
  }

  if (migratedEmailShapedIds > 0) {
    await batch.commit();
    logger.info(`Migrated ${migratedEmailShapedIds} email-shaped throneUserId value(s) into throneAccountEmail`);
  }

  return {throneUserIdToFirebase, emailToFirebase};
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

function apiHeaders(config: ThroneConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "api-key": config.apiKey,
    "x-throne-tz": config.timezone,
  };
}

async function fetchExportPage(
  config: ThroneConfig,
  page: number,
  gtTs: string,
  ltTs: string,
): Promise<ExportResponse> {
  const url = `${config.baseUrl}/api.Research/Export`;
  logger.info(`Throne Export page=${page}`, {gtTs, ltTs});

  const res = await fetch(url, {
    method: "POST",
    headers: apiHeaders(config),
    body: JSON.stringify({
      studyId: config.studyId,
      gtTs,
      ltTs,
      page,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Throne Export page ${page} failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<ExportResponse>;
}

// ─── Normalization ───────────────────────────────────────────────────────────

function normalizeValue(val: string): number | string {
  if (val === "" || val === null || val === undefined) return val;
  const n = Number(val);
  return Number.isFinite(n) ? n : val;
}

function normalizeSessions(
  pages: ExportResponse[],
  studyId: string,
): { sessions: NormalizedSession[]; metrics: NormalizedMetric[] } {
  const sessionMap = new Map<string, NormalizedSession>();
  const metricMap = new Map<string, NormalizedMetric>();

  for (const page of pages) {
    for (const s of page.sessions) {
      if (!sessionMap.has(s.id)) {
        sessionMap.set(s.id, {
          id: s.id,
          studyId,
          tags: s.tags,
          created: s.created,
          updated: s.updated,
          startTs: s.startTs,
          endTs: s.endTs,
          deviceId: s.deviceId,
          userId: s.userId,
          userEmail: normalizeEmailIdentifier(s.userEmail),
          status: s.status,
          metricCount: s.metrics.length,
        });
      }

      for (const m of s.metrics) {
        if (!metricMap.has(m.id)) {
          metricMap.set(m.id, {
            id: m.id,
            studyId,
            sessionId: m.sessionId || s.id,
            ts: m.ts,
            created: m.created,
            updated: m.updated,
            deleted: m.deleted,
            type: m.type,
            value: normalizeValue(m.value),
            series: m.series,
            durationMicros: Number(m.durationMicros) || 0,
          });
        }
      }
    }
  }

  return {
    sessions: Array.from(sessionMap.values()),
    metrics: Array.from(metricMap.values()),
  };
}

// ─── Firestore Writer ────────────────────────────────────────────────────────

const BATCH_LIMIT = 400;

async function getMissingEntries<T extends {id: string}>(
  db: admin.firestore.Firestore,
  pathPrefix: string,
  entries: T[],
): Promise<T[]> {
  const missing: T[] = [];

  for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
    const chunk = entries.slice(i, i + BATCH_LIMIT);
    const refs = chunk.map((entry) => db.doc(`${pathPrefix}/${entry.id}`));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, index) => {
      if (!snap.exists) {
        missing.push(chunk[index]);
      }
    });
  }

  return missing;
}

async function writeToFirestore(
  db: admin.firestore.Firestore,
  sessions: NormalizedSession[],
  metrics: NormalizedMetric[],
): Promise<{sessionCount: number; metricCount: number}> {
  let writtenSessionCount = 0;
  let writtenMetricCount = 0;

  const metricsBySessionId = new Map<string, NormalizedMetric[]>();
  for (const m of metrics) {
    const arr = metricsBySessionId.get(m.sessionId) ?? [];
    arr.push(m);
    metricsBySessionId.set(m.sessionId, arr);
  }

  // Build lookup maps. Email is now the preferred Throne/Firebase join key;
  // throneUserId remains as a fallback for legacy manually-linked accounts.
  const {throneUserIdToFirebase, emailToFirebase} = await buildUserMappings(db);
  logger.info(
    "Throne→Firebase mappings found: " +
    `${emailToFirebase.size} email(s), ${throneUserIdToFirebase.size} Throne userId(s)`,
  );

  const sessionsByFirebaseUid = new Map<string, NormalizedSession[]>();
  const metricsByFirebaseUid = new Map<string, NormalizedMetric[]>();

  for (const session of sessions) {
    const firebaseUids = session.userEmail ?
      emailToFirebase.get(session.userEmail) :
      undefined;
    const fallbackFirebaseUids = !firebaseUids?.length ?
      throneUserIdToFirebase.get(session.userId) :
      undefined;
    const resolvedFirebaseUids = firebaseUids?.length ? firebaseUids : fallbackFirebaseUids;

    if (!resolvedFirebaseUids || resolvedFirebaseUids.length === 0) {
      logger.warn(
        "No Firebase user match for Throne session. " +
        `userEmail=${maskEmailForLog(session.userEmail)}, throneUserId=${session.userId}; ` +
        "skipping 1 session.",
      );
      continue;
    }

    const sessionMetrics = metricsBySessionId.get(session.id) ?? [];
    for (const firebaseUid of resolvedFirebaseUids) {
      const userSessions = sessionsByFirebaseUid.get(firebaseUid) ?? [];
      userSessions.push(session);
      sessionsByFirebaseUid.set(firebaseUid, userSessions);

      const userMetrics = metricsByFirebaseUid.get(firebaseUid) ?? [];
      userMetrics.push(...sessionMetrics);
      metricsByFirebaseUid.set(firebaseUid, userMetrics);
    }
  }

  for (const [firebaseUid, userSessions] of sessionsByFirebaseUid) {
    const userMetrics = metricsByFirebaseUid.get(firebaseUid) ?? [];
    const latestVoidAt = userSessions.reduce<string | null>((latest, session) => {
      if (!session.startTs) return latest;
      if (!latest) return session.startTs;
      return new Date(session.startTs).getTime() > new Date(latest).getTime() ?
        session.startTs :
        latest;
    }, null);

    const missingSessions = await getMissingEntries(
      db,
      `users/${firebaseUid}/throne_sessions`,
      userSessions,
    );
    const missingMetrics = await getMissingEntries(
      db,
      `users/${firebaseUid}/throne_metrics`,
      userMetrics,
    );
    writtenSessionCount += missingSessions.length;
    writtenMetricCount += missingMetrics.length;

    // Write sessions in batches
    for (let i = 0; i < missingSessions.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const s of missingSessions.slice(i, i + BATCH_LIMIT)) {
        batch.set(
          db.collection(`users/${firebaseUid}/throne_sessions`).doc(s.id),
          s,
        );
      }
      await batch.commit();
      logger.info(`Wrote sessions batch for uid=${firebaseUid}`);
    }

    // Write metrics in batches
    for (let i = 0; i < missingMetrics.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const m of missingMetrics.slice(i, i + BATCH_LIMIT)) {
        batch.set(
          db.collection(`users/${firebaseUid}/throne_metrics`).doc(m.id),
          m,
        );
      }
      await batch.commit();
      logger.info(`Wrote metrics batch for uid=${firebaseUid}`);
    }

    // Write per-user sync state
    await db.doc(`users/${firebaseUid}/throne_sync/state`).set({
      lastRunAt: new Date().toISOString(),
      lastVoidAt: latestVoidAt,
      lastStatus: "success",
      sessionCount: missingSessions.length,
      metricCount: missingMetrics.length,
      seenSessionCount: userSessions.length,
      seenMetricCount: userMetrics.length,
    }, {merge: true});

    logger.info(
      `Ingestion complete for uid=${firebaseUid}: ` +
      `${missingSessions.length} new sessions, ${missingMetrics.length} new metrics`,
    );
  }

  return {
    sessionCount: writtenSessionCount,
    metricCount: writtenMetricCount,
  };
}

// ─── Main Ingestion Logic ────────────────────────────────────────────────────

export async function runThroneIngestion(
  config: ThroneConfig,
  opts?: { fullSync?: boolean },
): Promise<{ sessionCount: number; metricCount: number }> {
  const db = admin.firestore();
  const studyId = config.studyId;

  // Determine time window from study-level sync cursor
  const syncRef = db.collection("throneSync").doc(studyId);
  const syncDoc = await syncRef.get();

  const now = new Date();
  let gtTs: string;
  const ltTs = now.toISOString();

  if (opts?.fullSync) {
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    gtTs = oneYearAgo.toISOString();
    logger.info(`Full sync requested, fetching from ${gtTs}`);
  } else if (syncDoc.exists) {
    const data = syncDoc.data() as SyncState;
    gtTs = data.lastLtTs;
    logger.info(`Incremental sync from ${gtTs}`);
  } else {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    gtTs = sevenDaysAgo.toISOString();
    logger.info(`Initial sync from ${gtTs}`);
  }

  // Fetch all pages
  const allPages: ExportResponse[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await fetchExportPage(config, page, gtTs, ltTs);
    allPages.push(data);
    logger.info(`Page ${page}: ${data.count} sessions, hasMore=${data.hasMore}`);
    hasMore = data.hasMore;
    page++;

    if (page > 100) {
      logger.warn("Exceeded 100 pages, stopping pagination");
      break;
    }
  }

  // Normalize
  const {sessions, metrics} = normalizeSessions(allPages, studyId);
  logger.info(`Normalized: ${sessions.length} sessions, ${metrics.length} metrics`);

  // Write to user-scoped paths
  const writeResult = (sessions.length > 0 || metrics.length > 0) ?
    await writeToFirestore(db, sessions, metrics) :
    {sessionCount: 0, metricCount: 0};

  // Advance study-level sync cursor
  const syncState: SyncState = {
    lastRunAt: now.toISOString(),
    lastLtTs: ltTs,
    lastStatus: "success",
    lastError: null,
    sessionCount: writeResult.sessionCount,
    metricCount: writeResult.metricCount,
  };
  await syncRef.set(syncState, {merge: true});

  return {sessionCount: writeResult.sessionCount, metricCount: writeResult.metricCount};
}

export async function runThroneBackfillForEmail(
  config: ThroneConfig,
  email: string,
  opts?: {days?: number; ltTs?: string},
): Promise<ThroneBackfillResult> {
  const normalizedEmail = normalizeEmailIdentifier(email);
  if (!normalizedEmail) {
    throw new Error("email must be a valid address");
  }

  const days = Math.min(Math.max(Math.floor(opts?.days ?? 180), 1), 365);
  const ltDate = opts?.ltTs ? new Date(opts.ltTs) : new Date();
  if (Number.isNaN(ltDate.getTime())) {
    throw new Error("ltTs must be a valid ISO date when provided");
  }
  const gtDate = new Date(ltDate.getTime() - days * 24 * 60 * 60 * 1000);

  const matchedPages: ExportResponse[] = [];
  let pagesFetched = 0;
  let scannedSessionCount = 0;
  let matchedSessionCount = 0;
  let matchedDoneWithMetricsCount = 0;

  for (let day = days; day > 0; day--) {
    const windowStart = new Date(ltDate.getTime() - day * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(ltDate.getTime() - (day - 1) * 24 * 60 * 60 * 1000);
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const data = await fetchExportPage(
        config,
        page,
        windowStart.toISOString(),
        windowEnd.toISOString(),
      );
      pagesFetched++;
      scannedSessionCount += data.sessions.length;

      const matchedSessions = data.sessions.filter((session) =>
        normalizeEmailIdentifier(session.userEmail) === normalizedEmail,
      );
      if (matchedSessions.length > 0) {
        matchedSessionCount += matchedSessions.length;
        matchedDoneWithMetricsCount += matchedSessions.filter((session) =>
          session.status === "DONE" &&
          Array.isArray(session.metrics) &&
          session.metrics.length > 0,
        ).length;
        matchedPages.push({
          ...data,
          sessions: matchedSessions,
          count: matchedSessions.length,
          hasMore: false,
        });
      }

      hasMore = data.hasMore;
      page++;
      if (page > 100) {
        throw new Error(
          `Throne backfill exceeded 100 pages for ${windowStart.toISOString()} to ${windowEnd.toISOString()}`,
        );
      }
    }
  }

  const db = admin.firestore();
  const {sessions, metrics} = normalizeSessions(matchedPages, config.studyId);
  const writeResult = (sessions.length > 0 || metrics.length > 0) ?
    await writeToFirestore(db, sessions, metrics) :
    {sessionCount: 0, metricCount: 0};

  await db.collection("throne_research_participants").doc(normalizedEmail).set({
    lastSyncAt: new Date().toISOString(),
    lastBackfillAt: new Date().toISOString(),
    lastBackfillDays: days,
    lastBackfillMatchedSessions: matchedSessionCount,
    lastBackfillMatchedDoneWithMetrics: matchedDoneWithMetricsCount,
  }, {merge: true});

  logger.info("Throne email backfill complete", {
    email: maskEmailForLog(normalizedEmail),
    days,
    matchedSessionCount,
    matchedDoneWithMetricsCount,
    ...writeResult,
  });

  return {
    email: normalizedEmail,
    days,
    gtTs: gtDate.toISOString(),
    ltTs: ltDate.toISOString(),
    pagesFetched,
    scannedSessionCount,
    matchedSessionCount,
    matchedDoneWithMetricsCount,
    ...writeResult,
  };
}
