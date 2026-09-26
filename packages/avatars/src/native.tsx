/**
 * Phase 4 — React Native avatar entrypoint (not built yet).
 *
 * The approved native path is the core string API rendered through
 * `react-native-svg`'s `<SvgXml>`:
 *
 * ```tsx
 * import { SvgXml } from "react-native-svg";
 * import { avatarSvg } from "@aulora/avatars"; // raw `<svg>` string
 *
 * export function NativeAvatar({ seed, size = 32 }: { seed: string; size?: number }) {
 *   return <SvgXml xml={avatarSvg(seed, { size })} width={size} height={size} />;
 * }
 * ```
 *
 * Why this file exists now: it is a clearly-named placeholder so the mobile
 * adapter is not forgotten, and so the web bundle never imports
 * `react-native-svg`. Phase 0 Spike C proved the parser and element tree; the
 * RN and `react-native-svg` dependencies (and animation) land with the Expo app
 * in Phase 4. Do not export this from the package root.
 */
export {};
