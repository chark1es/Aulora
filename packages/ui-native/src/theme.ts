import type { Palette } from "@aulora/tokens";
import { useColorScheme } from "react-native";
import { paletteForScheme } from "./colors";

/** The active Aulora palette, following the OS appearance. */
export function usePalette(): Palette {
  return paletteForScheme(useColorScheme());
}
