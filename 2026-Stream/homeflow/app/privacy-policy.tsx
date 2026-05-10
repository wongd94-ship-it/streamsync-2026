import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { StanfordColors } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme/ThemeContext';
import { FontSize, FontWeight, LineHeight } from '@/lib/theme/typography';
import { PRIVACY_POLICY } from '@/lib/legal/privacy-policy';

export default function PrivacyPolicyScreen() {
  const { theme } = useAppTheme();
  const { colors: c } = theme;
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.separator }]}>
        <View style={styles.headerLeft}>
          <IconSymbol name="hand.raised.shield.fill" size={18} color={StanfordColors.cardinal} />
          <Text style={[styles.headerTitle, { color: c.textPrimary }]}>
            Privacy Policy
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
            {PRIVACY_POLICY.title}
          </Text>
          <Text style={[styles.heroMeta, { color: c.textTertiary }]}>
            Effective date: {PRIVACY_POLICY.effectiveDate}
          </Text>
          <Text style={[styles.heroSummary, { color: c.textSecondary }]}>
            {PRIVACY_POLICY.summary}
          </Text>
        </View>

        {PRIVACY_POLICY.sections.map((section) => (
          <View key={section.id} style={[styles.sectionCard, { backgroundColor: c.card }]}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
              {section.title}
            </Text>
            <Text style={[styles.sectionBody, { color: c.textSecondary }]}>
              {section.content}
            </Text>
          </View>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.semibold,
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  heroCard: {
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  heroTitle: {
    fontSize: FontSize.title3,
    fontWeight: FontWeight.semibold,
  },
  heroMeta: {
    fontSize: FontSize.footnote,
  },
  heroSummary: {
    fontSize: FontSize.subhead,
    lineHeight: LineHeight.subhead,
  },
  sectionCard: {
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: FontSize.subhead,
    fontWeight: FontWeight.semibold,
  },
  sectionBody: {
    fontSize: FontSize.footnote,
    lineHeight: LineHeight.footnote,
  },
});
