import { formatShortcut } from "@aulora/core";

/**
 * Whether shortcuts should read as Apple ones (⌘, ⌥, ⇧). Decided by the OS the
 * page runs on, not the build: the Windows and Linux desktop apps and every
 * non-Apple browser get "Ctrl+K", macOS and iPadOS get "⌘K".
 */
export function isApplePlatform(
  platform: string = typeof navigator === "undefined" ? "" : String(navigator.platform),
  userAgent: string = typeof navigator === "undefined" ? "" : String(navigator.userAgent),
): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform) || /mac os x|macintosh/i.test(userAgent);
}

/**
 * A key combination for display, e.g. `shortcutLabel(["Mod", "K"])` is "⌘K" on
 * macOS and "Ctrl+K" elsewhere. `Mod` is the platform's command modifier.
 */
export function shortcutLabel(
  parts: readonly string[],
  apple: boolean = isApplePlatform(),
): string {
  return formatShortcut(parts, apple);
}
