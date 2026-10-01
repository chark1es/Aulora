import { usePalette } from "@aulora/ui-native";
import { vars } from "nativewind";

/**
 * NativeWind runtime theme variables. The Tailwind preset maps every color to
 * `var(--aulora-*)`; swapping the variables here follows the OS appearance
 * without duplicating a single class name.
 */
export function useThemeVars() {
  const palette = usePalette();
  return vars(
    Object.fromEntries(
      Object.entries(palette).map(([token, value]) => [`--aulora-${token}`, value]),
    ),
  );
}
