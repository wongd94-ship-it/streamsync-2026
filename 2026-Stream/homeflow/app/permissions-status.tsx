/**
 * Data Permissions status screen
 *
 * Replaces the text-only Data Permissions modal from the Profile tab with
 * a per-HealthKit-type status matrix. For each type we show:
 *   - Current authorizationStatusFor() value (unreliable for reads — see
 *     the hook doc comment) for logging parity.
 *   - A 7-day / 1-sample probe query result, which is the only signal iOS
 *     actually exposes for read scopes. See iOS privacy caveat below.
 *
 * iOS privacy caveat (communicated in the UI): HealthKit does NOT report
 * read-permission denials. When a user toggles a read scope off in
 * Settings → Health → Data Access & Devices, the JS API still returns
 * `sharingAuthorized`, and the only observable effect is that queries
 * return zero samples. "Authorized + 0 samples" is therefore ambiguous —
 * it could mean the user denied reads OR simply hasn't recorded any data
 * of that type. We expose both signals so the researcher can disambiguate.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { StanfordColors } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { FontSize, FontWeight, LineHeight } from '@/lib/theme/typography';
import {
  useHealthKitAuthMatrix,
  type HKAuthRowState,
} from '@/lib/services/healthkit/useHealthKitAuthMatrix';
import { requestHealthPermissions } from '@/lib/services/healthkit';

function statusColor(uiStatus: HKAuthRowState['uiStatus'], c: any): string {
  switch (uiStatus) {
    case 'authorized-with-data':
      return c.semanticSuccess;
    case 'authorized-no-data':
      return c.semanticWarning ?? StanfordColors.cardinal;
    case 'denied':
      return StanfordColors.cardinal;
    case 'not-determined':
      return c.textTertiary;
    default:
      return c.textTertiary;
  }
}

function statusLabel(uiStatus: HKAuthRowState['uiStatus']): string {
  switch (uiStatus) {
    case 'authorized-with-data':
      return 'Data flowing';
    case 'authorized-no-data':
      return 'No recent samples';
    case 'denied':
      return 'Denied';
    case 'not-determined':
      return 'Not determined';
    default:
      return 'Unknown';
  }
}

export default function PermissionsStatusScreen() {
  const { theme } = useAppTheme();
  const { colors: c } = theme;
  const router = useRouter();
  const { rows, isLoading, refresh } = useHealthKitAuthMatrix();
  const [reRequesting, setReRequesting] = React.useState(false);

  const handleReRequest = async () => {
    if (reRequesting) return;
    setReRequesting(true);
    try {
      const result = await requestHealthPermissions();
      // iOS only prompts the first time per install. After that this call
      // resolves silently. Surface that reality to the user rather than
      // implying the dialog will always reappear.
      if (result.success) {
        Alert.alert(
          'Permissions refreshed',
          result.dataVerified
            ? 'HealthKit is connected and sharing data.'
            : "We asked iOS to re-prompt. If no dialog appeared (iOS only shows it once), open Settings → Health → Data Access & Devices → StreamSync to toggle categories manually.",
        );
      } else {
        Alert.alert('Unable to request permissions', result.note ?? 'Please try again from Settings.');
      }
      await refresh();
    } finally {
      setReRequesting(false);
    }
  };

  const handleOpenSettings = () => {
    Linking.openURL('app-settings:').catch(() => {
      Alert.alert(
        'Open Settings',
        "We couldn't open Settings automatically. Go to Settings → Health → Data Access & Devices → StreamSync to manage data access.",
      );
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.separator }]}>
        <View style={styles.headerLeft}>
          <IconSymbol name="lock.shield" size={18} color={StanfordColors.cardinal} />
          <Text style={[styles.headerTitle, { color: c.textPrimary }]}>
            Data Permissions
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[styles.closeButton, { backgroundColor: c.secondaryFill }]}
        >
          <IconSymbol name="xmark" size={13} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroCard, { backgroundColor: c.card }]}>
          <Text style={[styles.heroTitle, { color: c.textPrimary }]}>
            HealthKit access by category
          </Text>
          <Text style={[styles.heroSummary, { color: c.textSecondary }]}>
            For privacy reasons, iOS does not expose whether you have
            granted or denied read access. If a category shows "Data
            flowing," this app is receiving samples. If it shows "No
            recent samples," either you denied read access in Settings or
            no data has been recorded in the last 7 days.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: c.card }]}>
          {isLoading && rows.every((r) => r.probeSamples === null) ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={c.accent} />
              <Text style={[styles.loadingText, { color: c.textTertiary }]}>
                Checking each category…
              </Text>
            </View>
          ) : (
            rows.map((row, index) => (
              <View key={row.key}>
                <View style={styles.rowButton}>
                  <View style={styles.rowLeft}>
                    <Text style={[styles.rowLabel, { color: c.textPrimary }]}>
                      {row.label}
                    </Text>
                    <Text style={[styles.rowSublabel, { color: c.textTertiary }]}>
                      {row.probeSamples !== null
                        ? `${row.probeSamples} sample${row.probeSamples === 1 ? '' : 's'} in last 7 days · iOS status: ${row.authStatus}`
                        : `iOS status: ${row.authStatus}`}
                    </Text>
                    {row.probeError ? (
                      <Text style={[styles.rowError, { color: StanfordColors.cardinal }]}>
                        {row.probeError}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: statusColor(row.uiStatus, c) + '22' }]}>
                    <Text style={[styles.statusPillText, { color: statusColor(row.uiStatus, c) }]}>
                      {statusLabel(row.uiStatus)}
                    </Text>
                  </View>
                </View>
                {index < rows.length - 1 ? (
                  <View style={[styles.rowDivider, { backgroundColor: c.separator }]} />
                ) : null}
              </View>
            ))
          )}
        </View>

        <View style={[styles.ctaCard, { backgroundColor: c.card }]}>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: c.accent, opacity: reRequesting ? 0.7 : 1 }]}
            onPress={handleReRequest}
            disabled={reRequesting}
            activeOpacity={0.7}
          >
            {reRequesting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                Re-request HealthKit Permissions
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, { backgroundColor: c.secondaryFill }]}
            onPress={handleOpenSettings}
            activeOpacity={0.7}
          >
            <Text style={[styles.secondaryButtonText, { color: c.textPrimary }]}>
              Open iOS Settings
            </Text>
          </TouchableOpacity>
          <Text style={[styles.ctaHelper, { color: c.textTertiary }]}>
            To revoke read access, iOS only exposes the toggle in Settings
            → Health → Data Access & Devices → StreamSync.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: FontSize.headline, fontWeight: FontWeight.semibold },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },

  heroCard: { borderRadius: 12, padding: 16, gap: 8 },
  heroTitle: { fontSize: FontSize.titleSmall, fontWeight: FontWeight.semibold },
  heroSummary: { fontSize: FontSize.footnote, lineHeight: LineHeight.footnote },

  card: { borderRadius: 12, paddingHorizontal: 16 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  loadingText: { fontSize: FontSize.subhead },
  rowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: 12,
  },
  rowLeft: { flex: 1, gap: 2 },
  rowLabel: { fontSize: FontSize.body, fontWeight: FontWeight.medium },
  rowSublabel: { fontSize: FontSize.caption, lineHeight: LineHeight.caption },
  rowError: { fontSize: FontSize.caption, lineHeight: LineHeight.caption },
  rowDivider: { height: StyleSheet.hairlineWidth },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusPillText: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semibold,
  },

  ctaCard: { borderRadius: 12, padding: 16, gap: 8 },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: FontSize.headline,
    fontWeight: FontWeight.semibold,
  },
  secondaryButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.medium,
  },
  ctaHelper: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    marginTop: 4,
  },
});
