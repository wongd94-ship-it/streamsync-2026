import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Platform,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { useHealthSummary } from '@/hooks/use-health-summary';
import { SleepSection } from '@/components/health/SleepSection';
import { ActivitySection } from '@/components/health/ActivitySection';
import { VitalsSection } from '@/components/health/VitalsSection';
import { BphClinicalRecordsCard } from '@/components/health/BphClinicalRecordsCard';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { FontSize, FontWeight } from '@/lib/theme/typography';
import { syncSmartClinicalData } from '@/lib/services/smart';
import { db, getAuth } from '@/src/services/firestore';

type ClinicalNoteCard = {
  id: string;
  title: string;
  category: string;
  preview: string;
  dateLabel: string;
};

function formatClinicalNoteDate(value: unknown): string {
  const date =
    value instanceof Timestamp
      ? value.toDate()
      : value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
      ? new Date(value)
      : null;

  if (!date || Number.isNaN(date.getTime())) return 'Unknown date';

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function normalizeClinicalPreview(rawText: unknown, parsedText: unknown): string {
  const value =
    typeof rawText === 'string' && rawText.trim()
      ? rawText.trim()
      : typeof parsedText === 'string' && parsedText.trim()
      ? parsedText.trim()
      : '';

  return value.replace(/\s+/g, ' ');
}

export default function HealthScreen() {
  const { theme } = useAppTheme();
  const { colors: c } = theme;

  if (Platform.OS !== 'ios') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: c.textTertiary }]}>
            Health data is available on iPhone
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return <HealthContent />;
}

function HealthContent() {
  const { theme } = useAppTheme();
  const { colors: c } = theme;
  const { summary, isLoading, error } = useHealthSummary();
  const [clinicalNotes, setClinicalNotes] = useState<ClinicalNoteCard[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [hasConnectedProvider, setHasConnectedProvider] = useState(false);
  const [connectedProviderId, setConnectedProviderId] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);

  useEffect(() => {
    const uid = getAuth().currentUser?.uid;
    if (!uid) {
      setClinicalNotes([]);
      setNotesLoading(false);
      setHasConnectedProvider(false);
      return;
    }

    const notesQuery = query(
      collection(db, 'users', uid, 'clinical_notes'),
      orderBy('startDate', 'desc'),
      limit(20),
    );
    const providerQuery = query(
      collection(db, 'users', uid, 'provider_connections'),
      where('status', '==', 'connected'),
      limit(1),
    );

    const unsubscribeNotes = onSnapshot(
      notesQuery,
      (snapshot) => {
        const nextNotes = snapshot.docs.map((doc) => {
          const data = doc.data() as Record<string, unknown>;
          const title =
            typeof data.title === 'string' && data.title.trim()
              ? data.title.trim()
              : typeof data.displayName === 'string' && data.displayName.trim()
              ? data.displayName.trim()
              : 'Clinical Note';
          const category =
            typeof data.displayName === 'string' && data.displayName.trim()
              ? data.displayName.trim()
              : 'Clinical Note';

          return {
            id: doc.id,
            title,
            category,
            preview: normalizeClinicalPreview(data.rawText, data.parsedText),
            dateLabel: formatClinicalNoteDate(
              data.startDate ?? data.endDate ?? data.uploadedAt,
            ),
          };
        });

        setClinicalNotes(nextNotes);
        setNotesLoading(false);
      },
      () => {
        setClinicalNotes([]);
        setNotesLoading(false);
      },
    );

    const unsubscribeProviders = onSnapshot(providerQuery, (snapshot) => {
      setHasConnectedProvider(!snapshot.empty);
      setConnectedProviderId(snapshot.empty ? null : snapshot.docs[0].id);
    });

    return () => {
      unsubscribeNotes();
      unsubscribeProviders();
    };
  }, []);

  const notesEmptyText = useMemo(() => {
    if (notesLoading) return '';
    return 'No clinical notes available yet.';
  }, [notesLoading]);

  async function handleForceResync() {
    if (!connectedProviderId || resyncing) return;

    setResyncing(true);
    try {
      const result = await syncSmartClinicalData(connectedProviderId);
      if (result.syncIssues?.length) {
        const issueSummary = result.syncIssues
          .map((issue) => `${issue.resourceType}: ${issue.error}`)
          .join('\n');
        throw new Error(issueSummary);
      }
      Alert.alert('SMART Sync Complete', 'Clinical records were re-synced successfully.');
    } catch (resyncError) {
      Alert.alert(
        'SMART Sync Failed',
        resyncError instanceof Error ? resyncError.message : 'Please try again.',
      );
    } finally {
      setResyncing(false);
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#8E8E93" />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: c.textTertiary }]}>
            {error}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!summary) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: c.textTertiary }]}>
            No health data available yet. Check back after your devices have synced more data.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.dateLabel, { color: c.textTertiary }]}>
          {summary.dateLabel}
        </Text>
        <Text style={[styles.greeting, { color: c.textPrimary }]}>
          {summary.greeting}
        </Text>

        <View style={styles.spacerLarge} />

        {summary.sleep && <SleepSection insight={summary.sleep} />}

        <View style={styles.spacerMedium} />

        {summary.activity && <ActivitySection insight={summary.activity} />}

        <View style={styles.spacerMedium} />

        {summary.vitals && <VitalsSection insight={summary.vitals} />}

        <View style={styles.spacerMedium} />

        {/* BPH-relevant medications, conditions, procedures — read from
            users/{uid}/medical_history/current; participant can edit
            inline. Audit fields stamped on every save. */}
        <BphClinicalRecordsCard />

        <View style={styles.spacerMedium} />

        <View style={[styles.notesCard, { backgroundColor: c.card }]}>
          <View style={styles.notesHeader}>
            <View style={styles.notesHeaderLeft}>
              <IconSymbol name="doc.text.fill" size={17} color={c.accent} />
              <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
                Clinical Notes
              </Text>
            </View>
          </View>

          {notesLoading ? (
            <View style={styles.notesLoading}>
              <ActivityIndicator size="small" color={c.textTertiary} />
            </View>
          ) : clinicalNotes.length > 0 ? (
            <View style={styles.notesList}>
              {clinicalNotes.map((note, index) => (
                <View
                  key={note.id}
                  style={[
                    styles.noteRow,
                    index < clinicalNotes.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: c.separator,
                    },
                  ]}
                >
                  <View style={styles.noteRowTop}>
                    <Text style={[styles.noteTitle, { color: c.textPrimary }]}>
                      {note.title}
                    </Text>
                    <Text style={[styles.noteDate, { color: c.textTertiary }]}>
                      {note.dateLabel}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.noteBadge,
                      { backgroundColor: c.secondaryFill },
                    ]}
                  >
                    <Text style={[styles.noteBadgeText, { color: c.textSecondary }]}>
                      {note.category}
                    </Text>
                  </View>

                  <Text
                    style={[styles.notePreview, { color: c.textSecondary }]}
                    numberOfLines={2}
                  >
                    {note.preview || 'No preview available.'}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.noteEmptyText, { color: c.textTertiary }]}>
              {notesEmptyText}
            </Text>
          )}

          {__DEV__ && hasConnectedProvider && connectedProviderId ? (
            <TouchableOpacity
              activeOpacity={0.7}
              style={[
                styles.connectButton,
                styles.forceResyncButton,
                { backgroundColor: c.secondaryFill },
              ]}
              onPress={handleForceResync}
              disabled={resyncing}
            >
              <Text style={[styles.forceResyncButtonText, { color: c.textPrimary }]}>
                {resyncing ? 'Re-syncing…' : 'Force Resync'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.spacerBottom} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    // Clears the absolute-positioned liquid-glass tab bar.
    paddingBottom: 120,
  },
  dateLabel: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.regular,
    marginBottom: 2,
  },
  greeting: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.37,
  },
  sectionLabel: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.2,
  },
  emptyText: {
    fontSize: FontSize.subhead,
    textAlign: 'center',
    lineHeight: 22,
  },
  notesCard: {
    borderRadius: 12,
    padding: 16,
  },
  notesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  notesHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notesLoading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  notesList: {
    marginTop: 4,
  },
  noteRow: {
    paddingVertical: 12,
  },
  noteRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  noteTitle: {
    flex: 1,
    fontSize: FontSize.titleSmall,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.38,
  },
  noteDate: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
  },
  noteBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  noteBadgeText: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semibold,
  },
  notePreview: {
    fontSize: FontSize.subhead,
    lineHeight: 22,
  },
  noteEmptyText: {
    fontSize: FontSize.subhead,
    lineHeight: 22,
    marginTop: 4,
  },
  connectButton: {
    marginTop: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  connectButtonText: {
    color: '#FFFFFF',
    fontSize: FontSize.subhead,
    fontWeight: FontWeight.semibold,
  },
  forceResyncButton: {
    marginTop: 12,
  },
  forceResyncButtonText: {
    fontSize: FontSize.subhead,
    fontWeight: FontWeight.semibold,
  },
  spacerLarge: {
    height: 20,
  },
  spacerMedium: {
    height: 12,
  },
  spacerBottom: {
    height: 32,
  },
});
