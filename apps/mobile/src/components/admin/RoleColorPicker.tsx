import { hslToHex, parseHexColor, ROLE_COLOR_PRESETS, rgbToHsl } from "@aulora/core";
import { Text, usePalette } from "@aulora/ui-native";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";

const DEFAULT_HUE = 16;
const DEFAULT_SATURATION = 0.72;
const DEFAULT_LIGHTNESS = 0.55;
const TRACK_HEIGHT = 44;
const THUMB = 18;
const HUE_STOPS = Array.from({ length: 12 }, (_, index) => index * 30);

export interface RoleColorPickerProps {
  readonly value: string;
  readonly onChange: (color: string) => void;
  readonly disabled?: boolean;
}

/**
 * A compact native role-colour picker: preset swatches plus hue and lightness
 * tracks. Both tracks are adjustable controls, so a screen reader can step them
 * without dragging; every target is at least 44pt.
 */
export function RoleColorPicker({ value, onChange, disabled = false }: RoleColorPickerProps) {
  const palette = usePalette();
  const rgb = parseHexColor(value);
  const hsl = rgb === null ? null : rgbToHsl(rgb);
  const hue = hsl?.h ?? DEFAULT_HUE;
  const saturation = hsl?.s ?? DEFAULT_SATURATION;
  const lightness = hsl?.l ?? DEFAULT_LIGHTNESS;
  const apply = (nextHue: number, nextLightness: number) => {
    onChange(hslToHex(nextHue, saturation, nextLightness));
  };

  return (
    <View className="min-w-0 gap-3" accessibilityLabel="Role color picker">
      <View className="flex-row flex-wrap items-center gap-1">
        {ROLE_COLOR_PRESETS.map((color) => {
          const selected = value.trim().toUpperCase() === color;
          return (
            <Pressable
              key={color}
              accessibilityRole="button"
              accessibilityLabel={`Use role color ${color}`}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => {
                onChange(color);
              }}
              className="h-11 w-11 items-center justify-center rounded-pill active:opacity-70"
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: color,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? palette.text : palette.border,
                }}
              />
            </Pressable>
          );
        })}
      </View>

      <ColorTrack
        label="Hue"
        valueLabel={`${Math.round(hue)}°`}
        ratio={hue / 360}
        disabled={disabled}
        onChangeRatio={(ratio) => {
          apply(ratio * 360, lightness);
        }}
        accessibilityLabel="Role color hue"
        track={
          <View className="h-3 min-w-0 flex-row overflow-hidden rounded-pill">
            {HUE_STOPS.map((stop) => (
              <View
                key={`hue-${stop}`}
                style={{ flex: 1, backgroundColor: hslToHex(stop, 0.9, 0.5) }}
              />
            ))}
          </View>
        }
        thumbColor={hslToHex(hue, Math.max(0.35, saturation), 0.5)}
      />

      <ColorTrack
        label="Saturation"
        valueLabel={`${Math.round(saturation * 100)}%`}
        ratio={saturation}
        disabled={disabled}
        onChangeRatio={(ratio) => onChange(hslToHex(hue, ratio, lightness))}
        accessibilityLabel="Role color saturation"
        track={
          <View
            className="h-3 rounded-pill"
            style={{ backgroundColor: hslToHex(hue, 1, lightness) }}
          />
        }
        thumbColor={hslToHex(hue, saturation, lightness)}
      />

      <ColorTrack
        label="Lightness"
        valueLabel={`${Math.round(lightness * 100)}%`}
        ratio={lightness}
        disabled={disabled}
        onChangeRatio={(ratio) => {
          apply(hue, ratio);
        }}
        accessibilityLabel="Role color lightness"
        track={
          <View className="h-3 min-w-0 flex-row overflow-hidden rounded-pill">
            {[0, 0.25, 0.5, 0.75, 1].map((stop) => (
              <View
                key={stop}
                style={{ flex: 1, backgroundColor: hslToHex(hue, saturation, stop) }}
              />
            ))}
          </View>
        }
        thumbColor={hslToHex(hue, saturation, lightness)}
      />

      <View className="flex-row items-center justify-between gap-2">
        <Text size="xs" tone="muted">
          Custom color
        </Text>
        <Text size="xs" mono className="uppercase">
          {value.length > 0 ? value : "None"}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear role color"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          onChange("");
        }}
        className="min-h-11 self-start justify-center rounded-pill border border-border px-3 active:opacity-70"
      >
        <Text size="xs" tone="muted">
          Clear color
        </Text>
      </Pressable>
    </View>
  );
}

function ColorTrack({
  label,
  valueLabel,
  ratio,
  disabled,
  onChangeRatio,
  accessibilityLabel,
  track,
  thumbColor,
}: {
  readonly label: string;
  readonly valueLabel: string;
  readonly ratio: number;
  readonly disabled: boolean;
  readonly onChangeRatio: (ratio: number) => void;
  readonly accessibilityLabel: string;
  readonly track: ReactNode;
  readonly thumbColor: string;
}) {
  const [width, setWidth] = useState(0);
  const clamped = Math.min(1, Math.max(0, ratio));
  const update = (x: number) => {
    if (width <= 0) return;
    onChangeRatio(Math.min(1, Math.max(0, x / width)));
  };
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
          const step = event.nativeEvent.actionName === "increment" ? 0.05 : -0.05;
          onChangeRatio(Math.min(1, Math.max(0, clamped + step)));
        }}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          setWidth(next);
        }}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={(event) => {
          if (!disabled) update(event.nativeEvent.locationX);
        }}
        onResponderMove={(event) => {
          if (!disabled) update(event.nativeEvent.locationX);
        }}
        style={{ height: TRACK_HEIGHT, justifyContent: "center" }}
      >
        <View pointerEvents="none">{track}</View>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: Math.min(Math.max(clamped * width - THUMB / 2, 0), Math.max(width - THUMB, 0)),
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: thumbColor,
            borderWidth: 2,
            borderColor: "#FFFFFF",
            shadowColor: "#000000",
            shadowOpacity: 0.3,
            shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          }}
        />
      </View>
    </View>
  );
}
