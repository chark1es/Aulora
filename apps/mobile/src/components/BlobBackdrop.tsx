import { type AvatarBlob, avatarField } from "@aulora/avatars/native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";

export interface BlobBackdropProps {
  /** Seed for the drifting blob field: the workspace icon seed, or any stable id. */
  readonly seed: string;
  /** `false` lets the field drift; `true`/`null` holds a static frame. */
  readonly reduceMotion?: boolean | null;
}

const DRIFT_MS = 30000;

interface Travel {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  readonly scale: readonly [number, number];
}

/** Per-blob travel, so the four never pulse in lockstep. */
const TRAVEL: readonly Travel[] = [
  { x: [-16, 10], y: [-12, 14], scale: [1, 1.1] },
  { x: [14, -12], y: [-14, 10], scale: [1.08, 1] },
  { x: [-10, 15], y: [12, -10], scale: [1, 1.12] },
  { x: [12, -14], y: [-9, 12], scale: [1.06, 1] },
];

const STILL: Travel = { x: [0, 0], y: [0, 0], scale: [1, 1] };

/** Diameter and alpha of each concentric disc, largest and faintest first. */
const RINGS: readonly { readonly scale: number; readonly alpha: number }[] = [
  { scale: 1, alpha: 0.05 },
  { scale: 0.88, alpha: 0.09 },
  { scale: 0.76, alpha: 0.13 },
  { scale: 0.64, alpha: 0.17 },
  { scale: 0.52, alpha: 0.22 },
  { scale: 0.4, alpha: 0.28 },
];

/** A slow back-and-forth progress driving every layer. */
function useDrift(reduceMotion: boolean | null | undefined) {
  const value = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (reduceMotion !== false) {
      value.setValue(0.5);
      return;
    }
    const timing = (toValue: number) =>
      Animated.timing(value, {
        toValue,
        duration: DRIFT_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      });
    const loop = Animated.loop(Animated.sequence([timing(1), timing(0)]));
    loop.start();
    return () => {
      loop.stop();
    };
  }, [value, reduceMotion]);
  return value;
}

/** `#rrggbb` plus a two-digit alpha. */
function withAlpha(hex: string, alpha: number): string {
  const channel = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${channel}`;
}

/**
 * One blob of the field: three concentric discs rather than a gradient, which
 * is the closest native comes without a blur pass. The largest is faint so its
 * hard edge reads as a soft falloff; the smallest is the bright core.
 */
function SoftBlob({
  blob,
  diameter,
  opacity,
}: {
  readonly blob: AvatarBlob;
  readonly diameter: number;
  readonly opacity: number;
}) {
  return (
    <View style={styles.centred}>
      {RINGS.map((ring) => (
        <View
          key={ring.scale.toFixed(2)}
          style={[
            styles.disc,
            {
              width: diameter * ring.scale,
              height: diameter * ring.scale,
              backgroundColor: withAlpha(blob.color, ring.alpha * opacity),
            },
          ]}
        />
      ))}
    </View>
  );
}

/** The transforms for one blob, interpolated from the shared drift progress. */
function driftStyle(value: Animated.Value, travel: Travel) {
  return {
    transform: [
      {
        translateX: value.interpolate({
          inputRange: [0, 1],
          outputRange: [travel.x[0], travel.x[1]],
        }),
      },
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [travel.y[0], travel.y[1]],
        }),
      },
      {
        scale: value.interpolate({
          inputRange: [0, 1],
          outputRange: [travel.scale[0], travel.scale[1]],
        }),
      },
    ],
  };
}

/**
 * The Aulora signature backdrop on mobile: three or four saturated blobs drawn
 * from the workspace's own blobatar palette, drifting slowly behind a screen.
 * Purely decorative and hidden from assistive technology; the drift is skipped
 * when Reduce Motion is on (or still unknown).
 */
export function BlobBackdrop({ seed, reduceMotion }: BlobBackdropProps) {
  const drift = useDrift(reduceMotion);
  const window = useWindowDimensions();
  // The field fits the box it is placed in, so a band behaves like a screen.
  const [box, setBox] = useState<{ readonly width: number; readonly height: number } | null>(null);
  const { width, height } = box ?? window;
  const theme = useColorScheme() === "light" ? "light" : "dark";
  const field = useMemo(() => avatarField(seed, theme), [seed, theme]);
  const shorter = Math.min(width, height);

  return (
    <View
      style={styles.fill}
      pointerEvents="none"
      onLayout={(event) => {
        const { width: w, height: h } = event.nativeEvent.layout;
        setBox({ width: w, height: h });
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {field.blobs.map((blob, index) => {
        const travel = TRAVEL[index % TRAVEL.length] ?? STILL;
        const diameter = blob.r * shorter;
        return (
          <Animated.View
            key={`${blob.color}-${index.toFixed(0)}`}
            style={[
              styles.blob,
              {
                left: blob.cx * width - diameter / 2,
                top: blob.cy * height - diameter / 2,
                width: diameter,
                height: diameter,
              },
              driftStyle(drift, travel),
            ]}
          >
            <SoftBlob blob={blob} diameter={diameter} opacity={field.opacity} />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
  },
  centred: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  blob: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  disc: {
    position: "absolute",
    borderRadius: 9999,
  },
});
