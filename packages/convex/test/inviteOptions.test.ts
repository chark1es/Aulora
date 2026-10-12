import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, newTestWithAccounts, seedAccount, seedWorkspace, type Test } from "./helpers";

const PAGE = { numItems: 50, cursor: null } as const;
const DAY = 24 * 60 * 60 * 1000;

async function rows(t: Test) {
  return await t.run(async (ctx) => await ctx.db.query("invites").collect());
}

describe("invite expiry and limits", () => {
  it("can be created without an expiry", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const created = await asOwner.mutation(api.invites.create, { expiresAt: null });

    expect((await rows(t))[0]?.expiresAt).toBeUndefined();
    expect(await t.query(api.invites.inspect, { code: created.code })).toMatchObject({
      valid: true,
      expiresAt: null,
    });
    const listed = await asOwner.query(api.invites.list, { paginationOpts: PAGE });
    expect(listed.page[0]).toMatchObject({ expiresAt: null, status: "active", kind: "link" });
  });

  it("honours a custom expiry and rejects one in the past", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const at = Date.now() + 2 * DAY;
    await asOwner.mutation(api.invites.create, { expiresAt: at });
    expect((await rows(t))[0]?.expiresAt).toBe(at);
    await expect(
      asOwner.mutation(api.invites.create, { expiresAt: Date.now() - 1 }),
    ).rejects.toThrow("future");
  });

  it("validates the use limit", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    await expect(asOwner.mutation(api.invites.create, { maxUses: -1 })).rejects.toThrow(
      "Use limit",
    );
    await expect(asOwner.mutation(api.invites.create, { maxUses: 1.5 })).rejects.toThrow(
      "Use limit",
    );
    await asOwner.mutation(api.invites.create, { maxUses: 3 });
    expect((await rows(t))[0]?.maxUses).toBe(3);
  });

  it("records who joined and marks a used-up invite", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const created = await asOwner.mutation(api.invites.create, { maxUses: 2, note: "design team" });
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.invites.redeem, { code: created.code });
    await t
      .withIdentity({ subject: "user-2" })
      .mutation(api.invites.redeem, { code: created.code });

    const listed = await asOwner.query(api.invites.list, { paginationOpts: PAGE });
    const invite = listed.page[0];
    expect(invite).toMatchObject({ status: "exhausted", uses: 2, note: "design team" });
    expect(invite?.redemptions.map((join) => join.userId).sort()).toEqual(["user-1", "user-2"]);
    expect(await t.query(api.invites.inspect, { code: created.code })).toMatchObject({
      valid: false,
      reason: "exhausted",
    });
  });

  it("rejects an over-long note", async () => {
    const t = newTest();
    await seedWorkspace(t);
    await expect(
      t.withIdentity({ subject: "owner-1" }).mutation(api.invites.create, { note: "x".repeat(81) }),
    ).rejects.toThrow("at most 80");
  });
});

describe("access codes", () => {
  it("mints a short one-time code that redeems however it is typed", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const created = await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.invites.create, { kind: "code" });

    expect(created.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    const row = (await rows(t))[0];
    expect(row).toMatchObject({ kind: "code", maxUses: 1 });
    expect(row?.code).toHaveLength(64);
    expect(row?.codeHint).toBe(created.code.slice(-4));

    const typed = `${created.code.slice(0, 4)}-${created.code.slice(4, 8)} ${created.code
      .slice(8)
      .toLowerCase()}`;
    expect(await t.query(api.invites.inspect, { code: typed })).toMatchObject({ valid: true });
    expect(
      await t.withIdentity({ subject: "user-1" }).mutation(api.invites.redeem, { code: typed }),
    ).toEqual({ joined: true, alreadyMember: false });
    expect(
      await t
        .withIdentity({ subject: "user-2" })
        .mutation(api.invites.redeem, { code: created.code }),
    ).toMatchObject({ joined: false, reason: "exhausted" });
  });

  it("redeems from a pasted link", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const created = await t.withIdentity({ subject: "owner-1" }).mutation(api.invites.create, {});
    const link = `https://chat.acme.com/invite/${created.code}`;
    expect(
      await t.withIdentity({ subject: "user-1" }).mutation(api.invites.redeem, { code: link }),
    ).toEqual({ joined: true, alreadyMember: false });
  });

  afterEach(() => {
    delete process.env.INVITE_REDEEM_RATE_LIMIT;
  });

  it("rate limits redeem attempts per person", async () => {
    process.env.INVITE_REDEEM_RATE_LIMIT = "2";
    const t = newTest();
    await seedWorkspace(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    expect(await asUser.mutation(api.invites.redeem, { code: "AAAAAAAAAAAA" })).toMatchObject({
      reason: "not_found",
    });
    expect(await asUser.mutation(api.invites.redeem, { code: "BBBBBBBBBBBB" })).toMatchObject({
      reason: "not_found",
    });
    await expect(asUser.mutation(api.invites.redeem, { code: "CCCCCCCCCCCC" })).rejects.toThrow(
      "Rate limit exceeded",
    );
  });
});

describe("invites for one person", () => {
  it("only redeems for the account that owns the address", async () => {
    const t = newTestWithAccounts();
    await seedWorkspace(t);
    const sam = await seedAccount(t, { email: "Sam@Acme.com" });
    const eve = await seedAccount(t, { email: "eve@elsewhere.com" });
    const created = await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.invites.create, { kind: "link", email: "sam@acme.com" });

    expect((await rows(t))[0]?.restrictedEmail).toBe("sam@acme.com");
    expect(await t.query(api.invites.inspect, { code: created.code })).toMatchObject({
      valid: true,
      restrictedTo: "s***@acme.com",
    });

    expect(
      await t.withIdentity({ subject: eve }).mutation(api.invites.redeem, { code: created.code }),
    ).toMatchObject({ joined: false, reason: "wrong_account" });
    expect(
      await t.withIdentity({ subject: sam }).mutation(api.invites.redeem, { code: created.code }),
    ).toEqual({ joined: true, alreadyMember: false });
  });

  it("fails closed when the account has no readable email", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const created = await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.invites.create, { kind: "code", email: "sam@acme.com" });
    expect(
      await t
        .withIdentity({ subject: "ghost" })
        .mutation(api.invites.redeem, { code: created.code }),
    ).toMatchObject({ joined: false, reason: "wrong_account" });
  });
});

describe("emailed one-time links", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function configuredWorkspace() {
    vi.stubEnv("SITE_URL", "https://chat.acme.com");
    const t = newTest();
    await seedWorkspace(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("emailSettings", {
        provider: "resend",
        from: "Aulora <no-reply@acme.com>",
        resendApiKeyCiphertext: "unused",
      });
    });
    return t;
  }

  it("refuses to email until delivery is configured", async () => {
    vi.stubEnv("SITE_URL", "https://chat.acme.com");
    const t = newTest();
    await seedWorkspace(t);
    await expect(
      t
        .withIdentity({ subject: "owner-1" })
        .mutation(api.invites.create, { kind: "email", email: "sam@acme.com" }),
    ).rejects.toThrow("Configure email delivery");
  });

  it("requires an address", async () => {
    const t = newTest();
    await seedWorkspace(t);
    await expect(
      t.withIdentity({ subject: "owner-1" }).mutation(api.invites.create, { kind: "email" }),
    ).rejects.toThrow("email address");
  });

  it("is single-use, tied to the address, and sends the link", async () => {
    vi.useFakeTimers();
    const sent: { to: string; text: string; html: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body));
        return { ok: true };
      }),
    );
    const t = await configuredWorkspace();
    // The saved key is sealed; swap in the env fallback the mailer resolves.
    vi.stubEnv("RESEND_API_KEY", "key");
    await t.run(async (ctx) => {
      const row = await ctx.db.query("emailSettings").first();
      if (row !== null) await ctx.db.delete(row._id);
    });
    vi.stubEnv("AULORA_EMAIL_PROVIDER", "resend");

    const created = await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.invites.create, { email: "Sam@Acme.com", maxUses: 50 });
    expect(created.kind).toBe("email");
    expect((await rows(t))[0]).toMatchObject({
      maxUses: 1,
      restrictedEmail: "sam@acme.com",
      emailStatus: "queued",
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("sam@acme.com");
    expect(sent[0]?.text).toContain(`https://chat.acme.com/invite/${created.code}`);
    expect(sent[0]?.text).toContain("works once");
    expect(sent[0]?.html).toContain("Accept invitation");
    expect((await rows(t))[0]?.emailStatus).toBe("sent");
  });
});

describe("invite visibility", () => {
  it("lists the creator, method and recipient for reviewers", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      extraRoles: [{ key: "inviter", permissions: Permission.CreateInvites }],
      members: [{ userId: "inviter", roleIds: [EVERYONE_ROLE_ID, "inviter"] }],
    });
    await t
      .withIdentity({ subject: "inviter" })
      .mutation(api.invites.create, { kind: "code", email: "sam@acme.com", note: "onboarding" });
    const listed = await t
      .withIdentity({ subject: "owner-1" })
      .query(api.invites.list, { paginationOpts: PAGE });
    expect(listed.page[0]).toMatchObject({
      createdBy: "inviter",
      kind: "code",
      restrictedEmail: "sam@acme.com",
      note: "onboarding",
      maxUses: 1,
    });
  });
});
