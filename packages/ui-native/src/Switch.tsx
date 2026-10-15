import { Switch as RNSwitch, type SwitchProps as RNSwitchProps } from "react-native";
import { usePalette } from "./theme";

/**
 * The platform switch, pre-wired to the Aulora palette so every toggle shares
 * the same on/off colours in light and dark. `trackColor`, `thumbColor` and
 * `ios_backgroundColor` are intentionally not accepted: use the tokens.
 */
export type SwitchProps = Omit<RNSwitchProps, "trackColor" | "thumbColor" | "ios_backgroundColor">;

export function Switch(props: SwitchProps) {
  const palette = usePalette();
  return (
    <RNSwitch
      trackColor={{ false: palette.border, true: palette.accent }}
      thumbColor={palette["on-accent"]}
      ios_backgroundColor={palette.border}
      {...props}
    />
  );
}
