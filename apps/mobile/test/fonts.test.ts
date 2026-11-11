import { nativeFontFamilies } from "@aulora/tokens";
import { describe, expect, it } from "vitest";
import { scanTextFaces } from "../../../packages/ui-native/test/font-scan";

const sources = import.meta.glob(["../app/**/*.tsx", "../src/**/*.{ts,tsx}"], {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const shipped = Object.keys(
  import.meta.glob(["../../../packages/tokens/fonts/native/*.ttf"], {
    eager: true,
    query: "?url",
    import: "default",
  }),
);

const families = [
  ...Object.values(nativeFontFamilies.sans),
  ...Object.values(nativeFontFamilies.mono),
];

describe("mobile fonts", () => {
  it("bundles one static file per registered family", () => {
    const assets = sources["../src/lib/fonts.ts"] ?? "";
    for (const family of families) {
      expect(assets).toContain(`require("@aulora/tokens/fonts/native/${family}.ttf")`);
      expect(shipped).toContain(`../../../packages/tokens/fonts/native/${family}.ttf`);
    }
  });

  it("holds the splash until the fonts are registered", () => {
    const layout = sources["../app/_layout.tsx"] ?? "";
    expect(layout).toContain("useFonts(FONT_ASSETS)");
    expect(layout).toContain("SplashScreen.preventAutoHideAsync()");
    expect(layout).toContain("SplashScreen.hideAsync()");
    expect(layout).toContain("if (!fontsReady) return null;");
  });

  it("draws text inputs through the shared TextField", () => {
    const raw = Object.entries(sources)
      .filter(([, source]) => /<TextInput(?=\s|>)/.test(source))
      .map(([path]) => path);
    expect(raw).toEqual([]);
  });

  // Bottom-sheet inputs cannot be a TextField (the sheet needs its own input to
  // track the keyboard), so each one must carry the shipped face itself.
  it("gives every raw text node and bottom-sheet input the shipped face", () => {
    const { checked, bare } = scanTextFaces(sources);
    expect(checked.filter((tag) => tag.endsWith("<BottomSheetTextInput>")).length).toBeGreaterThan(
      2,
    );
    expect(bare).toEqual([]);
  });

  it("draws code inside bold text at the one shipped mono weight", () => {
    // Mono ships at 400 only; the renderer pins it so **bold `code`** is the same on iOS and Android.
    const rich = sources["../src/components/chat/RichText.tsx"] ?? "";
    expect(rich).toMatch(
      /function renderCodeSegment[\s\S]*?mono\s+style=\{\{[\s\S]*?fontWeight: "400"/,
    );
    expect(Object.keys(nativeFontFamilies.mono)).toEqual(["400"]);
  });
});
