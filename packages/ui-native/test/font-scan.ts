/**
 * Source scan for text primitives that would draw the platform font.
 *
 * React Native registers one family per static Inter file, so a raw `Text`,
 * `TextInput` or `BottomSheetTextInput` falls back to Roboto/SF unless it is
 * given the shipped face. Every such tag must carry `nativeFontStyle(...)`, a
 * value built from it in the same file, or an explicit `fontFamily`; anything
 * else should use the shared `Text`, `Heading` or `TextField`.
 */

/** Raw primitives by module: imported names that render text without a face. */
const RAW_PRIMITIVES: ReadonlyMap<string, readonly string[]> = new Map([
  ["react-native", ["Text", "TextInput"]],
  ["react-native-gesture-handler", ["TextInput"]],
  ["@gorhom/bottom-sheet", ["BottomSheetTextInput"]],
]);

/** A JSX opening tag's name, up to the whitespace, `>` or `/` that ends it. */
const OPENING_TAG = /<([A-Za-z][\w.]*)(?=[\s>/])/g;
const WORD_CHAR = /\w/;

/** Whether `word` occurs in `text` delimited by non-word characters on both sides. */
function hasWord(text: string, word: string): boolean {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (!WORD_CHAR.test(text.charAt(at - 1)) && !WORD_CHAR.test(text.charAt(at + word.length))) {
      return true;
    }
  }
  return false;
}

const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

/** Local names a file binds to raw text primitives, including aliases. */
function rawNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(IMPORT)) {
    const allowed = RAW_PRIMITIVES.get(match.at(2) ?? "");
    if (allowed === undefined) continue;
    for (const specifier of (match.at(1) ?? "").split(",")) {
      const parts = specifier.trim().split(/\s+as\s+/);
      const imported = parts[0]?.trim() ?? "";
      if (imported.startsWith("type ") || !allowed.includes(imported)) continue;
      names.add((parts[1] ?? imported).trim());
    }
  }
  // `Animated.Text` from React Native or Reanimated is a raw text node too.
  if (/\bimport\s+(?:Animated\b|\{[^}]*\bAnimated\b[^}]*\})/.test(source)) {
    names.add("Animated.Text");
    names.add("Animated.TextInput");
  }
  return [...names];
}

/** The opening tag starting at `start`, up to its `>` outside any `{...}`. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}

export interface FontScanResult {
  /** Raw primitive tags found, as `path:line <Name>`. */
  readonly checked: readonly string[];
  /** Tags among them that draw no shipped face. */
  readonly bare: readonly string[];
}

/** Scans raw sources (path to text) for raw text primitives without a face. */
export function scanTextFaces(sources: Readonly<Record<string, string>>): FontScanResult {
  const checked: string[] = [];
  const bare: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const names = rawNames(source);
    if (names.length === 0) continue;
    // `const font = nativeFontStyle(...)` lets the tag reference `font`.
    const faces = [...source.matchAll(/\bconst\s+(\w+)\s*(?::[^=]+)?=\s*nativeFontStyle\(/g)].map(
      (match) => match.at(1) ?? "",
    );
    for (const name of names) {
      for (const match of source.matchAll(OPENING_TAG)) {
        if (match.at(1) !== name) continue;
        const text = openingTag(source, match.index);
        const label = `${path}:${source.slice(0, match.index).split("\n").length} <${name}>`;
        checked.push(label);
        const faced =
          text.includes("nativeFontStyle(") ||
          /\bfontFamily\s*:/.test(text) ||
          faces.some((face) => hasWord(text, face));
        if (!faced) bare.push(label);
      }
    }
  }
  return { checked, bare };
}

const MONO = /(?:\bmono\b(?!-)|font-mono)/;
const HEAVY_CLASS = /font-(?:medium|semibold|bold|extrabold|black)\b/;
const HEAVY_STYLE = /fontWeight\s*[:=]\s*\{?\s*["']?(?:[5-9]00|bold)\b/;

/**
 * JetBrains Mono ships at 400 only (see packages/tokens/fonts/README.md), so a
 * mono text node that asks for a heavier weight would silently draw Regular, or a
 * platform-synthesised bold on Android. Returns `path:line <Tag>` for every JSX
 * opening tag that combines mono with a weight above 400.
 */
export function scanMonoWeights(sources: Readonly<Record<string, string>>): {
  readonly checked: number;
  readonly heavy: readonly string[];
} {
  let checked = 0;
  const heavy: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    for (const match of source.matchAll(OPENING_TAG)) {
      const text = openingTag(source, match.index);
      if (!MONO.test(text)) continue;
      checked += 1;
      if (HEAVY_CLASS.test(text) || HEAVY_STYLE.test(text)) {
        heavy.push(`${path}:${source.slice(0, match.index).split("\n").length} <${match[1]}>`);
      }
    }
  }
  return { checked, heavy };
}
