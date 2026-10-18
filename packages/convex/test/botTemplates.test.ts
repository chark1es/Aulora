import { describe, expect, it } from "vitest";
import { starterFiles } from "../convex/lib/botTemplates";

describe("bot starter templates", () => {
  it("writes one entry file per language and template", () => {
    for (const language of ["typescript", "python"] as const) {
      for (const template of ["hello", "blank"] as const) {
        const files = starterFiles(language, template);
        expect(files).toHaveLength(1);
        expect(files[0]?.path).toBe(language === "typescript" ? "main.ts" : "main.py");
      }
    }
  });

  it("starts the Python bot with the blocking run(), not the coroutine start()", () => {
    for (const template of ["hello", "blank"] as const) {
      const source = starterFiles("python", template)[0]?.content ?? "";
      expect(source).toContain("bot.run()");
      expect(source).not.toContain("bot.start()");
    }
  });

  it("reacts with a real emoji, not an unexpanded escape", () => {
    for (const language of ["typescript", "python"] as const) {
      const source = starterFiles(language, "hello")[0]?.content ?? "";
      expect(source).toContain("\u{1F44B}");
      expect(source).not.toContain("U0001F44B");
    }
  });
});
