import { nativeFontFamily } from "@aulora/tokens";

/**
 * React Native registers one family name per static font file, so a weight
 * class alone (`font-semibold`) cannot select Inter SemiBold. These pure
 * helpers derive the registered family from the same weight the caller asked
 * for, so `Text`, `Heading`, inputs and badges all draw the shipped face.
 */

const WEIGHT_CLASSES = new Map<string, number>([
  ["thin", 100],
  ["extralight", 200],
  ["light", 300],
  ["normal", 400],
  ["medium", 500],
  ["semibold", 600],
  ["bold", 700],
  ["extrabold", 800],
  ["black", 900],
]);

const WEIGHT_CLASS =
  /(?:^|\s)!?font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?=\s|$)/g;

/** The weight a NativeWind class list asks for; the last weight class wins. */
export function classFontWeight(className: string | undefined): number | undefined {
  if (className === undefined) return undefined;
  let weight: number | undefined;
  for (const match of className.matchAll(WEIGHT_CLASS)) {
    weight = WEIGHT_CLASSES.get(match.at(1) ?? "");
  }
  return weight;
}

/** Whether a class list asks for italics. */
export function classIsItalic(className: string | undefined): boolean {
  return className !== undefined && /(?:^|\s)!?italic(?=\s|$)/.test(className);
}

/** Whether a class list switches to the mono family. */
export function classIsMono(className: string | undefined): boolean {
  return className !== undefined && /(?:^|\s)!?font-mono(?=\s|$)/.test(className);
}

export interface NativeFontStyle {
  readonly fontFamily: string;
  /** Android only: drop the legacy win-metric padding so text centres in its line box. */
  readonly includeFontPadding: false;
}

/**
 * The family and padding for a text node.
 *
 * Mono is shipped at 400 only, so a mono node always draws JetBrains Mono
 * Regular whatever weight it asks for; `scanMonoWeights` in the tests keeps
 * components from asking for one. Code inside bold text (`**a \`b\`**`) is
 * pinned to weight 400 by the renderer so iOS and Android agree.
 An explicit `fontWeight` in `style`
 * beats a weight class, matching how NativeWind merges `style` over classes.
 */
export function nativeFontStyle(options: {
  readonly className?: string | undefined;
  readonly fontWeight?: string | number | undefined;
  readonly fontStyle?: string | undefined;
  readonly mono?: boolean | undefined;
}): NativeFontStyle {
  const mono = options.mono === true || classIsMono(options.className);
  const weight = options.fontWeight ?? classFontWeight(options.className);
  const italic =
    options.fontStyle === undefined
      ? classIsItalic(options.className)
      : options.fontStyle === "italic";
  return {
    fontFamily: nativeFontFamily(weight, mono ? "mono" : "sans", italic),
    includeFontPadding: false,
  };
}
