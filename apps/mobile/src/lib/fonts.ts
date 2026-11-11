import { nativeFontFamilies } from "@aulora/tokens";

/**
 * The static Inter and JetBrains Mono faces, registered under the family names
 * `@aulora/tokens` hands to every `Text` and `TextInput`. Loaded by the root
 * layout before the first screen renders. Metro needs literal `require` paths.
 */
export const FONT_ASSETS = {
  [nativeFontFamilies.sans[400]]: require("@aulora/tokens/fonts/native/Inter-Regular.ttf"),
  [nativeFontFamilies.sans[500]]: require("@aulora/tokens/fonts/native/Inter-Medium.ttf"),
  [nativeFontFamilies.sans[600]]: require("@aulora/tokens/fonts/native/Inter-SemiBold.ttf"),
  [nativeFontFamilies.sans[700]]: require("@aulora/tokens/fonts/native/Inter-Bold.ttf"),
  [nativeFontFamilies.sans.italic]: require("@aulora/tokens/fonts/native/Inter-Italic.ttf"),
  [nativeFontFamilies.mono[400]]: require("@aulora/tokens/fonts/native/JetBrainsMono-Regular.ttf"),
} as const;
