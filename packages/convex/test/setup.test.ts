import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api, components, internal } from "../convex/_generated/api";
import { sha256Hex } from "../convex/lib/crypto";
import schema from "../convex/schema";
import { newTestWithAccounts } from "./helpers";
import { modules } from "./setup";

afterEach(() => {
  delete process.env.SETUP_TOKEN;
});

const OWNER = {
  name: "Acme",
  email: "owner@example.com",
  password: "correct-horse-battery",
};

/** Issues the current printed setup token; tests use it like an operator. */
async function issueToken(t: ReturnType<typeof convexTest>): Promise<string> {
  const result = await t.mutation(internal.setupState.issueSetupToken, { rotate: true });
  if (result.token === null) {
    throw new Error("expected a fresh setup token");
  }
  return result.token;
}

describe("setup.finalize", () => {
  it("creates the server singleton, the @everyone role and the owner member", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    const result = await t.mutation(internal.setupState.finalize, {
      name: "Acme",
      ownerId: "owner-1",
      token,
    });

    const server = await t.run(async (ctx) => await ctx.db.get(result.serverId));
    expect(server).toMatchObject({ name: "Acme", ownerId: "owner-1" });

    const role = await t.run(async (ctx) => await ctx.db.get(result.roleId));
    expect(role).toMatchObject({ key: EVERYONE_ROLE_ID, name: EVERYONE_ROLE_ID, position: 0 });
    expect((role?.permissions ?? 0n) & Permission.ViewKanban).toBe(Permission.ViewKanban);
    expect((role?.permissions ?? 0n) & Permission.CommentKanban).toBe(Permission.CommentKanban);
    expect((role?.permissions ?? 0n) & Permission.EditKanban).toBe(0n);

    const member = await t.run(
      async (ctx) =>
        await ctx.db
          .query("members")
          .withIndex("by_user", (q) => q.eq("userId", "owner-1"))
          .unique(),
    );
    expect(member?.roleIds).toContain(EVERYONE_ROLE_ID);

    const status = await t.query(api.setup.status);
    expect(status).toEqual({ initialized: true, name: "Acme" });
    await expect(t.query(api.setup.state)).resolves.toEqual({ setupRequired: false });
  });

  it("refuses a second initialization", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    await t.mutation(internal.setupState.finalize, { name: "Acme", ownerId: "owner-1", token });
    await expect(
      t.mutation(internal.setupState.finalize, { name: "Other", ownerId: "owner-2", token }),
    ).rejects.toThrow("already initialized");
  });
});

describe("setup claim proof", () => {
  it("reports setup as required before an owner exists", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.setup.state)).resolves.toEqual({ setupRequired: true });
  });

  it("lets exactly one of two concurrent claims win", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    const results = await Promise.allSettled([
      t.mutation(internal.setupState.finalize, { name: "One", ownerId: "owner-1", token }),
      t.mutation(internal.setupState.finalize, { name: "Two", ownerId: "owner-2", token }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const server = await t.run(async (ctx) => await ctx.db.query("server").first());
    expect(server?.ownerId).toBe("owner-1");
    expect(server?.ownerIds).toEqual(["owner-1"]);
    const owners = await t.run(
      async (ctx) => (await ctx.db.query("server").first())?.ownerIds ?? [],
    );
    expect(owners).toHaveLength(1);
  });

  it("rejects a wrong token", async () => {
    const t = convexTest(schema, modules);
    await issueToken(t);
    await expect(
      t.mutation(internal.setupState.finalize, {
        name: "Acme",
        ownerId: "owner-1",
        token: "wrong-token",
      }),
    ).rejects.toThrow("Invalid setup token");
  });

  it("rejects an expired token", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("setupClaims").first();
      if (row !== null) {
        await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
      }
    });
    await expect(
      t.mutation(internal.setupState.finalize, { name: "Acme", ownerId: "owner-1", token }),
    ).rejects.toThrow("expired");
  });

  it("clears the stored token hash once claimed", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    await t.mutation(internal.setupState.finalize, { name: "Acme", ownerId: "owner-1", token });
    const rows = await t.run(async (ctx) => await ctx.db.query("setupClaims").collect());
    expect(rows).toHaveLength(0);
  });

  it("still accepts the legacy SETUP_TOKEN environment override", async () => {
    process.env.SETUP_TOKEN = "automation-token";
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.setupState.finalize, {
      name: "Acme",
      ownerId: "owner-1",
      token: "automation-token",
    });
    expect(first.ownerId).toBe("owner-1");
    await expect(
      t.mutation(internal.setupState.finalize, {
        name: "Other",
        ownerId: "owner-2",
        token: "automation-token",
      }),
    ).rejects.toThrow("already initialized");
  });

  it("records the claim in the audit log without the token", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    await t.mutation(internal.setupState.finalize, { name: "Acme", ownerId: "owner-1", token });
    const entry = await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLog").collect();
      return rows.find((row) => row.action === "setup.claim") ?? null;
    });
    expect(entry).toMatchObject({ actorId: "owner-1", action: "setup.claim" });
    expect(JSON.stringify(entry)).not.toContain(token);
  });
});

/** The `@everyone` baseline stored by releases that let members edit Kanban. */
const LEGACY_EVERYONE_PERMISSIONS: bigint =
  Permission.ViewChannel |
  Permission.SendMessages |
  Permission.SendInThreads |
  Permission.CreateThreads |
  Permission.AttachFiles |
  Permission.EmbedLinks |
  Permission.AddReactions |
  Permission.ReadHistory |
  Permission.ChangeOwnNickname |
  Permission.Connect |
  Permission.Speak |
  Permission.Stream |
  Permission.UseVideo |
  Permission.ViewKanban |
  Permission.EditKanban |
  Permission.CommentKanban |
  Permission.ViewNotes |
  Permission.CreateNotes |
  Permission.EditNotes;

describe("setupState.restrictKanbanEditing", () => {
  it("removes Edit Kanban from an untouched legacy @everyone role", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    const { roleId } = await t.mutation(internal.setupState.finalize, {
      name: "Acme",
      ownerId: "owner-1",
      token,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(roleId, { permissions: LEGACY_EVERYONE_PERMISSIONS });
    });

    await expect(t.mutation(internal.setupState.restrictKanbanEditing, {})).resolves.toBe(true);

    const role = await t.run(async (ctx) => await ctx.db.get(roleId));
    expect(role).not.toBeNull();
    expect((role?.permissions ?? 0n) & Permission.EditKanban).toBe(0n);
    expect((role?.permissions ?? 0n) & Permission.ViewKanban).toBe(Permission.ViewKanban);
    // A second run is a no-op.
    await expect(t.mutation(internal.setupState.restrictKanbanEditing, {})).resolves.toBe(false);
  });

  it("keeps an owner's later deliberate re-grant on the next run", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    const { roleId } = await t.mutation(internal.setupState.finalize, {
      name: "Acme",
      ownerId: "owner-1",
      token,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(roleId, { permissions: LEGACY_EVERYONE_PERMISSIONS });
    });

    await expect(t.mutation(internal.setupState.restrictKanbanEditing, {})).resolves.toBe(true);
    // The owner deliberately re-grants Edit Kanban after the migration ran.
    await t.run(async (ctx) => {
      await ctx.db.patch(roleId, { permissions: LEGACY_EVERYONE_PERMISSIONS });
    });

    // A later deploy must not treat that re-grant as pre-migration state.
    await expect(t.mutation(internal.setupState.restrictKanbanEditing, {})).resolves.toBe(false);
    const role = await t.run(async (ctx) => await ctx.db.get(roleId));
    expect((role?.permissions ?? 0n) & Permission.EditKanban).toBe(Permission.EditKanban);
  });

  it("leaves a customised @everyone role for its owner to review", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    const { roleId } = await t.mutation(internal.setupState.finalize, {
      name: "Acme",
      ownerId: "owner-1",
      token,
    });
    const customised = LEGACY_EVERYONE_PERMISSIONS | Permission.ManageEmoji;
    await t.run(async (ctx) => {
      await ctx.db.patch(roleId, { permissions: customised });
    });

    await expect(t.mutation(internal.setupState.restrictKanbanEditing, {})).resolves.toBe(false);

    const role = await t.run(async (ctx) => await ctx.db.get(roleId));
    expect(role?.permissions).toBe(customised);
  });
});

describe("setup claim throttling and token issuance", () => {
  /** Mirrors the bounded bucket mapping in setupState.ts. */
  async function bucketOf(token: string): Promise<number> {
    const fingerprint = (await sha256Hex(token)).slice(0, 32);
    return Number.parseInt(fingerprint.slice(0, 8), 16) % 4096;
  }

  it("locks out the ninth wrong attempt and coalesces the audit rows", async () => {
    const t = convexTest(schema, modules);
    await issueToken(t);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const gate = await t.mutation(internal.setupState.assertClaimAllowed, {
        token: "wrong-token",
        ip: "10.0.0.1",
      });
      expect(gate).toMatchObject({ allowed: false, reason: "invalid" });
    }

    const ninth = await t.mutation(internal.setupState.assertClaimAllowed, {
      token: "wrong-token",
      ip: "10.0.0.1",
    });
    expect(ninth).toMatchObject({ allowed: false, reason: "rate_limited" });

    const rejected = await t.run(async (ctx) =>
      (await ctx.db.query("auditLog").collect()).filter((row) =>
        row.action.startsWith("setup.claim.rejected"),
      ),
    );
    // Five individual rows, then one summary row updated by the rest.
    expect(rejected).toHaveLength(6);
    const summary = rejected.find((row) => row.action === "setup.claim.rejected.summary");
    expect(summary).toBeDefined();
    expect(JSON.parse(summary?.meta ?? "{}")).toMatchObject({ count: 9, reason: "coalesced" });

    // A different token is not locked out by guesses at this one.
    const other = await t.mutation(internal.setupState.assertClaimAllowed, {
      token: "another-token",
      ip: "10.0.0.1",
    });
    expect(other).toMatchObject({ allowed: false, reason: "invalid" });
  });

  it("accepts the correct token after an anonymous flood exhausts the global bucket", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    const reservedBucket = await bucketOf(token);
    let junk = 0;
    // 310 invalid attempts are enough to exhaust the 300-attempt global bucket.
    for (let index = 0; junk < 310 && index < 5000; index += 1) {
      const candidate = `junk-token-${index}`;
      // Avoid the real token's bucket so the assertion tests the global bypass,
      // not a randomized bucket collision.
      if ((await bucketOf(candidate)) === reservedBucket) {
        continue;
      }
      junk += 1;
      await t.mutation(internal.setupState.assertClaimAllowed, {
        token: candidate,
        ip: "10.0.0.1",
      });
    }
    expect(junk).toBe(310);

    // The global bucket is exhausted for invalid attempts...
    await expect(
      t.mutation(internal.setupState.assertClaimAllowed, {
        token: "one-more-junk",
        ip: "10.0.0.1",
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "rate_limited" });

    // ...but the operator's valid token bypasses it.
    await expect(
      t.mutation(internal.setupState.assertClaimAllowed, { token, ip: "10.0.0.1" }),
    ).resolves.toMatchObject({ allowed: true, source: "stored", reason: null });
  });

  it("does not let a junk-token bucket collision block the verified token", async () => {
    const t = convexTest(schema, modules);
    const token = await issueToken(t);
    const reservedBucket = await bucketOf(token);
    let colliding: string | null = null;
    for (let index = 0; index < 50_000; index += 1) {
      const candidate = `collision-${index}`;
      if ((await bucketOf(candidate)) === reservedBucket) {
        colliding = candidate;
        break;
      }
    }
    expect(colliding).not.toBeNull();

    // Eight invalid attempts exhaust the bucket the valid token's fingerprint
    // also maps to. Verified tokens live in their own namespace, so the
    // operator is not locked out by somebody else's guesses.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await t.mutation(internal.setupState.assertClaimAllowed, {
        token: colliding ?? "",
        ip: "10.0.0.1",
      });
    }
    await expect(
      t.mutation(internal.setupState.assertClaimAllowed, { token, ip: "10.0.0.1" }),
    ).resolves.toMatchObject({ allowed: true, source: "stored", reason: null });

    const keys = await t.run(async (ctx) =>
      (await ctx.db.query("rateLimits").collect()).map((row) => row.key),
    );
    expect(keys.some((key) => key.startsWith("setup-claim:verified-token:"))).toBe(true);
  });

  it("bounds stored rows during a distinct-junk-token flood", async () => {
    const t = convexTest(schema, modules);
    for (let index = 0; index < 500; index += 1) {
      await t.mutation(internal.setupState.assertClaimAllowed, {
        token: `junk-flood-${index}`,
        ip: "10.0.0.1",
      });
    }

    const rows = await t.run(async (ctx) => {
      const rateLimits = await ctx.db.query("rateLimits").collect();
      const audit = await ctx.db.query("auditLog").collect();
      return {
        rateLimitKeys: rateLimits.map((row) => row.key),
        rejectedAudit: audit.filter((row) => row.action.startsWith("setup.claim.rejected")),
      };
    });

    // One global counter, one rejection-window counter, and at most one bucket
    // per globally accepted invalid attempt.
    expect(rows.rateLimitKeys.length).toBeLessThanOrEqual(302);
    expect(rows.rejectedAudit.length).toBeLessThanOrEqual(6);
    expect(
      rows.rateLimitKeys.filter((key) => key.startsWith("setup-claim:token:")).length,
    ).toBeLessThanOrEqual(300);
  });

  it("keeps a single setup-claim row under concurrent issuance", async () => {
    const t = convexTest(schema, modules);
    const results = await Promise.all([
      t.mutation(internal.setupState.issueSetupToken, {}),
      t.mutation(internal.setupState.issueSetupToken, {}),
    ]);
    // At most one caller learns a plaintext token; the other sees the existing
    // expiry. Either way only one digest row remains.
    expect(results.filter((result) => result.token !== null).length).toBeLessThanOrEqual(1);
    const rows = await t.run(async (ctx) => await ctx.db.query("setupClaims").collect());
    expect(rows).toHaveLength(1);
  });
});

describe("setup.initialize", () => {
  it("refuses when SETUP_TOKEN is not configured", async () => {
    delete process.env.SETUP_TOKEN;
    const t = convexTest(schema, modules);
    await expect(t.action(api.setup.initialize, { token: "anything", ...OWNER })).rejects.toThrow(
      "Setup is not waiting",
    );
  });

  it("refuses a wrong token", async () => {
    process.env.SETUP_TOKEN = "correct-token";
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.setup.initialize, { token: "wrong-token", ...OWNER }),
    ).rejects.toThrow("Invalid setup token");
  });

  it("claims the instance and creates the owner credential", async () => {
    const t = newTestWithAccounts();
    const token = await issueToken(t);
    // Public signup is denied before an owner exists, but the setup path
    // explicitly bypasses the policy and still creates the credential.
    await expect(t.query(internal.setupState.authPolicy, {})).resolves.toMatchObject({
      serverInitialized: false,
    });
    const result = await t.action(api.setup.initialize, { token, ...OWNER });
    expect(result.ownerId).toBeTruthy();

    const server = await t.run(async (ctx) => await ctx.db.query("server").first());
    expect(server?.ownerId).toBe(result.ownerId);
    expect(server?.ownerIds).toEqual([result.ownerId]);
    await expect(
      t.action(api.setup.initialize, { token, ...OWNER, name: "Other" }),
    ).rejects.toThrow("already initialized");
  });

  it("keeps the legacy automation path working with a SETUP_TOKEN override", async () => {
    process.env.SETUP_TOKEN = "legacy-automation-token";
    const t = newTestWithAccounts();
    const result = await t.action(api.setup.initialize, {
      token: "legacy-automation-token",
      ...OWNER,
    });
    const server = await t.run(async (ctx) => await ctx.db.query("server").first());
    expect(server?.ownerId).toBe(result.ownerId);
    expect(server?.ownerIds).toEqual([result.ownerId]);
  });

  it("accepts the correct token but refuses once initialized", async () => {
    process.env.SETUP_TOKEN = "correct-token";
    const t = convexTest(schema, modules);
    await t.mutation(internal.setupState.finalize, {
      name: "Acme",
      ownerId: "owner-1",
      token: "correct-token",
    });
    await expect(
      t.action(api.setup.initialize, { token: "correct-token", ...OWNER }),
    ).rejects.toThrow("already initialized");
  });

  it("removes a credential when the token was rotated before finalize", async () => {
    const t = newTestWithAccounts();
    const firstToken = await issueToken(t);
    const credential = await t.action(internal.authActions.createOwnerCredential, {
      email: OWNER.email,
      password: OWNER.password,
      name: OWNER.name,
    });

    // A concurrent setup run rotates the token after the credential exists but
    // before this claim finalizes.
    const secondToken = await issueToken(t);
    await expect(
      t.mutation(internal.setupState.finalize, {
        name: OWNER.name,
        ownerId: credential.ownerId,
        token: firstToken,
      }),
    ).rejects.toThrow("Invalid setup token");

    await t.action(internal.authActions.deleteOwnerCredential, {
      ownerId: credential.ownerId,
    });
    const users = await t.run(async (ctx) => {
      const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        paginationOpts: { cursor: null, numItems: 10 },
      });
      return page.page.length;
    });
    expect(users).toBe(0);

    // The clean second token still claims the workspace.
    const result = await t.action(api.setup.initialize, { token: secondToken, ...OWNER });
    const server = await t.run(async (ctx) => await ctx.db.query("server").first());
    expect(server?.ownerId).toBe(result.ownerId);
  });

  it("keeps the credential when finalize committed before the action saw an error", async () => {
    const t = newTestWithAccounts();
    const token = await issueToken(t);
    const credential = await t.action(internal.authActions.createOwnerCredential, {
      email: OWNER.email,
      password: OWNER.password,
      name: OWNER.name,
    });
    const committed = await t.mutation(internal.setupState.finalize, {
      name: OWNER.name,
      ownerId: credential.ownerId,
      token,
    });

    // The compensation path must re-read the committed claim and leave the
    // credential that is now the owner untouched.
    await expect(
      t.action(internal.authActions.discardUnclaimedOwnerCredential, {
        ownerId: credential.ownerId,
      }),
    ).resolves.toEqual(committed);

    const users = await t.run(async (ctx) => {
      const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        paginationOpts: { cursor: null, numItems: 10 },
      });
      return page.page.length;
    });
    expect(users).toBe(1);
    const server = await t.run(async (ctx) => await ctx.db.query("server").first());
    expect(server?.ownerId).toBe(credential.ownerId);
  });

  it("deletes an unclaimed credential when another owner committed", async () => {
    const t = newTestWithAccounts();
    const token = await issueToken(t);
    const orphan = await t.action(internal.authActions.createOwnerCredential, {
      email: "orphan@example.com",
      password: OWNER.password,
      name: "Orphan",
    });
    await t.mutation(internal.setupState.finalize, {
      name: OWNER.name,
      ownerId: "other-owner",
      token,
    });

    await expect(
      t.action(internal.authActions.discardUnclaimedOwnerCredential, {
        ownerId: orphan.ownerId,
      }),
    ).resolves.toBeNull();
    const users = await t.run(async (ctx) => {
      const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        paginationOpts: { cursor: null, numItems: 10 },
      });
      return page.page.length;
    });
    expect(users).toBe(0);
  });

  it("leaves one owner and no orphan credentials under concurrent claims", async () => {
    const t = newTestWithAccounts();
    const token = await issueToken(t);
    const results = await Promise.allSettled([
      t.action(api.setup.initialize, { token, ...OWNER, email: "first@example.com" }),
      t.action(api.setup.initialize, { token, ...OWNER, email: "second@example.com" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const server = await t.run(async (ctx) => await ctx.db.query("server").first());
    expect(server?.ownerIds).toHaveLength(1);
    const users = await t.run(async (ctx) => {
      const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        paginationOpts: { cursor: null, numItems: 10 },
      });
      return page.page.length;
    });
    expect(users).toBe(1);
  });

  it("reports success when post-finalize key registration fails, then retries", async () => {
    const t = newTestWithAccounts();
    const token = await issueToken(t);
    const previous = process.env.AULORA_EKM_PROVIDER;
    process.env.AULORA_EKM_PROVIDER = "vault";
    try {
      const result = await t.action(api.setup.initialize, { token, ...OWNER });
      const server = await t.run(async (ctx) => await ctx.db.query("server").first());
      expect(server?.ownerId).toBe(result.ownerId);
      const keys = await t.run(async (ctx) => await ctx.db.query("encryptionKeys").collect());
      expect(keys).toHaveLength(0);
    } finally {
      if (previous === undefined) {
        delete process.env.AULORA_EKM_PROVIDER;
      } else {
        process.env.AULORA_EKM_PROVIDER = previous;
      }
    }

    await expect(t.action(internal.encryptionKeys.ensureRegistered, {})).resolves.toBeNull();
    const keys = await t.run(async (ctx) => await ctx.db.query("encryptionKeys").collect());
    expect(keys).toHaveLength(1);
    expect(keys[0]?.status).toBe("active");
  });

  it("keeps a committed owner credential when the @everyone role moved off position 0", async () => {
    const t = newTestWithAccounts();
    const token = await issueToken(t);
    const credential = await t.action(internal.authActions.createOwnerCredential, {
      email: OWNER.email,
      password: OWNER.password,
      name: OWNER.name,
    });
    const committed = await t.mutation(internal.setupState.finalize, {
      name: OWNER.name,
      ownerId: credential.ownerId,
      token,
    });
    await t.run(async (ctx) => {
      const role = await ctx.db.get(committed.roleId as never);
      if (role !== null) {
        await ctx.db.patch(role._id, { position: 5 });
      }
    });

    // Ownership comes from the server row, not a position-0 role lookup, so
    // compensation must keep the credential instead of deleting the new owner.
    await expect(
      t.action(internal.authActions.discardUnclaimedOwnerCredential, {
        ownerId: credential.ownerId,
      }),
    ).resolves.toMatchObject({ ownerId: credential.ownerId });
    const users = await t.run(async (ctx) => {
      const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        paginationOpts: { cursor: null, numItems: 10 },
      });
      return page.page.length;
    });
    expect(users).toBe(1);
    const server = await t.run(async (ctx) => await ctx.db.query("server").first());
    expect(server?.ownerId).toBe(credential.ownerId);
  });

  it("recovers an orphaned setup credential after an interrupted claim", async () => {
    const t = newTestWithAccounts();
    const token = await issueToken(t);
    // The first attempt created the credential, then died before `finalize`.
    const orphan = await t.action(internal.authActions.createOwnerCredential, {
      email: OWNER.email,
      password: OWNER.password,
      name: OWNER.name,
    });

    // The retry reports "email already exists"; recovery reuses the account only
    // because the supplied password signs in to it.
    const result = await t.action(api.setup.initialize, { token, ...OWNER });
    expect(result.ownerId).toBe(orphan.ownerId);
    const server = await t.run(async (ctx) => await ctx.db.query("server").first());
    expect(server?.ownerId).toBe(orphan.ownerId);
    const users = await t.run(async (ctx) => {
      const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        paginationOpts: { cursor: null, numItems: 10 },
      });
      return page.page.length;
    });
    expect(users).toBe(1);
  });

  it("keeps a recovered pre-existing account when finalize does not commit", async () => {
    const t = newTestWithAccounts();
    const orphan = await t.action(internal.authActions.createOwnerCredential, {
      email: OWNER.email,
      password: OWNER.password,
      name: OWNER.name,
    });
    const recovered = await t.action(internal.authActions.recoverOwnerCredential, {
      email: OWNER.email,
      password: OWNER.password,
    });
    expect(recovered?.ownerId).toBe(orphan.ownerId);

    // The account was recovered, not created by this claim, so compensation
    // must not delete it when the claim fails before finalize.
    await expect(
      t.action(internal.authActions.discardUnclaimedOwnerCredential, {
        ownerId: orphan.ownerId,
        deleteIfUnclaimed: false,
      }),
    ).resolves.toBeNull();
    const users = await t.run(async (ctx) => {
      const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        paginationOpts: { cursor: null, numItems: 10 },
      });
      return page.page.length;
    });
    expect(users).toBe(1);
    await expect(t.query(api.setup.state)).resolves.toEqual({ setupRequired: true });
  });

  it("does not take over an existing account with a different password", async () => {
    const t = newTestWithAccounts();
    const token = await issueToken(t);
    await t.action(internal.authActions.createOwnerCredential, {
      email: OWNER.email,
      password: OWNER.password,
      name: OWNER.name,
    });

    await expect(
      t.action(api.setup.initialize, {
        token,
        ...OWNER,
        password: "a-completely-different-password",
      }),
    ).rejects.toThrow();
    // The pre-existing account and the uninitialized state are untouched.
    await expect(t.query(api.setup.state)).resolves.toEqual({ setupRequired: true });
    const users = await t.run(async (ctx) => {
      const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        paginationOpts: { cursor: null, numItems: 10 },
      });
      return page.page.length;
    });
    expect(users).toBe(1);
  });
});
