/**
 * AI Support Chat Service
 *
 * Drives the in-app participant chat that replaces the old "tap notification
 * → bounce out to email" flow. The Cloud Function (claudeSupportChat) handles
 * the Anthropic call, the PII firewall, and message persistence; this client
 * is a thin wrapper around two concerns:
 *
 *   1. Posting turns to the function (start chat, send follow-up).
 *   2. Streaming the messages subcollection in real time so a researcher's
 *      direct message appears in the participant's app within seconds —
 *      without a polling loop.
 *
 * The service is intentionally pathway-agnostic. The notification handler
 * decides which trigger reason to pass; everything below treats the trigger
 * as a label and lets the Cloud Function derive the right device-specific
 * system prompt from Firestore.
 */

import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db, getAuth } from '@/src/services/firestore';

const FUNCTIONS_BASE_URL =
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ||
  'https://us-central1-streamsync-8ae79.cloudfunctions.net';

export type SupportChatTrigger =
  | '48h-alert'
  | '5d-alert'
  | 'participant-initiated';

export type SupportRole = 'participant' | 'assistant' | 'researcher';

export interface SupportMessage {
  id: string;
  role: SupportRole;
  content: string;
  timestamp: Date | null;
}

export interface SupportContextSnapshot {
  firstName: string;
  throneIssue: boolean;
  appleIssue: boolean;
  lastThroneSyncRel: string;
  lastAppleHealthSyncRel: string;
  currentPhase: string;
}

export interface SupportChatResponse {
  chatId: string;
  reply: string;
  thresholdHours: number;
  context: SupportContextSnapshot;
}

interface PostBody {
  participantId: string;
  chatId?: string;
  userMessage?: string;
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
  triggerReason?: SupportChatTrigger;
  isOpening?: boolean;
}

async function postChatRequest(body: PostBody): Promise<SupportChatResponse> {
  const user = getAuth().currentUser;
  if (!user) {
    throw new Error('Not signed in');
  }
  const token = await user.getIdToken();
  const res = await fetch(`${FUNCTIONS_BASE_URL}/claudeSupportChat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Support chat HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as SupportChatResponse & { status?: string };
  if (!json.chatId || !json.reply) {
    throw new Error('Support chat response missing chatId or reply');
  }
  return json;
}

/**
 * Open a fresh chat. Returns the new chatId + Claude's opening message.
 * The caller should display the reply immediately and start the snapshot
 * listener via `subscribeToChat`.
 */
export async function startSupportChat(
  trigger: SupportChatTrigger,
): Promise<SupportChatResponse> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('Not signed in');
  return postChatRequest({
    participantId: user.uid,
    triggerReason: trigger,
    isOpening: true,
  });
}

/**
 * Look up the participant's most recent OPEN support chat. Returns null
 * if there isn't one. Used by the chat screen to decide whether to resume
 * an existing thread (e.g. one a researcher started from the dashboard)
 * or open a fresh AI conversation.
 */
export async function findActiveChat(): Promise<{
  chatId: string;
  triggerReason: SupportChatTrigger | null;
} | null> {
  const user = getAuth().currentUser;
  if (!user) return null;
  const chatsRef = collection(db, 'supportChats');
  const q = query(
    chatsRef,
    where('participantId', '==', user.uid),
    where('status', '==', 'open'),
    orderBy('lastActivity', 'desc'),
    limit(1),
  );
  const snap = await getDocs(q);
  const top = snap.docs[0];
  if (!top) return null;
  const data = top.data();
  return {
    chatId: top.id,
    triggerReason:
      (data.triggerReason as SupportChatTrigger | undefined) ?? null,
  };
}

/**
 * Send a follow-up. The Cloud Function persists the participant turn AND
 * the assistant reply, so callers can rely on the snapshot listener to
 * surface both — the returned reply is just the immediate API response,
 * not a separate render path.
 */
export async function sendSupportMessage(opts: {
  chatId: string;
  userMessage: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  trigger: SupportChatTrigger;
}): Promise<SupportChatResponse> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('Not signed in');
  return postChatRequest({
    participantId: user.uid,
    chatId: opts.chatId,
    userMessage: opts.userMessage,
    conversationHistory: opts.history,
    triggerReason: opts.trigger,
  });
}

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (ts as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  if (typeof ts === 'string') {
    const t = Date.parse(ts);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

/**
 * Live subscription to the participant's "currently active" support chat.
 *
 * Returns metadata about the most recent open chat (or null if none) plus
 * a count of researcher messages whose `timestamp` is newer than the local
 * lastReadAt cursor. The bubble component uses this to render a badge.
 *
 * The query is narrow (participantId == me, status == open, ORDER BY
 * lastActivity desc, limit 1) so it costs essentially nothing — Firestore
 * fans out at most one chat doc per user.
 */
export interface ActiveChatStatus {
  chatId: string | null;
  triggerReason: SupportChatTrigger | null;
  lastActivity: Date | null;
  unreadResearcherMessages: number;
}

export function subscribeToActiveChat(
  onUpdate: (status: ActiveChatStatus) => void,
  onError?: (err: Error) => void,
): () => void {
  const user = getAuth().currentUser;
  if (!user) {
    // No user — just emit an empty state and a noop unsubscribe.
    onUpdate({
      chatId: null,
      triggerReason: null,
      lastActivity: null,
      unreadResearcherMessages: 0,
    });
    return () => {};
  }

  let messagesUnsub: (() => void) | null = null;
  let activeChatId: string | null = null;

  const chatsRef = collection(db, 'supportChats');
  const q = query(
    chatsRef,
    where('participantId', '==', user.uid),
    where('status', '==', 'open'),
    orderBy('lastActivity', 'desc'),
    limit(1),
  );

  const chatsUnsub = onSnapshot(
    q,
    (snap) => {
      const top = snap.docs[0];
      const newChatId = top?.id ?? null;
      const data = top?.data();
      const triggerReason =
        (data?.triggerReason as SupportChatTrigger | undefined) ?? null;
      const lastActivity = tsToDate(data?.lastActivity);

      // If the active chat changed (or we lost it), tear down the old
      // messages listener and re-attach to the new one.
      if (newChatId !== activeChatId) {
        if (messagesUnsub) {
          messagesUnsub();
          messagesUnsub = null;
        }
        activeChatId = newChatId;

        if (newChatId) {
          const messagesRef = collection(
            doc(db, 'supportChats', newChatId),
            'messages',
          );
          const mq = query(
            messagesRef,
            where('role', '==', 'researcher'),
            orderBy('timestamp', 'desc'),
            limit(20),
          );
          messagesUnsub = onSnapshot(
            mq,
            (mSnap) => {
              const lastRead = readLastReadAt(newChatId);
              const unread = mSnap.docs.reduce((acc, d) => {
                const ts = tsToDate(d.data().timestamp);
                if (ts && ts.getTime() > lastRead) return acc + 1;
                return acc;
              }, 0);
              onUpdate({
                chatId: newChatId,
                triggerReason,
                lastActivity,
                unreadResearcherMessages: unread,
              });
            },
            (err) => {
              console.warn('[supportChat] researcher listener error', err);
              onError?.(err);
            },
          );
        } else {
          onUpdate({
            chatId: null,
            triggerReason: null,
            lastActivity: null,
            unreadResearcherMessages: 0,
          });
        }
      } else if (newChatId) {
        // Same chat, just bumped lastActivity — emit a refresh so the badge
        // can re-evaluate against the latest cursor.
        const lastRead = readLastReadAt(newChatId);
        onUpdate({
          chatId: newChatId,
          triggerReason,
          lastActivity,
          // `unreadResearcherMessages` is recomputed when the messages
          // listener fires; carry over a placeholder until then.
          unreadResearcherMessages: lastRead === 0 ? 0 : 0,
        });
      }
    },
    (err) => {
      console.warn('[supportChat] active-chat listener error', err);
      onError?.(err);
    },
  );

  return () => {
    if (messagesUnsub) messagesUnsub();
    chatsUnsub();
  };
}

/**
 * "Mark this chat as read up to now" — bumps a per-chat cursor in
 * AsyncStorage. The bubble component calls this after the user opens the
 * chat, so the unread badge clears.
 */
const READ_CURSOR_KEY = (chatId: string) => `@supportchat_lastread_${chatId}`;

let _AsyncStorage: any = null;
function getAsyncStorage(): any {
  if (_AsyncStorage) return _AsyncStorage;
  try {
    // Lazy require so this module stays tree-shakable on web.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _AsyncStorage = require('@react-native-async-storage/async-storage').default;
  } catch {
    _AsyncStorage = null;
  }
  return _AsyncStorage;
}

const _readCursorCache: Map<string, number> = new Map();

function readLastReadAt(chatId: string): number {
  const cached = _readCursorCache.get(chatId);
  if (cached != null) return cached;
  const storage = getAsyncStorage();
  if (!storage) return 0;
  // Best-effort sync read — AsyncStorage is async, so the first call seeds
  // the cache from disk and returns 0; subsequent calls within the same
  // session use the in-memory value.
  storage.getItem(READ_CURSOR_KEY(chatId)).then((raw: string | null) => {
    const n = raw ? Number(raw) : 0;
    _readCursorCache.set(chatId, Number.isFinite(n) ? n : 0);
  });
  _readCursorCache.set(chatId, 0);
  return 0;
}

export async function markChatRead(chatId: string): Promise<void> {
  const storage = getAsyncStorage();
  const now = Date.now();
  _readCursorCache.set(chatId, now);
  if (storage) {
    try {
      await storage.setItem(READ_CURSOR_KEY(chatId), String(now));
    } catch {
      // ignored — best-effort
    }
  }
}

/**
 * Live subscription to a chat's messages subcollection. Returns the
 * unsubscribe function; the caller is responsible for tearing it down on
 * unmount. Cancellation tokens (per CLAUDE.md "Critical Rules #4") are
 * unnecessary here because Firestore's onSnapshot already idempotently
 * delivers the latest snapshot once the listener is attached.
 */
export function subscribeToChat(
  chatId: string,
  onUpdate: (messages: SupportMessage[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const messagesRef = collection(doc(db, 'supportChats', chatId), 'messages');
  const q = query(messagesRef, orderBy('timestamp', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const messages: SupportMessage[] = snap.docs.map((d) => {
        const data = d.data();
        const role: SupportRole =
          data.role === 'assistant'
            ? 'assistant'
            : data.role === 'researcher'
              ? 'researcher'
              : 'participant';
        return {
          id: d.id,
          role,
          content: String(data.content ?? ''),
          timestamp: tsToDate(data.timestamp),
        };
      });
      onUpdate(messages);
    },
    (err) => {
      console.warn('[supportChat] snapshot error', err);
      onError?.(err);
    },
  );
}
