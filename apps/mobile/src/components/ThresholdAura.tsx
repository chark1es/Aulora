import { avatarHead } from "@aulora/avatars/native";
import { Logo, usePalette } from "@aulora/ui-native";
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, useColorScheme, View } from "react-native";

export interface ThresholdAuraProps {
  /** Scales the default doorway mark (ignored when `children` is provided). */
  readonly size?: number;
  /** When set, the resolved workspace avatar sits at the centre as the keyhole. */
  readonly children?: React.ReactNode;
  /**
   * Icon seed whose own blobatar colour tints the halo, so each workspace has
   * its own light. Omitted falls back to the accent wash.
   */
  readonly seed?: string;
  /** `false` lets the mark float and breathe; `true`/`null` holds it still. */
  readonly reduceMotion?: boolean | null;
  /**
   * No-op, accepted for API compatibility. Motion is governed by
   * `reduceMotion`, which reads the OS preference.
   */
  readonly breathing?: boolean;
}

const FLOAT_MS = 5600;

/** `#rrggbb` plus a two-digit alpha, for the layered halo discs. */
function withAlpha(hex: string, alpha: number): string {
  const channel = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${channel}`;
}

/** The three discs that stand in for a soft radial gradient on native. */
const HALO_RINGS: readonly { readonly scale: number; readonly alpha: number }[] = [
  { scale: 1, alpha: 0.09 },
  { scale: 0.72, alpha: 0.13 },
  { scale: 0.46, alpha: 0.2 },
];

/** One slow float-and-breathe, or a still frame under Reduce Motion. */
function useFloat(reduceMotion: boolean | null | undefined) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion !== false) {
      progress.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: FLOAT_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: FLOAT_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [progress, reduceMotion]);
  return progress;
}

/**
 * The hero mark of a pre-session screen: the workspace's blobatar sitting in its
 * own coloured light, floating very slowly. The halo is built from three
 * concentric discs rather than a gradient, because native has no CSS gradients;
 * at these opacities the steps read as a soft glow.
 *
 * Decorative as a whole and hidden from assistive technologies.
 */
export function ThresholdAura({ size = 132, children, seed, reduceMotion }: ThresholdAuraProps) {
  const palette = usePalette();
  const scheme = useColorScheme();
  const float = useFloat(reduceMotion);
  const theme = scheme === "light" ? "light" : "dark";
  const glow = seed !== undefined ? avatarHead(seed, theme) : palette.accent;
  const ring = Math.round(size * 1.5);
  const animatedStyle = {
    transform: [
      { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
      { scale: float.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] }) },
    ],
  };

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.ring, { width: ring, height: ring }, animatedStyle]}
    >
      {/* A wash of the page colour settles the field right behind the mark. */}
      <View
        style={[
          styles.disc,
          {
            width: ring * 0.94,
            height: ring * 0.94,
            backgroundColor: withAlpha(palette.bg, 0.55),
          },
        ]}
      />
      {HALO_RINGS.map((ringStyle) => (
        <View
          key={ringStyle.scale.toFixed(2)}
          style={[
            styles.disc,
            {
              width: ring * ringStyle.scale,
              height: ring * ringStyle.scale,
              backgroundColor: withAlpha(glow, ringStyle.alpha),
            },
          ]}
        />
      ))}
      {children !== undefined ? children : <Logo size={Math.round(size * 0.42)} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: "center",
    justifyContent: "center",
  },
  disc: {
    position: "absolute",
    borderRadius: 9999,
  },
});
