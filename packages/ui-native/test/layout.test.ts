import { expect, it } from "vitest";

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; query: string; import: string },
    ): Record<string, string>;
  }
}
const source = import.meta.glob("../src/*.tsx", { eager: true, query: "?raw", import: "default" });
it("keeps shared typography shrinkable without disabling font scaling", () => {
  for (const name of ["Text", "Heading"]) {
    expect(source[`../src/${name}.tsx`]).toContain("flexShrink: 1, minWidth: 0");
    expect(source[`../src/${name}.tsx`]).toContain('ellipsizeMode="tail"');
    expect(source[`../src/${name}.tsx`]).not.toContain("allowFontScaling={false}");
  }
});
it("gives action labels a bounded text box and badges a growing height", () => {
  expect(source["../src/Button.tsx"]).toContain("flexShrink: 1");
  expect(source["../src/Button.tsx"]).toContain("numberOfLines={2}");
  expect(source["../src/CountBadge.tsx"]).toContain("minHeight: dimension");
  expect(source["../src/CountBadge.tsx"]).not.toMatch(/\bheight: dimension/);
});
it("lets the role-color swatch label grow with text size instead of breaking mid-word", () => {
  const preview = source["../src/RoleColorPreview.tsx"] ?? "";
  expect(preview).toContain('className="min-w-20 shrink-0"');
  expect(preview).not.toMatch(/className="w-20"/);
  expect(preview).toContain("flex-row flex-wrap items-center gap-x-2 gap-y-1");
});
