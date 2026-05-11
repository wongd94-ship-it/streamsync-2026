/**
 * Liquid Glass design tokens
 *
 * Warm-cool palette and material recipes that mirror the iOS 26 "Liquid Glass"
 * look the design team mocked up. These are layered on top of the existing
 * `ThemeContext` palette — older code keeps reading from `colors.*`, new code
 * can opt into the richer Liquid Glass tokens here.
 *
 * Source of truth: design bundle, streamsync-ios/src/shared.jsx SSTokens.
 */

import type { TextStyle, ViewStyle } from 'react-native';

// ─────────────────────────────────────────────────────────────
// Palette (light surface; dark variants supplied where used)
// ─────────────────────────────────────────────────────────────

export const LGColors = {
  // Warm-cool background wash — applied behind every screen.
  bgTop: '#EAF1F4',
  bgBottom: '#E9E5DD',

  // Ambient blob colors (placed behind the glass surfaces).
  blobBlue: 'rgba(48,118,168,0.55)',
  blobTeal: 'rgba(46,159,162,0.55)',
  blobPeach: 'rgba(232,159,124,0.55)',
  blobSand: 'rgba(214,194,166,0.60)',
  blobRed: 'rgba(200,85,62,0.32)',

  // Ink (primary text family).
  ink: '#16242C',
  ink2: '#3D525C',
  ink3: '#6F8088',
  inkSoft: 'rgba(22,36,44,0.55)',
  hair: 'rgba(22,36,44,0.10)',
  hairSoft: 'rgba(22,36,44,0.06)',

  // Brand & semantic.
  sea: '#0E5A6E',       // primary action / brand
  seaDeep: '#0A4555',
  seaSoft: 'rgba(14,90,110,0.12)',
  seaTint: 'rgba(14,90,110,0.10)',
  teal: '#2E9FA2',
  peach: '#E27E54',
  peachLight: '#F5C28D',
  amber: '#C68A1F',
  amberLight: '#F0BA62',
  green: '#2F7D5A',
  greenLight: '#5BB382',
  red: '#B23B3B',
  redLight: '#D8867D',

  // Dark-mode counterparts (Liquid Glass becomes warm-graphite at night).
  darkBgTop: '#0E1518',
  darkBgBottom: '#161B1F',
  darkInk: '#F2EEE5',
  darkInk2: 'rgba(242,238,229,0.78)',
  darkInk3: 'rgba(242,238,229,0.52)',
  darkHair: 'rgba(255,255,255,0.10)',
} as const;

// ─────────────────────────────────────────────────────────────
// Gradient strings (used as `background` / `colors` arrays)
// ─────────────────────────────────────────────────────────────

export const LGGradients = {
  /** Warm-cool wash — pass as `colors` to expo-linear-gradient. */
  bg: [LGColors.bgTop, LGColors.bgBottom] as [string, string],
  bgDark: [LGColors.darkBgTop, LGColors.darkBgBottom] as [string, string],
  /** Sea — used for hero countdown card. */
  sea: ['#0E5A6E', '#2E9FA2'] as [string, string],
  /** Peach — accent badge / avatar. */
  peach: ['#F5C28D', '#E27E54'] as [string, string],
  /** Green — recovery progress hero. */
  green: ['#2F7D5A', '#5BB382'] as [string, string],
  /** Red — alert banner. */
  red: ['#C8553E', '#B23B3B'] as [string, string],
  /** Amber — gentle warning / notification icon. */
  amber: ['#FFD27A', '#E89F2E'] as [string, string],
  /** Health red — Apple Health icon backing. */
  heart: ['#FF6584', '#FF3B5C'] as [string, string],
} as const;

// ─────────────────────────────────────────────────────────────
// Material recipes
// ─────────────────────────────────────────────────────────────

/** Standard glass card radius (matches design spec). */
export const LGRadius = {
  sm: 16,
  md: 22,
  lg: 26,
  xl: 28,
  xxl: 34,
} as const;

/** Soft shadow used on every floating Liquid Glass surface. */
export const LGShadow: ViewStyle = {
  shadowColor: '#16242C',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.07,
  shadowRadius: 18,
  elevation: 6,
};

/** Heavier shadow for hero / primary CTA. */
export const LGShadowStrong: ViewStyle = {
  shadowColor: '#0E5A6E',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.32,
  shadowRadius: 24,
  elevation: 10,
};

// ─────────────────────────────────────────────────────────────
// Typography helpers (built on the existing FontSize/FontWeight)
// ─────────────────────────────────────────────────────────────

/** Eyebrow label — uppercase, tracked-out, micro. */
export const LGEyebrow: TextStyle = {
  fontSize: 13,
  fontWeight: '700',
  letterSpacing: 1.2,
  textTransform: 'uppercase',
};

/** Big page title (matches SSTitle). */
export const LGPageTitle: TextStyle = {
  fontSize: 32,
  fontWeight: '700',
  letterSpacing: -0.9,
  lineHeight: 36,
};

/** Body subtitle under page titles. */
export const LGPageSubtitle: TextStyle = {
  fontSize: 19,
  fontWeight: '400',
  letterSpacing: -0.2,
  lineHeight: 27,
};

// ─────────────────────────────────────────────────────────────
// Theme-aware color resolver (kept light-mode-only for v1)
// ─────────────────────────────────────────────────────────────

export function lgInk(isDark: boolean) {
  return {
    ink: isDark ? LGColors.darkInk : LGColors.ink,
    ink2: isDark ? LGColors.darkInk2 : LGColors.ink2,
    ink3: isDark ? LGColors.darkInk3 : LGColors.ink3,
    hair: isDark ? LGColors.darkHair : LGColors.hair,
  };
}
