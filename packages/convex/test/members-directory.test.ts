import { EVERYONE_ROLE_ID } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, newTestWithAccounts, seedAccount, seedWorkspace, type Test } from "./helpers";

interface MemberSeedRow {
  readonly userId: string;
  readonly joinedAt: number;
  readonly nickname?: string;
  readonly roleIds?: readonly string[];
}

/** Inserts member rows with explicit `joinedAt` so join order is deterministic. */
async function seedMembers(t: Test, rows: readonly MemberSeedRow[]): Promise<void> {
  await t.run(async (ctx) => {
    for (const row of rows) {
      await ctx.db.insert("members", {
        userId: row.userId,
        roleIds: [...(row.roleIds ?? [EVERYONE_ROLE_ID])],
        joinedAt: row.joinedAt,
        ...(row.nickname !== undefined ? { nickname: row.nickname } : {}),
      });
    }
  });
}

describe("members.page", () => {
  it("returns the same MemberView rows as members.list, in join order", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    await seedMembers(t, [
      { userId: "carol", joinedAt: 300, nickname: "C" },
      { userId: "ada", joinedAt: 100 },
      { userId: "bob", joinedAt: 200 },
    ]);
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const listed = await asOwner.query(api.members.list, {});

    const first = await asOwner.query(api.members.page, { numItems: 2 });
    expect(first.page.map((member) => member.userId)).toEqual(["ada", "bob"]);
    expect(first.isDone).toBe(false);

    const second = await asOwner.query(api.members.page, {
      cursor: first.continueCursor,
      numItems: 2,
    });
    expect(second.page.map((member) => member.userId)).toEqual(["carol"]);
    expect(second.isDone).toBe(true);

    // Every paged row is byte-for-byte the corresponding `members.list` entry,
    // so a client migrating between the two cannot observe a shape difference.
    expect([...first.page, ...second.page]).toEqual(listed);
  });

  it("defaults the page size, clamps a small value up to one, and caps a huge one", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    await seedMembers(
      t,
      Array.from({ length: 501 }, (_, i) => ({ userId: `m${i}`, joinedAt: i })),
    );
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const defaulted = await asOwner.query(api.members.page, {});
    expect(defaulted.page).toHaveLength(100);

    const single = await asOwner.query(api.members.page, { numItems: 0 });
    expect(single.page.map((member) => member.userId)).toEqual(["m0"]);

    // Above the hard ceiling the read stays bounded at 500 and reports more.
    const capped = await asOwner.query(api.members.page, { numItems: 10_000 });
    expect(capped.page).toHaveLength(500);
    expect(capped.page[0]?.userId).toBe("m0");
    expect(capped.page[499]?.userId).toBe("m499");
    expect(capped.isDone).toBe(false);

    // A window at the far end still resolves rows beyond the first page.
    const tail = await asOwner.query(api.members.page, {
      cursor: capped.continueCursor,
      numItems: 10_000,
    });
    expect(tail.page.map((member) => member.userId)).toEqual(["m500"]);
    expect(tail.isDone).toBe(true);
  });
});

describe("members.search", () => {
  it("matches nicknames case-insensitively and reuses the MemberView shape", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    await seedMembers(t, [
      { userId: "ada", joinedAt: 1, nickname: "Countess" },
      { userId: "bob", joinedAt: 2 },
      { userId: "grace", joinedAt: 3, nickname: "Amazing Grace" },
    ]);
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const found = await asOwner.query(api.members.search, { query: "AMAZING" });
    expect(found.map((member) => member.userId)).toEqual(["grace"]);

    const listed = await asOwner.query(api.members.list, {});
    expect(found[0]).toEqual(listed.find((member) => member.userId === "grace"));

    // Blank input and a miss return an empty list.
    expect(await asOwner.query(api.members.search, { query: "   " })).toEqual([]);
    expect(await asOwner.query(api.members.search, { query: "nobody" })).toEqual([]);
  });

  it("caps matches at the limit while preserving join order", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    await seedMembers(t, [
      { userId: "m0", joinedAt: 1, nickname: "aloe" },
      { userId: "m1", joinedAt: 2, nickname: "almond" },
      { userId: "m2", joinedAt: 3, nickname: "alpine" },
    ]);
    const asOwner = t.withIdentity({ subject: "owner-1" });

    const limited = await asOwner.query(api.members.search, { query: "al", limit: 2 });
    expect(limited.map((member) => member.userId)).toEqual(["m0", "m1"]);

    const all = await asOwner.query(api.members.search, { query: "al", limit: 100 });
    expect(all.map((member) => member.userId)).toEqual(["m0", "m1", "m2"]);
  });

  it("matches the resolved account name and email local part", async () => {
    const t = newTestWithAccounts();
    const ada = await seedAccount(t, { email: "ada@acme.com", name: "Ada Lovelace" });
    const grace = await seedAccount(t, { email: "grace@acme.com", name: "Grace Hopper" });
    // An account with no profile name falls back to its email local part.
    const zoe = await seedAccount(t, { email: "zoe@corp.io", name: "" });
    await seedWorkspace(t, {
      ownerId: ada,
      members: [{ userId: ada }, { userId: grace }, { userId: zoe }],
    });
    const asAda = t.withIdentity({ subject: ada });

    const byName = await asAda.query(api.members.search, { query: "hopper" });
    expect(byName.map((member) => member.userId)).toEqual([grace]);
    expect(byName[0]?.accountName).toBe("Grace Hopper");

    const byLocalPart = await asAda.query(api.members.search, { query: "ZOE" });
    expect(byLocalPart.map((member) => member.userId)).toEqual([zoe]);
    expect(byLocalPart[0]?.accountName).toBe("zoe");
  });

  it("never scans past its hard window", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [] });
    await seedMembers(
      t,
      Array.from({ length: 501 }, (_, i) => ({
        userId: `m${i}`,
        joinedAt: i,
        ...(i === 500 ? { nickname: "needle" } : {}),
        ...(i === 0 ? { nickname: "edge" } : {}),
      })),
    );
    const asOwner = t.withIdentity({ subject: "owner-1" });

    // The only "needle" sits just past the 500-row scan window, so the search
    // stops at the cap instead of walking the whole table.
    expect(await asOwner.query(api.members.search, { query: "needle" })).toEqual([]);
    // A match inside the window is still found.
    expect(
      (await asOwner.query(api.members.search, { query: "edge" })).map((m) => m.userId),
    ).toEqual(["m0"]);
  });
});
