import { describe, expect, it } from "vitest";
import { assessOwnerPassword } from "../src/setup";

describe("assessOwnerPassword", () => {
  it("rejects an empty password", () => {
    expect(assessOwnerPassword("")).toMatchObject({ valid: false, score: 0 });
  });

  it("enforces the shared minimum even when the deployment lowers it", () => {
    expect(assessOwnerPassword("short", 1)).toMatchObject({
      valid: false,
      score: 1,
    });
  });

  it("rejects a common password with a recovery hint", () => {
    expect(assessOwnerPassword("password")).toMatchObject({
      valid: false,
      problem: expect.stringMatching(/too common/i),
    });
  });

  it("requires three character classes below passphrase length", () => {
    expect(assessOwnerPassword("lowercaseonly")).toMatchObject({ valid: false });
    expect(assessOwnerPassword("lowercase9")).toMatchObject({ valid: false });
    expect(assessOwnerPassword("Lowercase9!")).toMatchObject({ valid: true });
  });

  it("accepts a long passphrase on length alone and rates it strong", () => {
    const result = assessOwnerPassword("correct horse battery staple");
    expect(result).toMatchObject({ valid: true, label: "Strong", score: 4 });
  });

  it("honours a higher configured minimum", () => {
    expect(assessOwnerPassword("Lowercase9!", 20)).toMatchObject({ valid: false });
    expect(assessOwnerPassword("LowerCase-Passphrase-20", 20)).toMatchObject({ valid: true });
  });
});
