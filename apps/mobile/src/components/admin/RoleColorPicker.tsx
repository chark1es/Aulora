import { hslToHex, parseHexColor, ROLE_COLOR_PRESETS, rgbToHsl } from "@aulora/core";
import { Text, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";
import type { Fn } from "../../lib/function-type";
import { HueTrack, LightnessTrack, SaturationTrack } from "./RoleColorTracks";

const DEFAULT_HUE = 16;
const DEFAULT_SATURATION = 0.72;
const DEFAULT_LIGHTNESS = 0.55;

export interface RoleColorPickerProps {
  readonly value: string;
  readonly onChange: Fn<[color: string], void>;
  readonly disabled?: boolean;
}

function RoleColorSwatches({ value, onChange, disabled = false }: RoleColorPickerProps) {
  const palette = usePalette();
  return (
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
  );
}

function ClearColorButton({ onChange, disabled = false }: Omit<RoleColorPickerProps, "value">) {
  return (
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
  );
}

/**
 * A compact native role-colour picker: preset swatches plus hue and lightness
 * tracks. Both tracks are adjustable controls, so a screen reader can step them
 * without dragging; every target is at least 44pt.
 */
export function RoleColorPicker({ value, onChange, disabled = false }: RoleColorPickerProps) {
  const rgb = parseHexColor(value);
  const hsl = rgb === null ? null : rgbToHsl(rgb);
  const track = {
    hue: hsl?.h ?? DEFAULT_HUE,
    saturation: hsl?.s ?? DEFAULT_SATURATION,
    lightness: hsl?.l ?? DEFAULT_LIGHTNESS,
    disabled,
    onChange: (h: number, s: number, l: number) => {
      onChange(hslToHex(h, s, l));
    },
  };
  return (
    <View className="min-w-0 gap-3" accessibilityLabel="Role color picker">
      <RoleColorSwatches value={value} onChange={onChange} disabled={disabled} />
      <HueTrack {...track} />
      <SaturationTrack {...track} />
      <LightnessTrack {...track} />
      <View className="flex-row items-center justify-between gap-2">
        <Text size="xs" tone="muted">
          Custom color
        </Text>
        <Text size="xs" mono className="uppercase">
          {value.length > 0 ? value : "None"}
        </Text>
      </View>
      <ClearColorButton onChange={onChange} disabled={disabled} />
    </View>
  );
}
