/**
 * App-wide theme context with Light / Dark / System appearance switching.
 * Persists preference to AsyncStorage.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AppearanceMode = 'system' | 'light' | 'dark';

export interface ThemeColors {
  background: string;
  card: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  separator: string;
  accent: string;
  secondaryFill: string;
  semanticSuccess: string;
  semanticWarning: string;
  semanticError: string;
}

export interface AppTheme {
  isDark: boolean;
  colors: ThemeColors;
}

interface ThemeContextValue {
  theme: AppTheme;
  appearance: AppearanceMode;
  setAppearance: (mode: AppearanceMode) => void;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

// Liquid Glass palette — warm-cool wash with sea-deep brand accent.
// The original iOS-system palette was electric and clinical; this one is
// calmer, easier on aging eyes, and matches the design bundle's spec.
const lightColors: ThemeColors = {
  background: '#E9E5DD',        // sand-warm wash (was systemGroupedBackground)
  card: '#FFFFFF',               // glass surface base (overlay handles tint)
  textPrimary: '#16242C',        // ink — warm near-black
  textSecondary: '#3D525C',      // ink2
  textTertiary: '#6F8088',       // ink3
  separator: 'rgba(22,36,44,0.10)',
  accent: '#0E5A6E',             // sea — primary brand action
  secondaryFill: 'rgba(14,90,110,0.10)',
  semanticSuccess: '#2F7D5A',    // grounded green
  semanticWarning: '#C68A1F',    // amber
  semanticError: '#B23B3B',      // warm red
};

const darkColors: ThemeColors = {
  background: '#0E1518',         // graphite-warm (was pitch black)
  card: '#1C2226',               // glass surface base (overlay handles tint)
  textPrimary: '#F2EEE5',        // warm white
  textSecondary: 'rgba(242,238,229,0.78)',
  textTertiary: 'rgba(242,238,229,0.52)',
  separator: 'rgba(255,255,255,0.10)',
  accent: '#5BC5D2',             // sea, lifted for dark mode contrast
  secondaryFill: 'rgba(255,255,255,0.10)',
  semanticSuccess: '#5BB382',    // green, lifted
  semanticWarning: '#F0BA62',    // amber, lifted
  semanticError: '#E07A6E',      // warm red, lifted
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const STORAGE_KEY = '@homeflow_appearance';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [appearance, setAppearanceState] = useState<AppearanceMode>('system');
  const [loaded, setLoaded] = useState(false);

  // Load persisted preference
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      if (!cancelled && (value === 'light' || value === 'dark' || value === 'system')) {
        setAppearanceState(value);
      }
      if (!cancelled) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const setAppearance = useCallback((mode: AppearanceMode) => {
    setAppearanceState(mode);
    AsyncStorage.setItem(STORAGE_KEY, mode);
  }, []);

  const resolvedIsDark = useMemo(() => {
    if (appearance === 'system') return systemScheme === 'dark';
    return appearance === 'dark';
  }, [appearance, systemScheme]);

  const theme: AppTheme = useMemo(() => ({
    isDark: resolvedIsDark,
    colors: resolvedIsDark ? darkColors : lightColors,
  }), [resolvedIsDark]);

  const value = useMemo(() => ({
    theme,
    appearance,
    setAppearance,
  }), [theme, appearance, setAppearance]);

  // Don't render until preference is loaded to avoid flash
  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within AppThemeProvider');
  }
  return ctx;
}
