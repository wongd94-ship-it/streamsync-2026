/**
 * AI Support Chat Screen
 *
 * Opens when a participant taps a sync-alert push notification (or via the
 * "Get Help" entry in profile). The opening message comes from Claude — the
 * Cloud Function reads the participant's last sync timestamps and returns a
 * device-specific greeting that asks ONE open-ended question. Troubleshooting
 * only begins after the participant responds.
 *
 * Researcher messages flow back through the same Firestore subcollection in
 * real time; the snapshot listener surfaces them with a "RESEARCH TEAM" tag.
 *
 * Banner data freshness — the sync-status banner at the top is driven by a
 * LIVE Firestore subscription to `users/{uid}/throne_sync/state` and the
 * `users/{uid}/hk_sync/*` collection (the same paths the Cloud Function
 * reads). This means the banner reflects fresh sync data as soon as the
 * iPhone writes it, not a stale snapshot baked in at chat open. An earlier
 * version relied on the `context` from `startSupportChat` and only refreshed
 * on every send, which produced the "banner says 29h, chat says 6m" mismatch.
 *
 * Keyboard handling — we listen to `Keyboard.willShow` / `Keyboard.willHide`
 * directly and animate a single Animated.Value with the keyboard's own
 * duration + curve. KeyboardAvoidingView's `padding` behavior has a known
 * ~50ms lag against the keyboard slide-up on iOS that produced a visible
 * gap; the manual approach matches the system animation frame-for-frame.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  type KeyboardEvent,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LiquidGlassBackdrop } from '@/components/ui/LiquidGlassBackdrop';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  collection,
  doc,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { STUDY_INFO } from '@/lib/constants';
import { db, getAuth } from '@/src/services/firestore';
import {
  findActiveChat,
  startSupportChat,
  sendSupportMessage,
  subscribeToChat,
  markChatRead,
  type SupportChatTrigger,
  type SupportMessage,
} from '@/lib/services/support-chat-service';

const ACCENT = '#22D3EE';
const ACCENT_DARK = '#0891B2';
const DEFAULT_THRESHOLD_HOURS = 48;

function asTrigger(value: unknown): SupportChatTrigger {
  if (value === '48h-alert' || value === '5d-alert' || value === 'participant-initiated') {
    return value;
  }
  return 'participant-initiated';
}

// ─── Live banner state ──────────────────────────────────────────────────

interface LiveBannerState {
  /** True when at least one signal has been read from Firestore. */
  ready: boolean;
  throneIssue: boolean;
  appleIssue: boolean;
  lastThroneMs: number | null;
  lastAppleHealthMs: number | null;
  thresholdHours: number;
}

const EMPTY_BANNER: LiveBannerState = {
  ready: false,
  throneIssue: false,
  appleIssue: false,
  lastThroneMs: null,
  lastAppleHealthMs: null,
  thresholdHours: DEFAULT_THRESHOLD_HOURS,
};

function tsToMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().getTime();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().getTime();
    } catch {
      return null;
    }
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function formatRelativeFromMs(ms: number | null, now: number): string {
  if (ms == null) return 'no data yet';
  const diff = now - ms;
  if (diff < 0) return 'just now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function bannerLabel(state: LiveBannerState): string | null {
  if (!state.ready) return null;
  if (state.throneIssue && state.appleIssue) return 'Sync alert · Throne + Apple Health';
  if (state.throneIssue) return 'Sync alert · Throne device';
  if (state.appleIssue) return 'Sync alert · Apple Health';
  return null;
}

function bannerSubtitle(state: LiveBannerState, now: number): string {
  const throne = formatRelativeFromMs(state.lastThroneMs, now);
  const apple = formatRelativeFromMs(state.lastAppleHealthMs, now);
  if (state.throneIssue && !state.appleIssue) return `Last Throne sync: ${throne}.`;
  if (state.appleIssue && !state.throneIssue) return `Last Apple Health sync: ${apple}.`;
  return `Throne: ${throne} · Apple: ${apple}.`;
}

// ─── Per-message timestamp formatting ───────────────────────────────────

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function formatMessageTime(when: Date | null, now: Date): string {
  if (!when) return '';
  const todayStart = startOfDay(now);
  const whenStart = startOfDay(when);
  const daysAgo = Math.round((todayStart - whenStart) / 86_400_000);
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (daysAgo === 0) return time;
  if (daysAgo === 1) return `Yesterday ${time}`;
  if (daysAgo > 1 && daysAgo < 7) {
    return `${when.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  }
  return `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

function formatDayDivider(when: Date, now: Date): string {
  const todayStart = startOfDay(now);
  const whenStart = startOfDay(when);
  const daysAgo = Math.round((todayStart - whenStart) / 86_400_000);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo > 1 && daysAgo < 7) {
    return when.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return when.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

// ─── Typing dots animation ──────────────────────────────────────────────

function TypingDots({ color }: { color: string }) {
  const dots = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(dot, {
            toValue: 1,
            duration: 360,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 360,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [dots]);
  return (
    <View style={styles.typingRow}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.typingDot,
            {
              backgroundColor: color,
              transform: [
                {
                  translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }),
                },
              ],
              opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
            },
          ]}
        />
      ))}
    </View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────

export default function SupportChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ trigger?: string }>();
  const { theme } = useAppTheme();
  const { isDark, colors: c } = theme;

  const insets = useSafeAreaInsets();
  const trigger = useMemo(() => asTrigger(params.trigger), [params.trigger]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [bannerState, setBannerState] = useState<LiveBannerState>(EMPTY_BANNER);
  const [input, setInput] = useState('');
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [opening, setOpening] = useState(true);
  const [openAttempt, setOpenAttempt] = useState(0);
  // Tick once a minute so the relative-time strings refresh without waiting
  // on a Firestore write.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const scrollRef = useRef<ScrollView | null>(null);

  // ─── Live banner subscription ───────────────────────────────────────
  // Mirrors the same Firestore reads the Cloud Function does, so the
  // banner reflects fresh data within seconds of the iPhone writing it.
  useEffect(() => {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;

    let throneMs: number | null = null;
    let appleMs: number | null = null;
    let thresholdHours = DEFAULT_THRESHOLD_HOURS;

    const recompute = () => {
      const thresholdMs = thresholdHours * 60 * 60 * 1000;
      const now = Date.now();
      const throneIssue =
        throneMs == null ? true : now - throneMs > thresholdMs;
      const appleIssue =
        appleMs == null ? true : now - appleMs > thresholdMs;
      setBannerState({
        ready: true,
        throneIssue,
        appleIssue,
        lastThroneMs: throneMs,
        lastAppleHealthMs: appleMs,
        thresholdHours,
      });
    };

    const throneUnsub = onSnapshot(
      doc(db, 'users', uid, 'throne_sync', 'state'),
      (snap) => {
        const data = snap.data();
        throneMs = tsToMs(data?.lastVoidAt) ?? tsToMs(data?.lastRunAt);
        recompute();
      },
      (err) => console.warn('[support-chat] throne_sync listener error', err.message),
    );

    const hkUnsub = onSnapshot(
      collection(db, 'users', uid, 'hk_sync'),
      (snap) => {
        let latest: number | null = null;
        snap.forEach((d) => {
          const ts = tsToMs(d.data()?.lastSyncedAt);
          if (ts != null && (latest == null || ts > latest)) latest = ts;
        });
        appleMs = latest;
        recompute();
      },
      (err) => console.warn('[support-chat] hk_sync listener error', err.message),
    );

    // Researcher-tunable threshold. Patients may lack read access — silently
    // fall back to the default.
    const cfgUnsub = onSnapshot(
      doc(db, 'config', 'support_chat'),
      (snap) => {
        const raw = snap.exists() ? snap.data()?.syncThresholdHours : null;
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0 && n <= 720) {
          thresholdHours = n;
          recompute();
        }
      },
      () => {
        // Quiet — read-permission denied is expected for participants.
      },
    );

    return () => {
      throneUnsub();
      hkUnsub();
      cfgUnsub();
    };
  }, []);

  // ─── Manual keyboard animation ──────────────────────────────────────
  // KeyboardAvoidingView's `padding` behavior on iOS animates with a default
  // timing that doesn't match the keyboard's actual slide-up, producing a
  // visible lag. We listen to the keyboard events directly and reuse the
  // event's reported duration + curve so the input bar tracks the keyboard
  // frame-for-frame.
  const keyboardHeight = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const onShow = (event: KeyboardEvent) => {
      Animated.timing(keyboardHeight, {
        toValue: Math.max(0, event.endCoordinates.height - insets.bottom),
        duration: event.duration ?? 250,
        easing: Easing.bezier(0.17, 0.59, 0.4, 0.77),
        useNativeDriver: false,
      }).start();
    };
    const onHide = (event: KeyboardEvent) => {
      Animated.timing(keyboardHeight, {
        toValue: 0,
        duration: event.duration ?? 250,
        easing: Easing.bezier(0.17, 0.59, 0.4, 0.77),
        useNativeDriver: false,
      }).start();
    };
    const showSub = Keyboard.addListener('keyboardWillShow', onShow);
    const hideSub = Keyboard.addListener('keyboardWillHide', onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardHeight, insets.bottom]);

  // ─── Open or resume the chat ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setOpening(true);
    setOpeningError(null);

    (async () => {
      let existing: Awaited<ReturnType<typeof findActiveChat>> = null;
      try {
        existing = await findActiveChat();
      } catch (err) {
        console.warn('[support-chat] findActiveChat failed; falling through to fresh chat', err);
      }
      if (cancelled) return;

      if (existing) {
        setChatId(existing.chatId);
        setOpening(false);
        return;
      }

      try {
        const res = await startSupportChat(trigger);
        if (cancelled) return;
        setChatId(res.chatId);
        setMessages([
          {
            id: `__opening__`,
            role: 'assistant',
            content: res.reply,
            timestamp: new Date(),
          },
        ]);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[support-chat] startSupportChat failed', detail, err);
        if (!cancelled) setOpeningError(detail);
      } finally {
        if (!cancelled) setOpening(false);
      }
    })();

    return () => { cancelled = true; };
  }, [trigger, openAttempt]);

  // ─── Messages subscription ──────────────────────────────────────────
  useEffect(() => {
    if (!chatId) return;
    markChatRead(chatId).catch(() => {});
    const unsub = subscribeToChat(
      chatId,
      (next) => {
        if (next.length > 0) setMessages(next);
        markChatRead(chatId).catch(() => {});
      },
      (err) => console.warn('[support-chat] snapshot error', err.message),
    );
    return unsub;
  }, [chatId]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length, sending]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !chatId || sending) return;

    setInput('');
    setSending(true);

    const optimistic: SupportMessage = {
      id: `__optimistic__${Date.now()}`,
      role: 'participant',
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const history = messages
        .filter((m) => m.role !== 'researcher')
        .map((m) => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: m.content,
        }));
      await sendSupportMessage({
        chatId,
        userMessage: text,
        history,
        trigger,
      });
      // The banner refreshes on its own via the Firestore subscription —
      // no need to forward the response context anymore.
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `__error__${Date.now()}`,
          role: 'assistant',
          content:
            `I'm having trouble reaching support right now. Please try again in a moment, or email ${STUDY_INFO.contactEmail}.`,
          timestamp: new Date(),
        },
      ]);
      console.warn('[support-chat] send error', err);
    } finally {
      setSending(false);
    }
  }, [chatId, input, messages, sending, trigger]);

  const banner = bannerLabel(bannerState);
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  // Compute day-divider headers + per-message timestamps so the renderer is
  // a flat map. Each entry is either `{ kind: 'day', date }` or `{ kind: 'msg',
  // message }`.
  type Row = { kind: 'day'; key: string; label: string } | { kind: 'msg'; message: SupportMessage };
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    let lastDayKey: string | null = null;
    for (const m of messages) {
      if (m.timestamp) {
        const key = `${m.timestamp.getFullYear()}-${m.timestamp.getMonth()}-${m.timestamp.getDate()}`;
        if (key !== lastDayKey) {
          out.push({ kind: 'day', key: `day-${key}`, label: formatDayDivider(m.timestamp, now) });
          lastDayKey = key;
        }
      }
      out.push({ kind: 'msg', message: m });
    }
    return out;
  }, [messages, now]);

  // The bottom inset reserved for the input bar (and home-indicator padding)
  // + the keyboard-driven animated offset. Both ScrollView and bottom UI use
  // it to stay above the keyboard without lag.
  const inputBarBottomPad = Math.max(insets.bottom, 8);

    <View style={[styles.root, { backgroundColor: c.background }]}>
      <LiquidGlassBackdrop variant="chat" />
      <SafeAreaView style={styles.root} edges={['left', 'right']}>
      {/* Top nav.
          Minimum 44pt height + 12pt horizontal floor protects the back button
          from rounded corners / Dynamic Island / a brief 0-inset render
          during the modal slide-in animation. */}
      <View
        style={[
          styles.navBar,
          {
            backgroundColor: c.card,
            borderBottomColor: c.separator,
            paddingTop: Math.max(insets.top, 8),
            paddingLeft: Math.max(insets.left, 12),
            paddingRight: Math.max(insets.right, 12),
          },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.navBack} hitSlop={16}>
          <IconSymbol name="chevron.left" size={22} color={c.accent} />
          <Text style={[styles.navBackLabel, { color: c.accent }]}>Back</Text>
        </TouchableOpacity>
        <View style={styles.navTitleWrap}>
          <View style={styles.navAvatar}>
            <Text style={styles.navAvatarText}>S</Text>
          </View>
          <View style={styles.navTitleTextWrap}>
            <Text style={[styles.navTitle, { color: c.textPrimary }]}>StreamSync Support</Text>
            <Text style={[styles.navSubtitle, { color: c.textTertiary }]}>AI Assistant · Online</Text>
          </View>
        </View>
        {/* Right-side spacer to keep the title visually centered. */}
        <View style={styles.navBack} />
      </View>

      {/* Content column — its own flex container; the keyboard offset is
          applied as paddingBottom on this view, not via KeyboardAvoidingView. */}
      <Animated.View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        {banner && (
          <View style={[styles.banner, { backgroundColor: isDark ? '#3A2A0E' : '#FFF8E7', borderColor: '#F59E0B55' }]}>
            <Text style={styles.bannerIcon}>⚠️</Text>
            <View style={styles.flex}>
              <Text style={[styles.bannerTitle, { color: isDark ? '#FCD34D' : '#92400E' }]}>{banner}</Text>
              <Text style={[styles.bannerText, { color: isDark ? '#FDE68A' : '#78350F' }]}>
                {bannerSubtitle(bannerState, nowMs)} Let&apos;s get this sorted out together.
              </Text>
            </View>
          </View>
        )}

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messagesContent}
          // `interactive` lets the user drag the keyboard down with a finger.
          // `on-drag` would dismiss on any scroll, which feels too aggressive
          // in a chat (small drift while reading hides the keyboard).
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          // Tap the empty area between bubbles → keyboard dismisses instantly.
          // Bubbles themselves have their own touch handlers (none right now,
          // but `keyboardShouldPersistTaps="handled"` means future bubble
          // taps will register without bouncing the keyboard).
          onScrollBeginDrag={() => Keyboard.dismiss()}
        >
          {opening && (
            <View style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
              <View style={[styles.bubble, styles.bubbleAssistant, { backgroundColor: c.card }]}>
                <ActivityIndicator size="small" color={c.textTertiary} />
              </View>
            </View>
          )}

          {openingError && (
            <View style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
              <View style={[styles.bubble, styles.bubbleAssistant, { backgroundColor: c.card }]}>
                <Text style={[styles.bubbleText, { color: c.textPrimary }]}>
                  We couldn&apos;t reach support just now. Please try again, or email {STUDY_INFO.contactEmail}.
                </Text>
                <Text style={[styles.bubbleDiag, { color: c.textTertiary }]}>
                  {openingError}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setOpeningError(null);
                    setOpenAttempt((n) => n + 1);
                  }}
                  style={[styles.retryBtn, { borderColor: c.accent }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.retryBtnText, { color: c.accent }]}>Try again</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {rows.map((row) => {
            if (row.kind === 'day') {
              return (
                <Text key={row.key} style={[styles.dayDivider, { color: c.textTertiary }]}>
                  {row.label}
                </Text>
              );
            }
            const m = row.message;
            const timeLabel = formatMessageTime(m.timestamp, now);
            if (m.role === 'participant') {
              return (
                <View key={m.id} style={[styles.bubbleRow, { justifyContent: 'flex-end' }]}>
                  {/* Timestamp pulled to the LEFT side (opposite the bubble). */}
                  {!!timeLabel && (
                    <Text style={[styles.timestampLeft, { color: c.textTertiary }]}>{timeLabel}</Text>
                  )}
                  <View style={[styles.bubble, styles.bubbleUser]}>
                    <Text style={[styles.bubbleText, { color: '#fff' }]}>{m.content}</Text>
                  </View>
                </View>
              );
            }
            if (m.role === 'researcher') {
              return (
                <View key={m.id} style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
                  <View style={[styles.bubble, styles.bubbleResearcher]}>
                    <Text style={styles.researcherTag}>RESEARCH TEAM</Text>
                    <Text style={[styles.bubbleText, { color: '#000' }]}>{m.content}</Text>
                  </View>
                  {!!timeLabel && (
                    <Text style={[styles.timestampRight, { color: c.textTertiary }]}>{timeLabel}</Text>
                  )}
                </View>
              );
            }
            return (
              <View key={m.id} style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
                <View style={[styles.bubble, styles.bubbleAssistant, { backgroundColor: c.card }]}>
                  <Text style={[styles.bubbleText, { color: c.textPrimary }]}>{m.content}</Text>
                </View>
                {!!timeLabel && (
                  <Text style={[styles.timestampRight, { color: c.textTertiary }]}>{timeLabel}</Text>
                )}
              </View>
            );
          })}

          {sending && (
            <View style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
              <View style={[styles.bubble, styles.bubbleAssistant, { backgroundColor: c.card }]}>
                <TypingDots color={c.textTertiary} />
              </View>
            </View>
          )}
        </ScrollView>

        {/* Input bar — sits at the bottom of the content column.
            The keyboardHeight animated paddingBottom on the parent lifts
            this whole column above the keyboard. */}
        <Pressable
          onPress={() => {}}
          style={[
            styles.inputBar,
            {
              backgroundColor: c.card,
              borderTopColor: c.separator,
              paddingBottom: inputBarBottomPad,
            },
          ]}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Message"
            placeholderTextColor={c.textTertiary}
            style={[
              styles.input,
              {
                color: c.textPrimary,
                backgroundColor: c.background,
                borderColor: c.separator,
              },
            ]}
            multiline
            editable={!opening && !openingError}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!input.trim() || sending || opening}
            style={[
              styles.sendBtn,
              {
                backgroundColor:
                  !input.trim() || sending || opening ? c.secondaryFill : ACCENT,
              },
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Text style={[styles.sendBtnText, { color: '#fff' }]}>↑</Text>
          </TouchableOpacity>
        </Pressable>
      </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  navBar: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  navBack: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 80,
  },
  navBackLabel: { fontSize: 17, fontWeight: '400' },
  navTitleWrap: {
    flex: 1,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  navTitleTextWrap: { alignItems: 'flex-start' },
  navAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: ACCENT_DARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navAvatarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  navTitle: { fontSize: 14, fontWeight: '600' },
  navSubtitle: { fontSize: 11, fontWeight: '400', marginTop: 1 },
  banner: {
    margin: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bannerIcon: { fontSize: 18 },
  bannerTitle: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  bannerText: { fontSize: 12, lineHeight: 16 },
  messagesContent: {
    padding: 12,
    paddingBottom: 24,
  },
  dayDivider: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    marginVertical: 14,
    letterSpacing: 0.4,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '74%',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  bubbleUser: {
    backgroundColor: ACCENT_DARK,
  },
  bubbleAssistant: {
    // backgroundColor set inline from theme.card
  },
  bubbleResearcher: {
    backgroundColor: '#E8F4FB',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#22D3EE66',
  },
  researcherTag: {
    fontSize: 10,
    fontWeight: '700',
    color: ACCENT_DARK,
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleDiag: { fontSize: 11, lineHeight: 14, marginTop: 6, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  // Timestamps sit to the side of the bubble, vertically aligned to its
  // bottom (matches iMessage's "long press to see time" style but always-
  // visible). Constrained max width so they don't push bubbles around when
  // a long-format time is rendered.
  timestampLeft: {
    fontSize: 10,
    marginRight: 8,
    marginBottom: 2,
    maxWidth: 110,
    textAlign: 'right',
  },
  timestampRight: {
    fontSize: 10,
    marginLeft: 8,
    marginBottom: 2,
    maxWidth: 110,
    textAlign: 'left',
  },
  retryBtn: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 14,
    alignSelf: 'flex-start',
  },
  retryBtnText: { fontSize: 13, fontWeight: '600' },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 4 },
  typingDot: { width: 6, height: 6, borderRadius: 3 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 17,
    lineHeight: 22,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { fontSize: 22, fontWeight: '700', lineHeight: 22 },
});
