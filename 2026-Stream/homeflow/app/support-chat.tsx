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
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { STUDY_INFO } from '@/lib/constants';
import {
  findActiveChat,
  startSupportChat,
  sendSupportMessage,
  subscribeToChat,
  markChatRead,
  type SupportChatTrigger,
  type SupportContextSnapshot,
  type SupportMessage,
} from '@/lib/services/support-chat-service';

const ACCENT = '#22D3EE';
const ACCENT_DARK = '#0891B2';

function asTrigger(value: unknown): SupportChatTrigger {
  if (value === '48h-alert' || value === '5d-alert' || value === 'participant-initiated') {
    return value;
  }
  return 'participant-initiated';
}

function bannerLabel(ctx: SupportContextSnapshot | null): string | null {
  if (!ctx) return null;
  if (ctx.throneIssue && ctx.appleIssue) return 'Sync alert · Throne + Apple Health';
  if (ctx.throneIssue) return 'Sync alert · Throne device';
  if (ctx.appleIssue) return 'Sync alert · Apple Health';
  return null;
}

function bannerSubtitle(ctx: SupportContextSnapshot | null): string {
  if (!ctx) return '';
  if (ctx.throneIssue && !ctx.appleIssue) {
    return `Last Throne sync: ${ctx.lastThroneSyncRel}.`;
  }
  if (ctx.appleIssue && !ctx.throneIssue) {
    return `Last Apple Health sync: ${ctx.lastAppleHealthSyncRel}.`;
  }
  return `Throne: ${ctx.lastThroneSyncRel} · Apple: ${ctx.lastAppleHealthSyncRel}.`;
}

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

export default function SupportChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ trigger?: string }>();
  const { theme } = useAppTheme();
  const { isDark, colors: c } = theme;

  const insets = useSafeAreaInsets();
  const trigger = useMemo(() => asTrigger(params.trigger), [params.trigger]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [context, setContext] = useState<SupportContextSnapshot | null>(null);
  const [input, setInput] = useState('');
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [opening, setOpening] = useState(true);
  // Bumping this re-runs the open effect (used by the inline Retry button on
  // openingError). Avoids forcing the user to leave the screen and re-enter.
  const [openAttempt, setOpenAttempt] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);

  // Open or resume the chat exactly once on mount.
  //
  // Decision tree:
  //   1. Try to find an existing OPEN chat for this participant (e.g. one a
  //      researcher started from the dashboard, or a still-active sync-alert
  //      thread). If found, resume it.
  //   2. Otherwise — OR if the lookup itself errors (index still building,
  //      transient network blip, etc.) — ask Claude to open a fresh chat.
  //      The lookup MUST be non-fatal, because the worst-case outcome of a
  //      stale lookup is a duplicate chat (still works), but a fatal lookup
  //      means the user can never reach support.
  //
  // Cancellation token per CLAUDE.md critical rule #4.
  useEffect(() => {
    let cancelled = false;
    setOpening(true);
    setOpeningError(null);

    (async () => {
      // Step 1: best-effort lookup of the resume target.
      let existing: Awaited<ReturnType<typeof findActiveChat>> = null;
      try {
        existing = await findActiveChat();
      } catch (err) {
        // Don't block the user — log and fall through to startSupportChat.
        console.warn('[support-chat] findActiveChat failed; falling through to fresh chat', err);
      }
      if (cancelled) return;

      if (existing) {
        // Resume — the snapshot listener will populate messages.
        setChatId(existing.chatId);
        setOpening(false);
        return;
      }

      // Step 2: open a brand-new chat via the Cloud Function.
      try {
        const res = await startSupportChat(trigger);
        if (cancelled) return;
        setChatId(res.chatId);
        setContext(res.context);
        setMessages([
          {
            id: `__opening__`,
            role: 'assistant',
            content: res.reply,
            timestamp: new Date(),
          },
        ]);
      } catch (err) {
        // This IS fatal — the chat couldn't be opened at all. Surface a
        // plain message, but keep the actual error in the dev console for
        // debugging.
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[support-chat] startSupportChat failed', detail, err);
        if (!cancelled) setOpeningError(detail);
      } finally {
        if (!cancelled) setOpening(false);
      }
    })();

    return () => { cancelled = true; };
  }, [trigger, openAttempt]);

  // Subscribe to the messages subcollection as soon as we have a chatId.
  // Once Firestore returns at least one server-stamped message, we replace
  // the optimistic opening seed. Also marks the chat read on every snapshot
  // so the floating bubble's badge clears immediately.
  useEffect(() => {
    if (!chatId) return;
    markChatRead(chatId).catch(() => {});
    const unsub = subscribeToChat(
      chatId,
      (next) => {
        if (next.length > 0) setMessages(next);
        // Re-mark on each snapshot — covers the case where a researcher
        // message lands while the chat is open in the foreground.
        markChatRead(chatId).catch(() => {});
      },
      (err) => console.warn('[support-chat] snapshot error', err.message),
    );
    return unsub;
  }, [chatId]);

  // Auto-scroll to bottom when new messages arrive.
  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length, sending]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !chatId || sending) return;

    setInput('');
    setSending(true);

    // Optimistic participant bubble — Firestore snapshot will overwrite
    // with the server-stamped doc. Use a sentinel id so React can match
    // up rerenders without flicker.
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
      const res = await sendSupportMessage({
        chatId,
        userMessage: text,
        history,
        trigger,
      });
      // Latest context for the banner.
      setContext(res.context);
    } catch (err) {
      // Surface a one-line apology bubble — never a stack trace per the guide.
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

  const banner = bannerLabel(context);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
      {/* Top nav */}
      <View style={[styles.navBar, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.navBack} hitSlop={12}>
          <IconSymbol name="chevron.left" size={20} color={c.accent} />
          <Text style={[styles.navBackLabel, { color: c.accent }]}>Back</Text>
        </TouchableOpacity>
        <View style={styles.navTitleWrap}>
          <View style={styles.navAvatar}>
            <Text style={styles.navAvatarText}>S</Text>
          </View>
          <Text style={[styles.navTitle, { color: c.textPrimary }]}>StreamSync Support</Text>
          <Text style={[styles.navSubtitle, { color: c.textTertiary }]}>AI Assistant · Online</Text>
        </View>
        <View style={styles.navBack} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        // The screen is a modal — its content frame already starts at the
        // modal's top, not the window's top, so the keyboard's reported
        // height is correct as-is. A non-zero offset here (e.g. insets.top)
        // produced a visible gap between the input bar and the keyboard.
        keyboardVerticalOffset={0}
      >
        {banner && (
          <View style={[styles.banner, { backgroundColor: isDark ? '#3A2A0E' : '#FFF8E7', borderColor: '#F59E0B55' }]}>
            <Text style={styles.bannerIcon}>⚠️</Text>
            <View style={styles.flex}>
              <Text style={[styles.bannerTitle, { color: isDark ? '#FCD34D' : '#92400E' }]}>{banner}</Text>
              <Text style={[styles.bannerText, { color: isDark ? '#FDE68A' : '#78350F' }]}>
                {bannerSubtitle(context)} Let&apos;s get this sorted out together.
              </Text>
            </View>
          </View>
        )}

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.dayHeader, { color: c.textTertiary }]}>StreamSync Support · Today</Text>

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
                {/* Tiny diagnostic line so the actual failure reason is visible on
                    Release builds where there's no Metro console. Safe to leave —
                    it carries a server status and a short message, never a stack
                    trace and never PHI. */}
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

          {messages.map((m) => {
            if (m.role === 'participant') {
              return (
                <View key={m.id} style={[styles.bubbleRow, { justifyContent: 'flex-end' }]}>
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
                </View>
              );
            }
            return (
              <View key={m.id} style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
                <View style={[styles.bubble, styles.bubbleAssistant, { backgroundColor: c.card }]}>
                  <Text style={[styles.bubbleText, { color: c.textPrimary }]}>{m.content}</Text>
                </View>
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

        {/* Input bar.
            paddingBottom = insets.bottom — pushes content above the home
            indicator and the curved screen corners. KeyboardAvoidingView
            handles the keyboard slide-up; this just covers the resting case. */}
        <View
          style={[
            styles.inputBar,
            {
              backgroundColor: c.card,
              borderTopColor: c.separator,
              paddingBottom: Math.max(insets.bottom, 8),
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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  navBar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  navBack: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 80,
  },
  navBackLabel: { fontSize: 17, fontWeight: '400' },
  navTitleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  navAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ACCENT_DARK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  navAvatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  navTitle: { fontSize: 13, fontWeight: '600' },
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
  dayHeader: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 10,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  bubble: {
    maxWidth: '78%',
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
    // paddingBottom is set inline using safe-area inset so the input
    // sits above the home indicator on devices that have one.
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
