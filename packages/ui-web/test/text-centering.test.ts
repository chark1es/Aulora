import { describe, expect, it } from "vitest";

/**
 * Source-level guard for the typography rule: a control that combines a fixed
 * height with its own text size must trim its label to Inter's cap band
 * (`CapText` / `CAP_TEXT_CLASS`) or carry a documented exception. Without one
 * of those, centring follows the font's line box instead of the letters and
 * drifts as soon as the face or size changes.
 *
 * This is deliberately a source scan rather than a browser measurement: it runs
 * in the normal unit suite, needs no Playwright, and fails on the next control
 * that forgets the rule. The pixel evidence lives in the shared measurement
 * harness; this keeps the rule enforced in CI.
 *
 * Write `// text-centering-ok: <reason>` within a few lines of the class list
 * when the exception is real (native inputs, icon-only squares, a deliberately
 * kept line box for `truncate`).
 */
// Fixed heights: `h-5`, `h-[22px]`, and `min-h-*` when it acts as a height
// (`min-h-0`, `min-h-full` and `min-h-screen` do not).
const FIXED_HEIGHT =
  /(?<![-\w])(?:min-)?h-(?!0(?![.\d])|full|screen|auto|fit|min|max|px(?![\w]))(?:\d+(?:\.\d+)?|\[\d+(?:\.\d+)?(?:px|rem)\])/;
// Arbitrary sizes (`text-[11px]`) and Tailwind token sizes (`text-sm`, `text-2xl`).
const FONT_SIZE =
  /(?<![-\w])text-(?:\[\d+(?:\.\d+)?(?:px|rem)\]|(?:xs|sm|base|lg|xl|[2-9]xl)(?![-\w]))/;
// `<CapText>` as rendered JSX, not merely the import: removing the wrapper
// while leaving the import must still fail.
const CAP_HELPER = /<CapText[\s>]|\bCAP_TEXT_CLASS\b/;
const EXCEPTION = /text-centering-ok:/;
// A control's label follows its class list, so the wrapper must appear within
// this many lines after the literal, and before the next flagged literal.
const LOOKAHEAD = 16;
const MARKER_LOOKBACK = 6;

interface RawGlob {
  glob: (
    pattern: string,
    options: { eager: true; query: string; import: "default" },
  ) => Record<string, string>;
}

const LITERAL = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

const isControl = (literal: string) => FIXED_HEIGHT.test(literal) && FONT_SIZE.test(literal);

/**
 * Violations as `line: class list`, empty when every control complies. Each
 * fixed-height + font-size literal must itself have a cap-trimmed label (a
 * `CapText` or `CAP_TEXT_CLASS` in the literal or just after it, before the
 * next control) or an explicit exception comment nearby; a helper elsewhere in
 * the file does not cover it.
 */
function findUncentredControls(source: string): string[] {
  const lines = source.split("\n");
  const controlLines = lines.map((line) => (line.match(LITERAL) ?? []).some(isControl));
  const violations: string[] = [];
  lines.forEach((line, index) => {
    for (const literal of line.match(LITERAL) ?? []) {
      if (!isControl(literal)) continue;
      if (CAP_HELPER.test(literal)) continue;
      const before = lines.slice(Math.max(0, index - MARKER_LOOKBACK), index + 1).join("\n");
      if (EXCEPTION.test(before)) continue;
      let end = index + 1;
      while (end <= index + LOOKAHEAD && end < lines.length && !controlLines[end]) end++;
      const after = lines.slice(index, end).join("\n");
      if (CAP_HELPER.test(after) || EXCEPTION.test(after)) continue;
      violations.push(`${index + 1}: ${literal.slice(0, 72)}`);
    }
  });
  return violations;
}

describe("fixed-height controls centre their cap band", () => {
  it("flags a text control that only has a fixed height and a font size", () => {
    const source = [
      "export function Pill() {",
      '  return <span className="inline-flex h-5 px-2 text-[11px]">{label}</span>;',
      "}",
    ].join("\n");
    expect(findUncentredControls(source)).toHaveLength(1);
  });

  it("flags token font sizes and min-h heights, but not min-h-0 or colour classes", () => {
    const row = (classes: string) => `  return <div className="${classes}">{label}</div>;`;
    expect(findUncentredControls(row("flex h-8 text-sm"))).toHaveLength(1);
    expect(findUncentredControls(row("flex min-h-9 text-base"))).toHaveLength(1);
    expect(findUncentredControls(row("flex min-h-0 text-sm"))).toEqual([]);
    expect(findUncentredControls(row("flex h-8 text-text-muted"))).toEqual([]);
  });

  it("checks each literal itself, not the whole file", () => {
    const source = [
      "export function Pair() {",
      "  return (",
      "    <>",
      '      <span className="inline-flex h-5 text-[11px]"><CapText>a</CapText></span>',
      '      <span className="inline-flex h-6 text-[11px]">{b}</span>',
      "    </>",
      "  );",
      "}",
    ].join("\n");
    expect(findUncentredControls(source)).toEqual([expect.stringMatching(/^5:/)]);
  });

  it("accepts CapText and the documented exception marker", () => {
    const withCapText = [
      "export function Pill() {",
      '  return <span className="inline-flex h-5 px-2 text-[11px]">',
      "    <CapText>{label}</CapText>",
      "</span>;",
      "}",
    ].join("\n");
    const withMarker = [
      "export function Field() {",
      "  // text-centering-ok: a native input centres its own value box.",
      '  return <input className="h-10 px-3 text-[14px]" />;',
      "}",
    ].join("\n");
    expect(findUncentredControls(withCapText)).toEqual([]);
    expect(findUncentredControls(withMarker)).toEqual([]);
  });

  it("leaves every component in packages/ui-web compliant", () => {
    // Vite's raw glob keeps this a pure source scan with no filesystem access,
    // so the test also runs in the browser-targeted workspace without Node types.
    const modules = (import.meta as unknown as RawGlob).glob("../src/**/*.tsx", {
      eager: true,
      query: "?raw",
      import: "default",
    });
    const offenders = Object.entries(modules).flatMap(([file, source]) =>
      findUncentredControls(source).map((violation) => `${file}:${violation}`),
    );
    expect(offenders).toEqual([]);
  });
});
