import { type ReactNode, useEffect } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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
  const dragging = useSharedValue(false);

  useEffect(() => {
    position.value = withSpring(index, SPRING);
  }, [index, position]);

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-16, 16])
    .onStart(() => {
      start.value = Math.round(position.value);
      dragging.value = true;
      scheduleOnRN(dismissKeyboard);
    })
    .onUpdate((event) => {
      const next = start.value - event.translationX / width;
      // Past either end the drag resists instead of stopping dead.
      position.value = next < 0 ? next / 3 : next > 2 ? 2 + (next - 2) / 3 : next;
    })
    .onEnd((event) => {
      // The release carries the final offset; the last update can lag behind a fast flick.
      const moved = -event.translationX / width;
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
