import { describe, expect, it } from "vitest";
import { classFontWeight, classIsItalic, classIsMono, nativeFontStyle } from "../src/typography";
import { scanMonoWeights, scanTextFaces } from "./font-scan";

declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { eager: true; query: string; import: string },
    ): Record<string, string>;
  }
}

describe("native typography", () => {
  it("reads the last weight class, including important ones", () => {
    expect(classFontWeight("text-sm font-medium")).toBe(500);
    expect(classFontWeight("font-medium !font-bold")).toBe(700);
    expect(classFontWeight("text-text font-mono")).toBeUndefined();
    expect(classFontWeight("font-semibold-ish")).toBeUndefined();
    expect(classIsMono("text-xs font-mono")).toBe(true);
    expect(classIsItalic("italic text-xs")).toBe(true);
    expect(classIsItalic("not-italic")).toBe(false);
  });

  it("selects the registered Inter file and drops Android font padding", () => {
    expect(nativeFontStyle({})).toEqual({ fontFamily: "Inter-Regular", includeFontPadding: false });
    expect(nativeFontStyle({ className: "font-semibold" }).fontFamily).toBe("Inter-SemiBold");
    // An explicit style weight wins over the class, as it does in NativeWind.
    expect(nativeFontStyle({ className: "font-semibold", fontWeight: "700" }).fontFamily).toBe(
      "Inter-Bold",
    );
    expect(nativeFontStyle({ fontStyle: "italic" }).fontFamily).toBe("Inter-Italic");
    expect(nativeFontStyle({ className: "italic", fontStyle: "normal" }).fontFamily).toBe(
      "Inter-Regular",
    );
    expect(nativeFontStyle({ mono: true, className: "font-bold" }).fontFamily).toBe(
      "JetBrainsMono-Regular",
    );
  });
});

const source = import.meta.glob("../src/*.tsx", { eager: true, query: "?raw", import: "default" });
describe("primitives", () => {
  it("route every text and input primitive through the shared face", () => {
    for (const name of ["Text", "Heading", "CountBadge", "TextField"]) {
      expect(source[`../src/${name}.tsx`]).toContain("nativeFontStyle(");
    }
    expect(source["../src/Input.tsx"]).toContain("<TextField");
  });
});

const textSources = import.meta.glob(
  ["../src/**/*.tsx", "../../../apps/mobile/src/**/*.tsx", "../../../apps/mobile/app/**/*.tsx"],
  { eager: true, query: "?raw", import: "default" },
);

describe("shipped face coverage", () => {
  it("gives every raw text and input primitive in ui-native and mobile the Inter face", () => {
    const { checked, bare } = scanTextFaces(textSources);
    // The scan must see the primitives it guards, or it proves nothing.
    expect(checked.some((tag) => tag.includes("RoleColorPreview.tsx"))).toBe(true);
    expect(checked.some((tag) => tag.includes("<BottomSheetTextInput>"))).toBe(true);
    expect(checked.some((tag) => tag.includes("TextField.tsx"))).toBe(true);
    expect(bare).toEqual([]);
  });

  it("flags bare, aliased and bottom-sheet primitives", () => {
    const { bare } = scanTextFaces({
      "a.tsx": `import { Text as RNText, View } from "react-native";\n<RNText style={{ fontWeight: "600" }}>x</RNText>`,
      "b.tsx": `import { BottomSheetTextInput } from "@gorhom/bottom-sheet";\n<BottomSheetTextInput style={inputStyle} />`,
      "c.tsx": `import { TextInput } from "react-native";\n<TextInput value={v} />`,
      "d.tsx": `import { Text as RNText } from "react-native";\n<RNText style={[nativeFontStyle({ fontWeight: "600" }), {}]}>x</RNText>`,
      "e.tsx": `import { TextInput } from "react-native";\nconst font = nativeFontStyle({});\n<TextInput style={[font, style]} />`,
    });
    expect(bare).toEqual([
      "a.tsx:2 <RNText>",
      "b.tsx:2 <BottomSheetTextInput>",
      "c.tsx:2 <TextInput>",
    ]);
  });

  it("lets an inline weight pick the static face in inputs as in text", () => {
    const field = source["../src/TextField.tsx"] ?? "";
    expect(field).toContain("StyleSheet.flatten(style)");
    expect(field).toContain("fontWeight: flat.fontWeight");
  });
});

describe("mono weights", () => {
  it("never asks for a mono weight the single shipped JetBrains Mono file lacks", () => {
    const { checked, heavy } = scanMonoWeights(textSources);
    // The scan must see mono nodes, or it proves nothing.
    expect(checked).toBeGreaterThan(5);
    expect(heavy).toEqual([]);
  });

  it("flags a heavy mono node when one is introduced", () => {
    const sample = {
      "a.tsx":
        '<Text mono className="font-semibold">x</Text><Text className="font-mono font-bold">',
      "b.tsx": '<RNText style={{ fontWeight: "700" }} mono>x</RNText>',
    };
    expect(scanMonoWeights(sample).heavy).toHaveLength(3);
  });
});
