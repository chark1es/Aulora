import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector, type NativeGesture } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { dismissKeyboard } from "../../lib/keyboard";

export type PaneIndex = 0 | 1 | 2;

const SPRING = { damping: 34, stiffness: 320, mass: 0.9, overshootClamping: true } as const;
/** A flick this fast changes pane even when the drag itself was short. */
const FLICK_VELOCITY = 520;

/**
 * Three full-width panes side by side, moved with a horizontal drag. The chat
 * sits in the middle; dragging right reveals `left`, dragging left reveals
 * `right`, and each covers the chat completely once settled.
 */
export function SwipePanes({
  index,
  onIndexChange,
  left,
  center,
  right,
}: {
  readonly index: PaneIndex;
  readonly onIndexChange: (index: PaneIndex) => void;
  readonly left: ReactNode;
  readonly center: ReactNode;
  readonly right: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const position = useSharedValue<number>(index);
  const start = useSharedValue<number>(index);
  const origin = useSharedValue<number>(index);
  const dragging = useSharedValue(false);

  useEffect(() => {
    position.value = withSpring(index, SPRING);
  }, [index, position]);

  const [blockers, setBlockers] = useState<readonly NativeGesture[]>([]);
  const registry = useMemo<PaneSwipeRegistry>(
    () => ({
      add(gesture) {
        setBlockers((current) => [...current, gesture]);
        return () => setBlockers((current) => current.filter((entry) => entry !== gesture));
      },
    }),
    [],
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-16, 16])
    .requireExternalGestureToFail(...blockers)
    .onStart(() => {
      // `origin` is where the panes are right now (possibly mid-animation), so
      // the drag never jumps; `start` is the pane that drag is leaving.
      origin.value = position.value;
      start.value = Math.round(position.value);
      dragging.value = true;
      scheduleOnRN(dismissKeyboard);
    })
    .onUpdate((event) => {
      const next = origin.value - event.translationX / width;
      // Past either end the drag resists instead of stopping dead.
      position.value = next < 0 ? next / 3 : next > 2 ? 2 + (next - 2) / 3 : next;
    })
    .onEnd((event) => {
      // The release carries the final offset; the last update can lag behind a fast flick.
      const moved = origin.value - event.translationX / width - start.value;
      let target = start.value;
      if (event.velocityX < -FLICK_VELOCITY || moved > 0.35) target = start.value + 1;
      else if (event.velocityX > FLICK_VELOCITY || moved < -0.35) target = start.value - 1;
      target = Math.min(2, Math.max(0, target));
      position.value = withSpring(target, { ...SPRING, velocity: -event.velocityX / width });
      if (target !== start.value) scheduleOnRN(onIndexChange, target as PaneIndex);
    })
    .onFinalize((_event, success) => {
      // A drag the system cancelled must not leave the panes parked mid-way.
      if (dragging.value && !success) position.value = withSpring(start.value, SPRING);
      dragging.value = false;
    });

  return (
    <PaneSwipeContext.Provider value={registry}>
      <GestureDetector gesture={pan}>
        <View style={{ flex: 1, overflow: "hidden" }}>
          {[left, center, right].map((pane, paneIndex) => (
            <Pane
              // biome-ignore lint/suspicious/noArrayIndexKey: the three panes never reorder
              key={paneIndex}
              slot={paneIndex}
              position={position}
              width={width}
              active={paneIndex === index}
            >
              {pane}
            </Pane>
          ))}
        </View>
      </GestureDetector>
    </PaneSwipeContext.Provider>
  );
}

interface PaneSwipeRegistry {
  /** Registers a gesture the pane swipe must yield to; returns its removal. */
  add(gesture: NativeGesture): () => void;
}

const PaneSwipeContext = createContext<PaneSwipeRegistry | null>(null);

/**
 * A horizontal scroller inside a pane. A sideways drag that starts on it
 * scrolls it instead of changing pane. Outside {@link SwipePanes} it is a
 * plain horizontal scroll view.
 */
export function HorizontalScroll(props: Omit<ScrollViewProps, "horizontal">) {
  const registry = useContext(PaneSwipeContext);
  const native = useMemo(() => Gesture.Native(), []);
  useEffect(() => registry?.add(native), [registry, native]);
  return (
    <GestureDetector gesture={native}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} {...props} />
    </GestureDetector>
  );
}

/**
 * Every pane is laid out over the whole container and only moved by a
 * transform. Android does not deliver touches to a view laid out beyond its
 * parent's bounds, so a wide sliding track would leave two panes untappable.
 */
function Pane({
  slot,
  position,
  width,
  active,
  children,
}: {
  readonly slot: number;
  readonly position: SharedValue<number>;
  readonly width: number;
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: (slot - position.value) * width }],
  }));
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style]}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
    >
      {children}
    </Animated.View>
  );
}
