import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";

/** The last answer from the OS, so later screens need not wait a tick to animate. */
let lastKnown: boolean | null = null;

/**
 * Tracks the OS "Reduce Motion" preference (initial read + change events) so
 * screens can render a static, non-animated variant when it is enabled.
 * Returns `null` until the first read in this app session resolves, so callers
 * never animate before the preference is known. Mirrors the HIG guidance for accessibility:
 * "ensure your app responds by reducing automatic and repetitive animations".
 */
export function useReduceMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(lastKnown);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      lastKnown = value;
      if (mounted) {
        setReduced(value);
      }
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      lastKnown = value;
      setReduced(value);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/**
 * One orchestrated entrance moment: an opacity fade plus a small upward
 * translate on mount. When reduce motion is on, the content is shown
 * immediately in its final position and never animated; while the preference
 * is still unknown (`null`) the entrance holds rather than animating.
 */
export function useEntrance(reduceMotion: boolean | null): {
  readonly animatedStyle: {
    opacity: Animated.AnimatedInterpolation<number>;
    transform: { translateY: Animated.AnimatedInterpolation<number> }[];
  };
} {
  const progress = useRef(new Animated.Value(reduceMotion === true ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion === null) {
      return;
    }
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion]);

  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });

  return { animatedStyle: { opacity, transform: [{ translateY }] } };
}
