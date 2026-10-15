import { describe, expect, it } from "vitest";
import { avatarField, avatarHead, avatarHue } from "../src";

const HEX = /^#[0-9a-f]{6}$/;

describe("avatarHue", () => {
  it("is deterministic and inside the wheel", () => {
    const hue = avatarHue("aulora:server:acme");
    expect(hue).toBe(avatarHue("aulora:server:acme"));
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
    expect(avatarHue("aulora:server:other")).not.toBe(hue);
  });

  it("reads the same hue the creature is drawn from", () => {
    expect(avatarHead("aulora:server:acme")).toMatch(HEX);
    expect(avatarHead("aulora:server:acme", "dark")).not.toBe(
      avatarHead("aulora:server:acme", "light"),
    );
  });
});

describe("avatarField", () => {
  it("returns a positioned blob per hue slot, off the frame's centre", () => {
    const field = avatarField("aulora:server:acme");
    expect(field.blobs).toHaveLength(4);
    for (const blob of field.blobs) {
      expect(blob.color).toMatch(HEX);
      expect(blob.r).toBeGreaterThan(0.5);
      expect(blob.opacity).toBeGreaterThan(0);
      expect(blob.opacity).toBeLessThanOrEqual(1);
      // Cores sit on or past an edge, which is what keeps the field saturated.
      expect(blob.cx < 0.2 || blob.cx > 0.8 || blob.cy < 0.2 || blob.cy > 0.8).toBe(true);
    }
    expect(field.opacity).toBeGreaterThan(0.4);
    expect(field.opacity).toBeLessThan(1);
  });

  it("tunes the same seed differently per appearance", () => {
    const dark = avatarField("aulora:server:acme", "dark");
    const light = avatarField("aulora:server:acme", "light");
    expect(dark.blobs.map((blob) => blob.color)).not.toEqual(light.blobs.map((blob) => blob.color));
    expect(dark.hue).toBe(light.hue);
  });

  it("gives two workspaces two different fields", () => {
    const acme = avatarField("aulora:server:acme");
    const lumen = avatarField("aulora:server:lumen");
    expect(acme.blobs[0]?.color).not.toBe(lumen.blobs[0]?.color);
  });
});
