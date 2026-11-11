import { hslToHex } from "@aulora/core";
import { View } from "react-native";
import type { Fn } from "../../lib/function-type";
import { ColorTrack } from "./ColorTrack";

const HUE_STOPS = Array.from({ length: 12 }, (_, index) => index * 30);
const LIGHTNESS_STOPS = [0, 0.25, 0.5, 0.75, 1];

export interface HslTrackProps {
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
  readonly disabled: boolean;
  readonly onChange: Fn<[hue: number, saturation: number, lightness: number], void>;
}

export function HueTrack({ hue, saturation, lightness, disabled, onChange }: HslTrackProps) {
  return (
    <ColorTrack
      label="Hue"
      valueLabel={`${Math.round(hue)}°`}
      ratio={hue / 360}
      disabled={disabled}
      onChangeRatio={(ratio) => {
        onChange(ratio * 360, saturation, lightness);
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
  );
}

export function SaturationTrack({ hue, saturation, lightness, disabled, onChange }: HslTrackProps) {
  return (
    <ColorTrack
      label="Saturation"
      valueLabel={`${Math.round(saturation * 100)}%`}
      ratio={saturation}
      disabled={disabled}
      onChangeRatio={(ratio) => {
        onChange(hue, ratio, lightness);
      }}
      accessibilityLabel="Role color saturation"
      track={
        <View
          className="h-3 rounded-pill"
          style={{ backgroundColor: hslToHex(hue, 1, lightness) }}
        />
      }
      thumbColor={hslToHex(hue, saturation, lightness)}
    />
  );
}

export function LightnessTrack({ hue, saturation, lightness, disabled, onChange }: HslTrackProps) {
  return (
    <ColorTrack
      label="Lightness"
      valueLabel={`${Math.round(lightness * 100)}%`}
      ratio={lightness}
      disabled={disabled}
      onChangeRatio={(ratio) => {
        onChange(hue, saturation, ratio);
      }}
      accessibilityLabel="Role color lightness"
      track={
        <View className="h-3 min-w-0 flex-row overflow-hidden rounded-pill">
          {LIGHTNESS_STOPS.map((stop) => (
            <View
              key={stop}
              style={{ flex: 1, backgroundColor: hslToHex(hue, saturation, stop) }}
            />
          ))}
        </View>
      }
      thumbColor={hslToHex(hue, saturation, lightness)}
    />
  );
}
