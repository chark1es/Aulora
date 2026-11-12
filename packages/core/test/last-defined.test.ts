import { describe, expect, it } from "vitest";
import { keepLastDefined } from "../src/index";

describe("keepLastDefined", () => {
  it("keeps the previous answer while the next one is missing", () => {
    expect(keepLastDefined({ member: "u1" }, undefined)).toEqual({ member: "u1" });
  });

  it("takes a new defined answer", () => {
    expect(keepLastDefined({ member: "u1" }, { member: "u2" })).toEqual({ member: "u2" });
  });

  it("stays empty before the first answer", () => {
    expect(keepLastDefined(undefined, undefined)).toBeUndefined();
  });
});
