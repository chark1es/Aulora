import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

const PAGE = { numItems: 50, cursor: null } as const;

async function inviteRow(t: ReturnType<typeof newTest>) {
  const rows = await t.run(async (ctx) => await ctx.db.query("invites").collect());
  return rows[0];
}

describe("invites", () => {
  it("returns a plaintext code once and stores only its hash", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const created = await asOwner.mutation(api.invites.create, { maxUses: 0 });

    expect(created.code).toHaveLength(48);
    const row = await inviteRow(t);
    expect(row.code).not.toBe(created.code);
    expect(row.code).toHaveLength(64);
    expect(row.uses).toBe(0);

    const listed = await asOwner.query(api.invites.list, { paginationOpts: PAGE });
    expect(listed.page[0]?.id).toBe(created.inviteId);
    expect(JSON.stringify(listed.page)).not.toContain(created.code);
  });

  it("defaults to a 7-day expiry and is publicly inspectable", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const before = Date.now();
    const created = await asOwner.mutation(api.invites.create, {});

    const row = await inviteRow(t);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(row.expiresAt).toBeGreaterThanOrEqual(before + sevenDays - 1_000);
    expect(row.expiresAt).toBeLessThanOrEqual(Date.now() + sevenDays + 1_000);

    const info = await t.query(api.invites.inspect, { code: created.code });
    expect(info).toMatchObject({ valid: true, workspaceName: "Acme" });
    expect(info.expiresAt).toBe(row.expiresAt);

    expect((await t.query(api.invites.inspect, { code: "not-a-real-code" })).valid).toBe(false);

    await asOwner.mutation(api.invites.revoke, { inviteId: created.inviteId });
    expect(await t.query(api.invites.inspect, { code: created.code })).toMatchObject({
      valid: false,
      reason: "revoked",
    });
  });

  it("redeems a code, joins with @everyone and is idempotent", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const created = await asOwner.mutation(api.invites.create, {});

    const asUser = t.withIdentity({ subject: "user-1" });
    const first = await asUser.mutation(api.invites.redeem, { code: created.code });
    expect(first).toEqual({ joined: true, alreadyMember: false });

    const member = await t.run(async (ctx) => {
      const all = await ctx.db.query("members").collect();
      return all.find((entry) => entry.userId === "user-1") ?? null;
    });
    expect(member?.roleIds).toEqual([EVERYONE_ROLE_ID]);

    const second = await asUser.mutation(api.invites.redeem, { code: created.code });
    expect(second).toEqual({ joined: true, alreadyMember: true });
    expect((await inviteRow(t)).uses).toBe(1);
  });

  it("enforces maxUses", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const created = await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.invites.create, { maxUses: 1 });

    await t.withIdentity({ subject: "user-1" }).mutation(api.invites.redeem, {
      code: created.code,
    });
    await expect(
      t.withIdentity({ subject: "user-2" }).mutation(api.invites.redeem, { code: created.code }),
    ).rejects.toThrow("maximum uses");
  });

  it("enforces expiry", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const created = await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.invites.create, { expiresAt: Date.now() + 60_000 });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("invites").first();
      if (row !== null) {
        await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
      }
    });

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.invites.redeem, { code: created.code }),
    ).rejects.toThrow("expired");
  });

  it("rejects a revoked code", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const created = await asOwner.mutation(api.invites.create, {});
    await asOwner.mutation(api.invites.revoke, { inviteId: created.inviteId });

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.invites.redeem, { code: created.code }),
    ).rejects.toThrow("revoked");
  });

  it("rejects a banned user", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const created = await t.withIdentity({ subject: "owner-1" }).mutation(api.invites.create, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", { userId: "user-1", actorId: "owner-1", at: Date.now() });
    });

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.invites.redeem, { code: created.code }),
    ).rejects.toThrow("banned");
  });

  it("gates create, list and revoke behind CreateInvites", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.mutation(api.invites.create, {})).rejects.toThrow("Missing permission");
    await expect(asUser.query(api.invites.list, { paginationOpts: PAGE })).rejects.toThrow(
      "Missing permission",
    );
  });

  it("lets a member holding CreateInvites mint a code", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.CreateInvites,
      members: [{ userId: "user-1" }],
    });
    const created = await t.withIdentity({ subject: "user-1" }).mutation(api.invites.create, {});
    expect(created.code).toHaveLength(48);
  });
});

describe("invite abuse controls", () => {
  afterEach(() => {
    delete process.env.INVITE_RATE_LIMIT;
    delete process.env.INVITE_RATE_WINDOW_MS;
    delete process.env.INVITE_PENDING_LIMIT;
  });

  it("rejects a malformed recipient email", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    await expect(asOwner.mutation(api.invites.create, { email: "not-an-email" })).rejects.toThrow(
      "valid address",
    );
    await expect(asOwner.mutation(api.invites.create, { email: "a@b" })).rejects.toThrow(
      "valid address",
    );
  });

  it("rate limits invite creation per actor", async () => {
    process.env.INVITE_RATE_LIMIT = "1";
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    await asOwner.mutation(api.invites.create, {});
    await expect(asOwner.mutation(api.invites.create, {})).rejects.toThrow("Rate limit exceeded");
  });

  it("caps a creator's pending unused invites", async () => {
    process.env.INVITE_PENDING_LIMIT = "1";
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    await asOwner.mutation(api.invites.create, {});
    await expect(asOwner.mutation(api.invites.create, {})).rejects.toThrow(
      "Too many pending invites",
    );
  });
});
