import { useEffect, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { Icon } from "./Icon";
import { usePalette } from "./theme";

export interface CheckboxProps {
  readonly checked: boolean;
  /** Accessible name; required when the box itself is tappable. */
  readonly label?: string | undefined;
  /** Makes the box interactive. Omit inside a row that already handles the press. */
  readonly onPress?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  /** Skips the tick animation for people who ask for reduced motion. */
  readonly reducedMotion?: boolean | undefined;
}

const BOX_SIZE = 24;
/** Pads the 24pt box out to a 44pt touch target. */
const HIT_SLOP = 10;

/** A square checkbox whose tick pops in when it turns on. */
export function Checkbox(props: CheckboxProps) {
  const { checked, disabled = false, reducedMotion = false } = props;
  const palette = usePalette();
  const scale = useRef(new Animated.Value(checked ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      scale.setValue(checked ? 1 : 0);
      return;
    }
    Animated.spring(scale, {
      toValue: checked ? 1 : 0,
      speed: 28,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  }, [checked, reducedMotion, scale]);

  const box = (
    <View
      className={`items-center justify-center rounded-[7px] border ${
        checked ? "border-accent bg-accent" : "border-text-muted"
      }`}
      style={{ width: BOX_SIZE, height: BOX_SIZE }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name="check" size={16} color={palette["on-accent"]} />
      </Animated.View>
    </View>
  );

  if (props.onPress === undefined) {
    // The surrounding row carries the accessible role and state.
    return (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {box}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={props.label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      onPress={props.onPress}
      className="items-center justify-center active:opacity-70"
    >
      {box}
    </Pressable>
  );
}
