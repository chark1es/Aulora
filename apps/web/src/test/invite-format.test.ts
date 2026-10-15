import { describe, expect, it } from "vitest";
import {
  buildCreateArgs,
  defaultUses,
  expiryLabel,
  INITIAL_DRAFT,
  resolveExpiry,
  resolveMaxUses,
  statusLabel,
  usesLabel,
} from "../lib/invite-format";

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

describe("resolveExpiry", () => {
  it("adds the preset to now, and never means null", () => {
    expect(resolveExpiry("1d", "", NOW)).toEqual({ ok: true, expiresAt: NOW + 86_400_000 });
    expect(resolveExpiry("30d", "", NOW)).toEqual({ ok: true, expiresAt: NOW + 30 * 86_400_000 });
    expect(resolveExpiry("never", "", NOW)).toEqual({ ok: true, expiresAt: null });
  });

  it("validates a custom date", () => {
    expect(resolveExpiry("custom", "", NOW)).toMatchObject({ ok: false });
    expect(resolveExpiry("custom", "2020-01-01T10:00", NOW)).toMatchObject({
      ok: false,
      error: expect.stringContaining("future"),
    });
    const result = resolveExpiry("custom", "2030-01-01T10:00", NOW);
    expect(result).toMatchObject({ ok: true });
  });
});

describe("resolveMaxUses", () => {
  it("maps modes to the server's convention", () => {
    expect(resolveMaxUses("once", "")).toEqual({ ok: true, maxUses: 1 });
    expect(resolveMaxUses("unlimited", "")).toEqual({ ok: true, maxUses: 0 });
    expect(resolveMaxUses("limited", "12")).toEqual({ ok: true, maxUses: 12 });
  });

  it("rejects counts that are not whole numbers of at least two", () => {
    for (const bad of ["", "abc", "1", "2.5", "-3", "100001"]) {
      expect(resolveMaxUses("limited", bad)).toMatchObject({ ok: false });
    }
  });
});

describe("labels", () => {
  it("describes expiry, use and status", () => {
    expect(expiryLabel(null, NOW)).toBe("Never expires");
    expect(expiryLabel(NOW + 1000, NOW)).toMatch(/^Expires /);
    expect(expiryLabel(NOW - 1000, NOW)).toMatch(/^Expired /);
    expect(usesLabel(0, 0)).toBe("0 used · no limit");
    expect(usesLabel(0, 1)).toBe("One time");
    expect(usesLabel(1, 1)).toBe("Used");
    expect(usesLabel(2, 5)).toBe("2 of 5 used");
    expect(statusLabel("exhausted")).toBe("Used up");
  });
});

describe("buildCreateArgs", () => {
  const base = { ...INITIAL_DRAFT };

  it("builds a link with the default week and no use limit", () => {
    expect(buildCreateArgs(base, NOW)).toEqual({
      ok: true,
      args: { kind: "link", expiresAt: NOW + 7 * 86_400_000, maxUses: 0 },
    });
  });

  it("carries an indefinite expiry, a limit, a recipient and a note", () => {
    const result = buildCreateArgs(
      {
        ...base,
        kind: "code",
        expiry: "never",
        uses: "limited",
        count: "4",
        email: " Sam@Acme.com ",
        note: " onboarding ",
      },
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      args: {
        kind: "code",
        expiresAt: null,
        maxUses: 4,
        email: "Sam@Acme.com",
        note: "onboarding",
      },
    });
  });

  it("leaves the use limit to the server for an emailed invite", () => {
    const result = buildCreateArgs(
      { ...base, kind: "email", email: "sam@acme.com", uses: "once" },
      NOW,
    );
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && "maxUses" in result.args).toBe(false);
  });

  it("explains what is missing", () => {
    expect(buildCreateArgs({ ...base, kind: "email" }, NOW)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Enter the email"),
    });
    expect(buildCreateArgs({ ...base, email: "nope" }, NOW)).toMatchObject({ ok: false });
    expect(buildCreateArgs({ ...base, expiry: "custom" }, NOW)).toMatchObject({ ok: false });
    expect(buildCreateArgs({ ...base, uses: "limited", count: "1" }, NOW)).toMatchObject({
      ok: false,
    });
  });
});

describe("defaultUses", () => {
  it("makes codes and emails one-time by default", () => {
    expect(defaultUses("link")).toBe("unlimited");
    expect(defaultUses("code")).toBe("once");
    expect(defaultUses("email")).toBe("once");
  });
});
