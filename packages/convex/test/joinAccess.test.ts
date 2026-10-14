import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { newTestWithAccounts, seedAccount, seedWorkspace, type Test } from "./helpers";

async function memberIds(t: Test): Promise<string[]> {
  const all = await t.run(async (ctx) => await ctx.db.query("members").collect());
  return all.map((member) => member.userId);
}

async function workspaceWithAllowlist(entries: readonly string[]) {
  const t = newTestWithAccounts();
  await seedWorkspace(t, {
    extraRoles: [
      { key: "inviter", permissions: Permission.CreateInvites },
      { key: "cleaner", permissions: Permission.DeleteInvites },
    ],
    members: [
      { userId: "inviter", roleIds: [EVERYONE_ROLE_ID, "inviter"] },
      { userId: "cleaner", roleIds: [EVERYONE_ROLE_ID, "cleaner"] },
    ],
  });
  for (const entry of entries) {
    await t.withIdentity({ subject: "owner-1" }).mutation(api.inviteAllowlist.add, { entry });
  }
  return t;
}

describe("allowlist management", () => {
  it("adds, dedupes, lists with the author and removes", async () => {
    const t = await workspaceWithAllowlist([]);
    const asInviter = t.withIdentity({ subject: "inviter" });
    const asCleaner = t.withIdentity({ subject: "cleaner" });

    const first = await asInviter.mutation(api.inviteAllowlist.add, {
      entry: " Sam@Acme.com ",
      note: "contractor",
    });
    expect(first.created).toBe(true);
    const again = await asInviter.mutation(api.inviteAllowlist.add, { entry: "sam@acme.com" });
    expect(again).toEqual({ entryId: first.entryId, created: false });
    await asInviter.mutation(api.inviteAllowlist.add, { entry: "@Corp.io" });

    const listed = await asCleaner.query(api.inviteAllowlist.list, {});
    expect(listed.map((entry) => [entry.pattern, entry.kind])).toEqual([
      ["@corp.io", "domain"],
      ["sam@acme.com", "email"],
    ]);
    expect(listed[1]).toMatchObject({ note: "contractor", addedBy: "inviter" });

    await expect(
      asInviter.mutation(api.inviteAllowlist.remove, { entryId: first.entryId }),
    ).rejects.toThrow("Missing permission");
    await expect(asCleaner.mutation(api.inviteAllowlist.add, { entry: "x@y.co" })).rejects.toThrow(
      "Missing permission",
    );
    await asCleaner.mutation(api.inviteAllowlist.remove, { entryId: first.entryId });
    expect(await asInviter.query(api.inviteAllowlist.list, {})).toHaveLength(1);

    const audit = await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(["allowlist.add", "allowlist.remove"]),
    );
  });

  it("rejects malformed entries and hides the list from other members", async () => {
    const t = await workspaceWithAllowlist([]);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    await expect(asOwner.mutation(api.inviteAllowlist.add, { entry: "acme.com" })).rejects.toThrow(
      "Enter an email address",
    );
    await expect(
      t.withIdentity({ subject: "outsider" }).query(api.inviteAllowlist.list, {}),
    ).rejects.toThrow();
  });
});

describe("joining without a link", () => {
  it("lets a verified, allowlisted account in and nobody else", async () => {
    const t = await workspaceWithAllowlist(["sam@acme.com", "@corp.io"]);
    const sam = await seedAccount(t, { email: "Sam@Acme.com", emailVerified: true });
    const dana = await seedAccount(t, { email: "dana@corp.io", emailVerified: true });
    const eve = await seedAccount(t, { email: "eve@elsewhere.com", emailVerified: true });
    const unverified = await seedAccount(t, { email: "sam@acme.com", emailVerified: false });

    expect(await t.withIdentity({ subject: sam }).query(api.joinAccess.status, {})).toMatchObject({
      isMember: false,
      allowlisted: true,
      emailVerified: true,
      emailHint: "s***@acme.com",
    });
    expect(await t.withIdentity({ subject: eve }).query(api.joinAccess.status, {})).toMatchObject({
      allowlisted: false,
    });

    await expect(
      t.withIdentity({ subject: eve }).mutation(api.joinAccess.joinAllowlisted, {}),
    ).rejects.toThrow("not on the allowlist");
    await expect(
      t.withIdentity({ subject: unverified }).mutation(api.joinAccess.joinAllowlisted, {}),
    ).rejects.toThrow("Verify your email");

    await t.withIdentity({ subject: sam }).mutation(api.joinAccess.joinAllowlisted, {});
    await t.withIdentity({ subject: dana }).mutation(api.joinAccess.joinAllowlisted, {});
    expect(await memberIds(t)).toEqual(expect.arrayContaining([sam, dana]));
    expect(await memberIds(t)).not.toContain(eve);
  });

  it("does not let a banned account in", async () => {
    const t = await workspaceWithAllowlist(["sam@acme.com"]);
    const sam = await seedAccount(t, { email: "sam@acme.com", emailVerified: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", { userId: sam, actorId: "owner-1", at: Date.now() });
    });
    expect(await t.withIdentity({ subject: sam }).query(api.joinAccess.status, {})).toMatchObject({
      banned: true,
    });
    await expect(
      t.withIdentity({ subject: sam }).mutation(api.joinAccess.joinAllowlisted, {}),
    ).rejects.toThrow("banned");
  });

  it("joins an open workspace but not an invite-only one", async () => {
    const t = await workspaceWithAllowlist([]);
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.mutation(api.joinAccess.joinOpen, {})).rejects.toThrow("invite only");
    await t.run(async (ctx) => {
      const server = await ctx.db.query("server").first();
      if (server !== null) {
        await ctx.db.patch(server._id, { settings: { ...server.settings, inviteOnly: false } });
      }
    });
    expect(await asUser.query(api.joinAccess.status, {})).toMatchObject({ inviteOnly: false });
    await asUser.mutation(api.joinAccess.joinOpen, {});
    expect(await memberIds(t)).toContain("user-1");
  });
});

describe("emailed one-time code", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function setup() {
    vi.useFakeTimers();
    const sent: { to: string; subject: string; text: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body));
        return { ok: true };
      }),
    );
    vi.stubEnv("AULORA_EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "key");
    const t = await workspaceWithAllowlist(["sam@acme.com"]);
    const sam = await seedAccount(t, { email: "sam@acme.com", emailVerified: false });
    return { t, sam, asSam: t.withIdentity({ subject: sam }), sent };
  }

  async function issuedCode(t: Test, sent: { text: string }[]): Promise<string> {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const code = /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? "")?.[1];
    if (code === undefined) throw new Error("no code was emailed");
    return code;
  }

  it("proves the mailbox, then joins", async () => {
    const { t, sam, asSam, sent } = await setup();
    expect(await asSam.query(api.joinAccess.status, {})).toMatchObject({ canEmailCode: true });

    await asSam.mutation(api.joinAccess.requestCode, {});
    const code = await issuedCode(t, sent);
    expect(sent[0]?.to).toBe("sam@acme.com");

    const stored = await t.run(async (ctx) => await ctx.db.query("joinCodes").collect());
    expect(stored[0]?.codeHash).not.toContain(code);

    expect(await asSam.mutation(api.joinAccess.verifyCode, { code })).toEqual({ joined: true });
    expect(await memberIds(t)).toContain(sam);
    expect(await t.run(async (ctx) => await ctx.db.query("joinCodes").collect())).toHaveLength(0);
  });

  it("counts wrong guesses and burns the code after too many", async () => {
    const { t, asSam, sent } = await setup();
    await asSam.mutation(api.joinAccess.requestCode, {});
    const code = await issuedCode(t, sent);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await asSam.mutation(api.joinAccess.verifyCode, { code: wrong })).toEqual({
        joined: false,
        reason: "wrong_code",
      });
    }
    expect(await asSam.mutation(api.joinAccess.verifyCode, { code })).toEqual({
      joined: false,
      reason: "too_many_attempts",
    });
    expect(await asSam.mutation(api.joinAccess.verifyCode, { code })).toEqual({
      joined: false,
      reason: "no_code",
    });
  });

  it("expires after ten minutes", async () => {
    const { t, asSam, sent } = await setup();
    await asSam.mutation(api.joinAccess.requestCode, {});
    const code = await issuedCode(t, sent);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("joinCodes").first();
      if (row !== null) await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    expect(await asSam.mutation(api.joinAccess.verifyCode, { code })).toEqual({
      joined: false,
      reason: "expired",
    });
  });

  it("will not email an address that is not allowlisted, or too often", async () => {
    const { t, asSam } = await setup();
    const eve = await seedAccount(t, { email: "eve@elsewhere.com" });
    await expect(
      t.withIdentity({ subject: eve }).mutation(api.joinAccess.requestCode, {}),
    ).rejects.toThrow("not on the allowlist");
    await asSam.mutation(api.joinAccess.requestCode, {});
    await asSam.mutation(api.joinAccess.requestCode, {});
    await asSam.mutation(api.joinAccess.requestCode, {});
    await expect(asSam.mutation(api.joinAccess.requestCode, {})).rejects.toThrow(
      "Rate limit exceeded",
    );
  });

  it("is refused once the entry is removed", async () => {
    const { t, asSam, sent } = await setup();
    await asSam.mutation(api.joinAccess.requestCode, {});
    const code = await issuedCode(t, sent);
    const entries = await t
      .withIdentity({ subject: "owner-1" })
      .query(api.inviteAllowlist.list, {});
    await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.inviteAllowlist.remove, { entryId: entries[0]?.id as never });
    expect(await asSam.mutation(api.joinAccess.verifyCode, { code })).toEqual({
      joined: false,
      reason: "not_allowed",
    });
  });
});
