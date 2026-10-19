import { EVERYONE_ROLE_ID } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace, type Test } from "./helpers";

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
