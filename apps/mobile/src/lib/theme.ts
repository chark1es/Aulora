import { cssVariables, type ThemeName } from "@aulora/tokens";
import { vars } from "nativewind";
import { useColorScheme } from "react-native";

/**
 * NativeWind runtime theme variables. The Tailwind preset maps every color to
 * `var(--aulora-*)`; swapping the variables here follows the OS appearance
 * without duplicating a single class name.
 */
export function useThemeVars() {
  const scheme = useColorScheme();
  const theme: ThemeName = scheme === "light" ? "light" : "dark";
  return vars(cssVariables(theme));
}
