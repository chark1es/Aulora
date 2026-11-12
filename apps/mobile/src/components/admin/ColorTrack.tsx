import { Text } from "@aulora/ui-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import type { Fn } from "../../lib/function-type";

const TRACK_HEIGHT = 44;
const THUMB = 18;
const STEP = 0.05;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface ColorTrackProps {
  readonly label: string;
  readonly valueLabel: string;
  readonly ratio: number;
  readonly disabled: boolean;
  readonly onChangeRatio: Fn<[ratio: number], void>;
  readonly accessibilityLabel: string;
  readonly track: ReactNode;
  readonly thumbColor: string;
}

const thumbStyle = (left: number, color: string) => ({
  position: "absolute" as const,
  left,
  width: THUMB,
  height: THUMB,
  borderRadius: THUMB / 2,
  backgroundColor: color,
  borderWidth: 2,
  borderColor: "#FFFFFF",
  shadowColor: "#000000",
  shadowOpacity: 0.3,
  shadowRadius: 2,
  shadowOffset: { width: 0, height: 1 },
  elevation: 2,
});

/** Responder props that turn a horizontal touch on the track into a 0..1 ratio. */
function useTrackResponder(
  disabled: boolean,
  width: number,
  onChangeRatio: Fn<[ratio: number], void>,
) {
  const update = (x: number) => {
    if (width <= 0) return;
    onChangeRatio(clamp01(x / width));
  };
  return {
    onStartShouldSetResponder: () => !disabled,
    onMoveShouldSetResponder: () => !disabled,
    onResponderGrant: (event: { nativeEvent: { locationX: number } }) => {
      if (!disabled) update(event.nativeEvent.locationX);
    },
    onResponderMove: (event: { nativeEvent: { locationX: number } }) => {
      if (!disabled) update(event.nativeEvent.locationX);
    },
  };
}

/** A labelled, screen-reader adjustable slider track with a draggable thumb. */
export function ColorTrack({
  label,
  valueLabel,
  ratio,
  disabled,
  onChangeRatio,
  accessibilityLabel,
  track,
  thumbColor,
}: ColorTrackProps) {
  const [width, setWidth] = useState(0);
  const clamped = clamp01(ratio);
  const responder = useTrackResponder(disabled, width, onChangeRatio);
  const left = Math.min(Math.max(clamped * width - THUMB / 2, 0), Math.max(width - THUMB, 0));
  return (
    <View className="min-w-0 gap-1">
      <View className="flex-row items-center justify-between">
        <Text size="xs" tone="muted">
          {label}
        </Text>
        <Text size="xs" tone="muted" className="tabular-nums">
          {valueLabel}
        </Text>
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        accessibilityState={{ disabled }}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          const step = event.nativeEvent.actionName === "increment" ? STEP : -STEP;
          onChangeRatio(clamp01(clamped + step));
        }}
        onLayout={(event) => {
          setWidth(event.nativeEvent.layout.width);
        }}
        {...responder}
        style={{ height: TRACK_HEIGHT, justifyContent: "center" }}
      >
        <View pointerEvents="none">{track}</View>
        <View pointerEvents="none" style={thumbStyle(left, thumbColor)} />
      </View>
    </View>
  );
}
