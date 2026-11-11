import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrastRatio as contrast } from "@aulora/core/role-color";
import { darkPalette, lightPalette } from "@aulora/tokens";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps web text and button labels above 4.5:1 in both appearances", () => {
  for (const palette of [darkPalette, lightPalette]) {
    for (const surface of ["bg", "surface-1", "surface-2", "surface-3", "chat"] as const) {
      for (const foreground of ["text", "text-muted", "accent", "secondary", "danger"] as const) {
        expect(
          contrast(palette[foreground], palette[surface]),
          `${foreground} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(palette["on-accent"], palette.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.bg, palette.danger)).toBeGreaterThanOrEqual(4.5);
  }
});

function blend(foreground: string, background: string, alpha: number): string {
  return `#${[1, 3, 5]
    .map((offset) =>
      Math.round(
        Number.parseInt(foreground.slice(offset, offset + 2), 16) * alpha +
          Number.parseInt(background.slice(offset, offset + 2), 16) * (1 - alpha),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

function semanticClasses(text: string) {
  const foregrounds = [
    ...text.matchAll(/(?<![\w-])text-(danger|accent|secondary|text-muted)(-text)?(?![\w/-])/g),
  ];
  const tintedBackgrounds = [
    ...text.matchAll(
      /(?<![\w-])bg-(danger|accent|secondary)(-soft)?(?:\/(?:\[([0-9.]+)\]|([0-9]+)))?(?![\w/-])/g,
    ),
  ].filter((match) => match[2] || match[3] || match[4]);
  return { foregrounds, tintedBackgrounds };
}

it("scans soft background opacity variants and muted text", () => {
  const classes = semanticClasses("text-text-muted bg-accent-soft/80 hover:bg-accent-soft/[0.5]");
  expect(classes.foregrounds.map((match) => match[0])).toEqual(["text-text-muted"]);
  expect(
    classes.tintedBackgrounds.map((match) => [match[0], match[2], match[3], match[4]]),
  ).toEqual([
    ["bg-accent-soft/80", "-soft", undefined, "80"],
    ["bg-accent-soft/[0.5]", "-soft", "0.5", undefined],
  ]);
});

it("checks actual semantic class pairs against every content surface in both themes", () => {
  let pairs = 0;
  const files = ["../../../../packages/ui-web/src/", "../"].flatMap((path) =>
    sourceFiles(fileURLToPath(new URL(path, import.meta.url))),
  );
  for (const path of files) {
    if (/\.test\./.test(path)) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        const text = node.text;
        const { foregrounds, tintedBackgrounds } = semanticClasses(text);
        for (const fg of foregrounds) {
          const foreground = `${fg[1]}${fg[2] ?? ""}` as keyof typeof darkPalette;
          for (const bg of tintedBackgrounds) {
            const variant = (index: number) =>
              text.slice(0, index).match(/(?:[\w-]+:)+$/)?.[0] ?? "";
            const fgVariant = variant(fg.index);
            const bgVariant = variant(bg.index);
            if (fgVariant !== bgVariant) {
              if (fgVariant !== "") continue;
              // A hover/focus foreground replaces the base foreground in that
              // state; comparing both would invent a pair that never renders.
              if (foregrounds.some((other) => variant(other.index) === bgVariant)) continue;
            }
            pairs++;
            const tint = bg[1] as "danger" | "accent" | "secondary";
            for (const [theme, palette] of Object.entries({
              light: lightPalette,
              dark: darkPalette,
            })) {
              const soft = palette["accent-soft"];
              const alpha =
                (bg[2] === "-soft" ? Number.parseInt(soft.slice(7, 9), 16) / 255 : 1) *
                (bg[3] !== undefined
                  ? Number(bg[3])
                  : bg[4] !== undefined
                    ? Number(bg[4]) / 100
                    : 1);
              const color = bg[2] === "-soft" ? soft.slice(0, 7) : palette[tint];
              for (const surface of [
                "bg",
                "surface-1",
                "surface-2",
                "surface-3",
                "chat",
              ] as const) {
                expect(
                  contrast(palette[foreground], blend(color, palette[surface], alpha)),
                  `${path}: ${theme} ${fg[0]} on ${bg[0]} over ${surface}`,
                ).toBeGreaterThanOrEqual(4.5);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(pairs).toBeGreaterThan(30);
});

// Disabled controls are exempt from WCAG text contrast; transient drag and
// entrance states are not resting content. Exceptions are scoped to the exact
// class fragment so another wrapper in the same file still fails this audit.
const opacityExceptions: Record<string, string> = {
  "Checkbox.tsx: cursor-not-allowed opacity-50": "Disabled checkbox label.",
  "Switch.tsx: opacity-50": "Disabled switch and its label.",
  "components/admin/Combobox.tsx: cursor-not-allowed opacity-50": "Disabled option.",
  "components/admin/OverrideTriState.tsx: opacity-50": "Disabled permission control.",
  "components/admin/PermissionsToggles.tsx: pointer-events-none opacity-50":
    "Disabled or locked permission control.",
  "components/admin/RoleColorPicker.tsx: opacity-50":
    "Disabled color controls; custom role contrast is a separate follow-up.",
  "components/admin/bots/BotGrantsGrid.tsx: pointer-events-none opacity-50":
    "Disabled bot permission controls.",
  "components/admin/bots/BotGrantsGrid.tsx: flex items-start gap-2.5 rounded-[9px] border border-border bg-surface-2 px-2.5 py-1.5 opacity-60":
    "Unavailable bot permissions shown as disabled controls.",
  "components/chat/ChannelSidebarChrome.tsx: opacity-50": "Transient drag state.",
  "components/chat/ChannelSidebarRows.tsx: opacity-40": "Transient drag state.",
  "components/chat/MessageList.tsx: opacity-70":
    "Transient unsent message; delivery failure is separately labeled.",
  "components/chat/PeoplePicker.tsx: opacity-45": "Disabled unchecked option.",
};

function textOpacityWrappers(source: ts.SourceFile): string[] {
  const violations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const attribute = opening.attributes.properties.find(
        (prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === "className",
      );
      if (
        attribute &&
        /\btext-(?:text|accent|secondary|danger|on-accent)\b/.test(node.getText(source))
      ) {
        const inspect = (part: ts.Node) => {
          if (ts.isStringLiteralLike(part)) {
            // State-prefixed disabled opacity is exempt; base opacity affects
            // all descendant labels, including dynamically conditional classes.
            if (/(?<![\w:-])opacity-(?!100\b|0\b)\d+\b/.test(part.text)) {
              violations.push(part.text);
            }
          }
          ts.forEachChild(part, inspect);
        };
        inspect(attribute);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

it("detects opacity on text-bearing wrappers including conditional row classes", () => {
  const source = ts.createSourceFile(
    "fixture.tsx",
    '<button className={cn("row", offline && "opacity-60 hover:opacity-100")}><span className="text-text-muted">Offline</span></button>',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  expect(textOpacityWrappers(source)).toEqual(["opacity-60 hover:opacity-100"]);
});

it("keeps text-bearing wrappers free of unreviewed opacity", () => {
  const violations: string[] = [];
  for (const path of ["../../../../packages/ui-web/src/", "../"].flatMap((directory) =>
    sourceFiles(fileURLToPath(new URL(directory, import.meta.url))),
  )) {
    if (/\.test\./.test(path)) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const classes of textOpacityWrappers(source)) {
      const key = `${path.split("/src/")[1]?.replace(/^\/+/, "")}: ${classes}`;
      if (!opacityExceptions[key]) violations.push(key);
    }
  }
  expect(violations).toEqual([]);
});
