/**
 * Firestore trigger that pushes a researcher's message to the participant's
 * iPhone via the Expo push notification service.
 *
 * Wired to onDocumentCreated for /supportChats/{chatId}/messages/{messageId}.
 * Fires only when role == "researcher" — assistant + participant messages
 * have no remote-push side effect (they originate from the user's own actions
 * or the Anthropic call, which the user is already watching live).
 *
 * Why Expo push and not raw APNs/FCM:
 *   - The iOS app is EAS-managed (projectId in app.config.js).
 *   - Expo's push service handles APNs cert + token rotation, so we don't
 *     need an APNs Auth Key uploaded to Firebase Console.
 *   - One unauthenticated POST to https://exp.host/--/api/v2/push/send.
 *
 * On `DeviceNotRegistered` (the device wiped the app or Expo rotated the
 * token), we prune the dead token from /users/{uid}.expoPushTokens so we
 * don't keep retrying forever.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {onDocumentCreated} from "firebase-functions/v2/firestore";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: "default";
  data?: Record<string, unknown>;
  // Apple-specific: deliver in foreground with sound + banner.
  _displayInForeground?: boolean;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: {error?: string};
}

interface ExpoPushResponse {
  data?: ExpoPushTicket | ExpoPushTicket[];
  errors?: Array<{code: string; message: string}>;
}

/**
 * Send a single Expo push payload. Returns the per-token outcomes so the
 * caller can prune dead tokens.
 *
 * @param {ExpoPushMessage[]} messages Push payloads — one per device token.
 * @return {Promise<ExpoPushTicket[]>} Tickets parallel to the input array.
 */
async function sendExpoPushBatch(
  messages: ExpoPushMessage[],
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];
  const res = await fetch(EXPO_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Accept-encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`Expo push HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as ExpoPushResponse;
  if (json.errors?.length) {
    throw new Error(`Expo push errors: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) return [];
  return Array.isArray(json.data) ? json.data : [json.data];
}

/**
 * Strip tokens that Expo reports as DeviceNotRegistered. Idempotent — if
 * the token has already been removed by another invocation, the arrayRemove
 * is a no-op.
 *
 * @param {string} participantId Firebase UID owning the tokens.
 * @param {string[]} deadTokens Tokens that came back as not-registered.
 */
async function pruneDeadTokens(
  participantId: string,
  deadTokens: string[],
): Promise<void> {
  if (deadTokens.length === 0) return;
  const db = admin.firestore();
  await db.collection("users").doc(participantId).set(
    {
      expoPushTokens: admin.firestore.FieldValue.arrayRemove(...deadTokens),
    },
    {merge: true},
  );
  logger.info(
    `[push] pruned ${deadTokens.length} dead token(s) for ${participantId}`,
  );
}

/**
 * Cloud Function — Firestore trigger.
 * Path: supportChats/{chatId}/messages/{messageId}
 *
 * On creation of a message with role:"researcher", look up the participant's
 * Expo push tokens and POST a notification batch.
 */
export const notifyOnSupportMessage = onDocumentCreated(
  {document: "supportChats/{chatId}/messages/{messageId}"},
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as Record<string, unknown>;
    const role = data.role;
    if (role !== "researcher") return;
    const content = String(data.content ?? "").trim();
    if (!content) return;

    const chatId = event.params.chatId;
    const db = admin.firestore();

    const chatSnap = await db.collection("supportChats").doc(chatId).get();
    if (!chatSnap.exists) {
      logger.warn(`[push] chat ${chatId} does not exist`);
      return;
    }
    const participantId = String(chatSnap.data()?.participantId ?? "");
    if (!participantId) {
      logger.warn(`[push] chat ${chatId} has no participantId`);
      return;
    }

    const userSnap = await db.collection("users").doc(participantId).get();
    if (!userSnap.exists) {
      logger.warn(`[push] participant ${participantId} has no /users doc`);
      return;
    }
    const tokensRaw = userSnap.data()?.expoPushTokens;
    const tokens: string[] = Array.isArray(tokensRaw) ?
      tokensRaw.filter((t): t is string => typeof t === "string" && t.startsWith("ExponentPushToken")) :
      [];
    if (tokens.length === 0) {
      logger.info(
        `[push] participant ${participantId} has no Expo tokens; skipping`,
      );
      return;
    }

    // Truncate the body so iOS notification UI doesn't break — Apple shows
    // the first ~100 chars, and longer payloads add cost without benefit.
    const body = content.length > 140 ? `${content.slice(0, 137)}…` : content;

    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title: "StreamSync Research Team",
      body,
      sound: "default",
      data: {
        screen: "support-chat",
        trigger: "participant-initiated",
        chatId,
      },
    }));

    let tickets: ExpoPushTicket[];
    try {
      tickets = await sendExpoPushBatch(messages);
    } catch (err) {
      logger.error("[push] send failed", err);
      return;
    }

    const deadTokens: string[] = [];
    tickets.forEach((ticket, i) => {
      if (
        ticket.status === "error" &&
        ticket.details?.error === "DeviceNotRegistered"
      ) {
        deadTokens.push(tokens[i]);
      } else if (ticket.status === "error") {
        logger.warn(
          `[push] non-fatal error for ${tokens[i]}: ${ticket.message}`,
        );
      }
    });
    if (deadTokens.length > 0) {
      await pruneDeadTokens(participantId, deadTokens).catch((err) =>
        logger.warn("[push] prune failed", err),
      );
    }

    logger.info(
      `[push] sent ${tickets.length} push(es) for chat ${chatId} ` +
      `to participant ${participantId}`,
    );
  },
);
