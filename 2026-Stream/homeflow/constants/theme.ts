/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

// Primary brand color — "sea" from the Liquid Glass palette.
// Legacy code still imports `StanfordColors.cardinal`; we keep the name to
// avoid a sweeping rename but map it to the new sea hue so the look stays
// consistent app-wide.
const tintColorLight = '#0E5A6E';
const tintColorDark = '#5BC5D2';

export const Colors = {
  light: {
    text: '#16242C',
    background: '#E9E5DD',
    tint: tintColorLight,
    icon: '#6F8088',
    tabIconDefault: '#6F8088',
    tabIconSelected: tintColorLight,
    border: 'rgba(22,36,44,0.10)',
    buttonBackground: tintColorLight,
    buttonText: '#fff',
  },
  dark: {
    text: '#F2EEE5',
    background: '#0E1518',
    tint: tintColorDark,
    icon: 'rgba(242,238,229,0.6)',
    tabIconDefault: 'rgba(242,238,229,0.6)',
    tabIconSelected: tintColorDark,
    border: 'rgba(255,255,255,0.10)',
    buttonBackground: '#0E5A6E',
    buttonText: '#fff',
  },
};

// Brand palette — kept named "StanfordColors" to avoid a sweeping rename,
// but the values are now the Liquid Glass sea / peach / ink family. The
// "cardinal" alias remains so older imports still compile; it points at
// the new primary sea color.
export const StanfordColors = {
  cardinal: '#0E5A6E',        // sea — primary
  cardinalLight: '#2E9FA2',   // teal — secondary
  cardinalDark: '#0A4555',    // sea-deep — pressed states
  white: '#FFFFFF',
  black: '#16242C',           // ink — warm near-black
  coolGrey: '#3D525C',        // ink2
  beige: '#E9E5DD',           // warm sand background
};

/**
 * Layout spacing constants
 */
export const Spacing = {
  /** Horizontal padding for screen content */
  screenHorizontal: 24,
  /** Top padding to account for status bar (use SafeAreaView when possible) */
  screenTop: 60,
  /** Standard vertical gap between sections */
  sectionGap: 24,
  /** Small gap between related elements */
  elementGap: 12,
  /** Extra small gap */
  xs: 4,
  /** Small gap */
  sm: 8,
  /** Medium gap */
  md: 16,
  /** Large gap */
  lg: 24,
  /** Extra large gap */
  xl: 32,
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
