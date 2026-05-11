/**
 * LiquidGlassBackdrop
 *
 * The ambient blurred-blob backdrop that every Liquid Glass screen sits on.
 * Drops in behind your screen content as the first child of a `position:
 * 'relative'` container — content stacks on top thanks to RN's z-order.
 *
 *   <View style={{ flex: 1 }}>
 *     <LiquidGlassBackdrop variant="home" />
 *     ...content...
 *   </View>
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LGColors } from '@/lib/theme/liquidGlass';
import { useAppTheme } from '@/lib/theme/ThemeContext';

type Variant = 'default' | 'welcome' | 'home' | 'survey' | 'chat' | 'alert';

interface Blob {
  color: string;
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  size: number;
  opacity?: number;
}

const LAYOUTS: Record<Variant, Blob[]> = {
  default: [
    { color: LGColors.blobBlue, top: -80, left: -120, size: 380 },
    { color: LGColors.blobPeach, top: 340, right: -140, size: 420 },
    { color: LGColors.blobSand, bottom: -80, left: -60, size: 360 },
  ],
  welcome: [
    { color: LGColors.blobTeal, top: -60, left: -80, size: 440 },
    { color: LGColors.blobPeach, top: 300, right: -180, size: 480 },
    { color: LGColors.blobBlue, bottom: -60, left: 60, size: 340 },
  ],
  home: [
    { color: LGColors.blobSand, top: 60, right: -140, size: 360 },
    { color: LGColors.blobBlue, top: 460, left: -120, size: 380 },
    { color: LGColors.blobPeach, bottom: -100, right: -80, size: 340 },
  ],
  survey: [
    { color: LGColors.blobPeach, top: -40, left: -120, size: 420 },
    { color: LGColors.blobSand, bottom: -60, right: -100, size: 380 },
  ],
  chat: [
    { color: LGColors.blobBlue, top: -60, right: -120, size: 380 },
    { color: LGColors.blobTeal, bottom: 200, left: -120, size: 360 },
  ],
  alert: [
    { color: LGColors.blobRed, top: -60, left: -100, size: 420 },
    { color: LGColors.blobSand, bottom: -80, right: -80, size: 380 },
  ],
};

export function LiquidGlassBackdrop({ variant = 'default' }: { variant?: Variant }) {
  const { theme } = useAppTheme();
  const { isDark } = theme;

  const baseTop = isDark ? LGColors.darkBgTop : LGColors.bgTop;
  const baseBottom = isDark ? LGColors.darkBgBottom : LGColors.bgBottom;
  const blobs = LAYOUTS[variant];

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
    >
      {/* Base wash — vertical gradient simulated with two stacked halves. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: baseBottom }]} />
      <View
        style={[
          StyleSheet.absoluteFillObject,
          {
            backgroundColor: baseTop,
            opacity: isDark ? 0.92 : 0.85,
            bottom: '40%',
          },
        ]}
      />

      {/* Ambient color blobs (positioned, soft-blurred edges via large radius
          + reduced opacity to mimic the design's blurred radial gradients). */}
      {blobs.map((b, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: b.top,
            left: b.left,
            right: b.right,
            bottom: b.bottom,
            width: b.size,
            height: b.size,
            borderRadius: b.size / 2,
            backgroundColor: b.color,
            opacity: isDark ? 0.35 : 0.7,
          }}
        />
      ))}

      {/* Top film-highlight — subtle white veil along the top edge. */}
      {!isDark && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '40%',
            backgroundColor: 'rgba(255,255,255,0.40)',
            opacity: 0.7,
          }}
        />
      )}
    </View>
  );
}

export default LiquidGlassBackdrop;
