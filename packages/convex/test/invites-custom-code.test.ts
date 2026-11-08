import { normalizeInviteCode } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { sha256Hex } from "../convex/lib/crypto";
import { pickInviteByCode } from "../convex/lib/inviteState";
import { newTest, seedWorkspace } from "./helpers";

const OWNER = { subject: "owner-1" };

async function setup() {
  const t = newTest();
  await seedWorkspace(t);
  return { t, owner: t.withIdentity(OWNER) };
}

describe("invites.create with a custom code", () => {
  it("stores only the hash and echoes the code once", async () => {
    const { t, owner } = await setup();
    const result = await owner.mutation(api.invites.create, {
      kind: "code",
      customCode: " WELCOME-TEAM ",
    });

    expect(result).toMatchObject({ code: "WELCOME-TEAM", kind: "code" });

    const rows = await t.run(async (ctx) => await ctx.db.query("invites").collect());
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("invite row missing");
    }
    expect(row.code).toBe(await sha256Hex(normalizeInviteCode("WELCOME-TEAM")));
    expect(row.code).not.toContain("WELCOME");
    expect(row.codeHint).toBe("TEAM");
    expect(row.kind).toBe("code");
  });

  it("keeps generating random codes when no custom code is given", async () => {
    const { t, owner } = await setup();
    const result = await owner.mutation(api.invites.create, { kind: "code" });

    expect(result.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    const rows = await t.run(async (ctx) => await ctx.db.query("invites").collect());
    expect(rows[0]?.code).toBe(await sha256Hex(normalizeInviteCode(result.code)));
  });

  it("rejects a custom code for link and email invites", async () => {
    const { owner } = await setup();
    await expect(
      owner.mutation(api.invites.create, { kind: "link", customCode: "WELCOME-TEAM" }),
    ).rejects.toThrow("Custom codes are only available for code invites");
    await expect(
      owner.mutation(api.invites.create, {
        kind: "email",
        email: "sam@acme.com",
        customCode: "WELCOME-TEAM",
      }),
    ).rejects.toThrow("Custom codes are only available for code invites");
  });

  it("rejects codes that break the shared rule", async () => {
    const { owner } = await setup();
    await expect(
      owner.mutation(api.invites.create, { kind: "code", customCode: "short" }),
    ).rejects.toThrow("at least 6 characters");
    await expect(
      owner.mutation(api.invites.create, { kind: "code", customCode: "welcome team" }),
    ).rejects.toThrow("Use only letters, digits, dashes and underscores");
  });

  it("refuses a code that an active invite already uses", async () => {
    const { owner } = await setup();
    await owner.mutation(api.invites.create, { kind: "code", customCode: "WELCOME-TEAM" });

    await expect(
      owner.mutation(api.invites.create, { kind: "code", customCode: "welcome-team" }),
    ).rejects.toThrow("That code is already in use");
  });
});

describe("invites.redeem with a custom code", () => {
  it("matches case, dashes, spaces and lookalike letters", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.invites.create, { kind: "code", customCode: "aulora2026" });

    const outcome = await t
      .withIdentity({ subject: "joiner-1" })
      .mutation(api.invites.redeem, { code: " AU1ORA-2026 " });

    expect(outcome).toEqual({ joined: true, alreadyMember: false });
    const members = await t.run(async (ctx) => await ctx.db.query("members").collect());
    expect(members.some((member) => member.userId === "joiner-1")).toBe(true);
  });

  it("reuses the code once the old invite is revoked and redeems the new one", async () => {
    const { t, owner } = await setup();
    const first = await owner.mutation(api.invites.create, {
      kind: "code",
      customCode: "WELCOME-TEAM",
    });
    await owner.mutation(api.invites.revoke, { inviteId: first.inviteId });
    const second = await owner.mutation(api.invites.create, {
      kind: "code",
      customCode: "welcome-team",
    });
    expect(second.inviteId).not.toBe(first.inviteId);

    const inspect = await t.query(api.invites.inspect, { code: "welcome-team" });
    expect(inspect).toMatchObject({ valid: true });

    const outcome = await t
      .withIdentity({ subject: "joiner-2" })
      .mutation(api.invites.redeem, { code: "welcome team" });
    expect(outcome).toEqual({ joined: true, alreadyMember: false });

    const rows = await t.run(async (ctx) => await ctx.db.query("inviteRedemptions").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.inviteId).toBe(second.inviteId);
  });
});

describe("pickInviteByCode", () => {
  const now = 1_000;

  it("prefers the active row when a hash appears more than once", () => {
    const revoked = { _creationTime: 2, maxUses: 0, uses: 0, revokedAt: now - 1 };
    const active = { _creationTime: 1, maxUses: 0, uses: 0 };
    expect(pickInviteByCode([revoked, active], now)).toBe(active);
  });

  it("falls back to the newest row so a refusal has a reason", () => {
    const expired = { _creationTime: 1, maxUses: 0, uses: 0, expiresAt: now - 1 };
    const revoked = { _creationTime: 2, maxUses: 0, uses: 0, revokedAt: now - 1 };
    expect(pickInviteByCode([expired, revoked], now)).toBe(revoked);
    expect(pickInviteByCode([], now)).toBeNull();
  });
});
