import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api, components, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { OWNER_DELETION_RESERVATION_GRACE_MS } from "../convex/lib/owners";
import { newTest, newTestWithAccounts, seedAccount, seedWorkspace } from "./helpers";

type Test = ReturnType<typeof newTestWithAccounts>;

function as(t: Test, userId: string) {
  return t.withIdentity({ subject: userId });
}

/** Two real auth users as owners, plus a third member. */
async function twoOwners() {
  const t = newTestWithAccounts();
  const owner1 = await seedAccount(t, { email: "owner1@example.com" });
  const owner2 = await seedAccount(t, { email: "owner2@example.com" });
  const member = await seedAccount(t, { email: "member1@example.com" });
  const { serverId } = await seedWorkspace(t, {
    ownerId: owner1,
    ownerIds: [owner1, owner2],
    members: [{ userId: owner2 }, { userId: member }],
  });
  return { t, serverId, owner1, owner2, member };
}

/** Removes the Better Auth user, like a completed account deletion. */
async function deleteAuthUser(t: Test, userId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: { model: "user", where: [{ field: "_id", operator: "eq", value: userId }] },
    });
  });
}

/** Pushes every stored reservation past its TTL without removing it. */
async function expireReservations(t: Test, serverId: Id<"server">): Promise<void> {
  await t.run(async (ctx) => {
    const server = await ctx.db.get(serverId);
    if (server === null) {
      throw new Error("server row missing");
    }
    await ctx.db.patch(serverId, {
      ownerDeletionReservations: (server.ownerDeletionReservations ?? []).map(
        (row: { userId: string; reservedAt: number }) => ({
          ...row,
          reservedAt: Date.now() - OWNER_DELETION_RESERVATION_GRACE_MS - 1,
        }),
      ),
    });
  });
}

describe("owner management", () => {
  it("promotes an existing member and audits the change", async () => {
    const t = newTestWithAccounts();
    const owner = await seedAccount(t, { email: "owner@example.com" });
    const member = await seedAccount(t, { email: "member@example.com" });
    const { serverId } = await seedWorkspace(t, {
      ownerId: owner,
      members: [{ userId: member }],
    });

    await as(t, owner).mutation(api.owners.promote, { userId: member });

    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([owner, member]);
    // The legacy field still names an owner for older clients.
    expect(server?.ownerId).toBe(owner);

    const audit = await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLog").collect();
      return rows.find((row) => row.action === "owner.promote") ?? null;
    });
    expect(audit).toMatchObject({ actorId: owner, targetId: member });
    expect(audit?.at).toBeTypeOf("number");
  });

  it("gives a second owner full owner permissions", async () => {
    const { t, owner1, owner2 } = await twoOwners();

    await expect(as(t, owner2).query(api.instance.settings)).resolves.toMatchObject({
      ownerIds: [owner1, owner2],
    });
    await expect(
      as(t, owner2).mutation(api.instance.updateStorage, {
        storageQuotaBytes: 1024,
        maxUploadBytes: 1024,
      }),
    ).resolves.toMatchObject({ storageQuotaBytes: 1024, maxUploadBytes: 1024 });

    // Owner parity also reaches role management, including @everyone.
    const roles = await as(t, owner2).query(api.roles.list);
    const everyone = roles.find((role) => role.key === EVERYONE_ROLE_ID);
    expect(everyone).toBeDefined();
    await expect(
      as(t, owner2).mutation(api.roles.update, {
        roleId: everyone?.id as never,
        permissions: Permission.ViewChannel | Permission.ManageEmoji,
      }),
    ).resolves.toBeNull();
  });

  it("rejects promotion by a non-owner", async () => {
    const { t, member } = await twoOwners();
    await expect(as(t, member).mutation(api.owners.promote, { userId: member })).rejects.toThrow(
      "Owner only",
    );
  });

  it("rejects a non-member and a bot as owner", async () => {
    const { t, owner1 } = await twoOwners();
    await expect(
      as(t, owner1).mutation(api.owners.promote, { userId: "outsider" }),
    ).rejects.toThrow("existing member");

    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        userId: "bot_1",
        roleIds: [EVERYONE_ROLE_ID],
        joinedAt: Date.now(),
      });
    });
    await expect(as(t, owner1).mutation(api.owners.promote, { userId: "bot_1" })).rejects.toThrow(
      "Bots cannot",
    );
  });

  it("demotes an owner but never the last owner", async () => {
    const { t, serverId, owner1, owner2 } = await twoOwners();

    await as(t, owner1).mutation(api.owners.demote, { userId: owner2 });
    let server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([owner1]);
    await expect(as(t, owner2).query(api.instance.settings)).rejects.toThrow("Instance admin only");

    // owner1 is now the last owner and cannot demote themselves.
    await expect(as(t, owner1).mutation(api.owners.demote, { userId: owner1 })).rejects.toThrow(
      "at least one owner",
    );

    server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([owner1]);
  });

  it("moves the legacy ownerId to a remaining owner on demotion", async () => {
    const { t, serverId, owner1, owner2 } = await twoOwners();

    await as(t, owner2).mutation(api.owners.demote, { userId: owner1 });
    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([owner2]);
    expect(server?.ownerId).toBe(owner2);
  });

  it("rejects demoting a member who is not an owner", async () => {
    const { t, owner1, member } = await twoOwners();
    await expect(as(t, owner1).mutation(api.owners.demote, { userId: member })).rejects.toThrow(
      "not an owner",
    );
  });

  it("works from the legacy single-owner shape", async () => {
    const t = newTestWithAccounts();
    const owner = await seedAccount(t, { email: "owner@example.com" });
    const member = await seedAccount(t, { email: "member@example.com" });
    const { serverId } = await seedWorkspace(t, {
      ownerId: owner,
      members: [{ userId: member }],
    });

    await as(t, owner).mutation(api.owners.promote, { userId: member });
    await as(t, member).mutation(api.owners.demote, { userId: owner });

    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([member]);
    expect(server?.ownerId).toBe(member);
    await expect(as(t, member).query(api.instance.settings)).resolves.toBeDefined();
    await expect(as(t, owner).query(api.instance.settings)).rejects.toThrow("Instance admin only");
  });

  it("reports every owner through members.me and server settings", async () => {
    const { t, owner1, owner2 } = await twoOwners();
    const me = await as(t, owner2).query(api.members.me, {});
    expect(me.ownerId).toBe(owner1);
    expect(me.ownerIds).toEqual([owner1, owner2]);
    expect(me.isOwner).toBe(true);

    const settings = await as(t, owner1).query(api.server.settings, {});
    expect(settings.ownerIds).toEqual([owner1, owner2]);
  });

  it("blocks deleting the last owner's account but allows a peer", async () => {
    const { t, owner1, owner2, member } = await twoOwners();
    await expect(t.query(internal.owners.deletionCheck, { userId: owner1 })).resolves.toEqual({
      allowed: true,
      reason: null,
    });

    await as(t, owner1).mutation(api.owners.demote, { userId: owner2 });
    await expect(t.query(internal.owners.deletionCheck, { userId: owner1 })).resolves.toMatchObject(
      { allowed: false },
    );
    await expect(t.query(internal.owners.deletionCheck, { userId: member })).resolves.toEqual({
      allowed: true,
      reason: null,
    });
  });
});

describe("owner deletion reservations", () => {
  it("lets exactly one of two concurrent owner deletions reserve", async () => {
    const { t, serverId, owner1, owner2 } = await twoOwners();

    const results = await Promise.allSettled([
      t.mutation(internal.owners.reserveAccountDeletion, { userId: owner1 }),
      t.mutation(internal.owners.reserveAccountDeletion, { userId: owner2 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerDeletionReservations).toHaveLength(1);
    expect(server?.ownerIds).toEqual([owner1, owner2]);

    // The winner's cleanup removes exactly one owner and consumes the
    // reservation, leaving a workspace with a live owner.
    const winner = server?.ownerDeletionReservations?.[0]?.userId ?? "";
    expect(winner.length).toBeGreaterThan(0);
    await t.mutation(internal.accountDeletion.deleteUserData, { userId: winner });
    const after = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(after?.ownerIds).toHaveLength(1);
    expect(after?.ownerDeletionReservations ?? []).toHaveLength(0);
  });

  it("refuses to demote the last live owner while a peer's deletion is pending", async () => {
    const { t, serverId, owner1, owner2 } = await twoOwners();

    await t.mutation(internal.owners.reserveAccountDeletion, { userId: owner2 });

    // owner1 is the only owner who will still be present, so they cannot
    // demote themselves while owner2's deletion is pending.
    await expect(as(t, owner1).mutation(api.owners.demote, { userId: owner1 })).rejects.toThrow(
      "at least one owner",
    );

    // Demoting the pending owner resolves the reservation and is allowed.
    await as(t, owner1).mutation(api.owners.demote, { userId: owner2 });
    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([owner1]);
    expect(server?.ownerDeletionReservations ?? []).toHaveLength(0);
  });

  it("releases an expired reservation when the auth user still exists", async () => {
    const { t, serverId, owner1, owner2 } = await twoOwners();
    await t.mutation(internal.owners.reserveAccountDeletion, { userId: owner1 });
    await expireReservations(t, serverId);

    await expect(t.mutation(internal.owners.pruneAccountDeletionReservations, {})).resolves.toBe(1);
    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerDeletionReservations ?? []).toHaveLength(0);
    expect(server?.ownerIds).toEqual([owner1, owner2]);
    // Both owners are live, so the reservation can be taken again.
    await expect(
      t.mutation(internal.owners.reserveAccountDeletion, { userId: owner2 }),
    ).resolves.toBeNull();
  });

  it("refuses a second owner deletion when the first auth user is gone and cleanup failed", async () => {
    const { t, serverId, owner1, owner2 } = await twoOwners();
    await t.mutation(internal.owners.reserveAccountDeletion, { userId: owner1 });
    // Better Auth removed the user, but `deleteUserData` never ran. This leaves
    // owner1 as a ghost in `ownerIds` with an aged reservation.
    await deleteAuthUser(t, owner1);
    await expireReservations(t, serverId);

    // The ghost must not count as a live owner, so deleting the only real owner
    // is refused even before the recovery prune runs.
    await expect(
      t.mutation(internal.owners.reserveAccountDeletion, { userId: owner2 }),
    ).rejects.toThrow("only owner");

    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([owner1, owner2]);
  });

  it("recovers a ghost when another live owner exists", async () => {
    const { t, serverId, owner1, owner2 } = await twoOwners();
    await t.mutation(internal.owners.reserveAccountDeletion, { userId: owner1 });
    await deleteAuthUser(t, owner1);
    await expireReservations(t, serverId);

    await expect(t.mutation(internal.owners.pruneAccountDeletionReservations, {})).resolves.toBe(0);
    await t.finishAllScheduledFunctions(() => {});

    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([owner2]);
    expect(server?.ownerId).toBe(owner2);
    expect(server?.ownerDeletionReservations ?? []).toHaveLength(0);
    const members = await t.run(async (ctx) => await ctx.db.query("members").collect());
    expect(members.find((row) => row.userId === owner1)).toBeUndefined();
  });

  it("keeps a lone ghost reserved and flags it for the operator", async () => {
    const t = newTestWithAccounts();
    const owner = await seedAccount(t, { email: "owner@example.com" });
    const other = await seedAccount(t, { email: "other@example.com" });
    const { serverId } = await seedWorkspace(t, {
      ownerId: owner,
      ownerIds: [owner, other],
      members: [{ userId: owner }, { userId: other }],
    });
    await t.mutation(internal.owners.reserveAccountDeletion, { userId: owner });
    // Both auth users are gone, so there is no other live owner to inherit.
    await deleteAuthUser(t, owner);
    await deleteAuthUser(t, other);
    await expireReservations(t, serverId);

    await t.mutation(internal.owners.pruneAccountDeletionReservations, {});
    await t.finishAllScheduledFunctions(() => {});

    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toContain(owner);
    expect(
      server?.ownerDeletionReservations?.map((row: { userId: string }) => row.userId),
    ).toContain(owner);
    const flagged = await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLog").collect();
      return rows.filter((row) => row.action === "owner.deletion.orphaned");
    });
    expect(flagged.length).toBeGreaterThan(0);
  });

  it("fails closed when an owner's cleanup has no reservation", async () => {
    const { t, serverId, owner1 } = await twoOwners();
    await expect(
      t.mutation(internal.accountDeletion.deleteUserData, { userId: "owner-3" }),
    ).resolves.toBeNull();

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, { ownerIds: [owner1, "owner-3"] });
    });
    await expect(
      t.mutation(internal.accountDeletion.deleteUserData, { userId: "owner-3" }),
    ).rejects.toThrow("not reserved");
    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toContain("owner-3");
  });

  it("keeps a peer deletion refused after the grace period while the auth delete is pending", async () => {
    const { t, serverId, owner1, owner2 } = await twoOwners();
    await t.mutation(internal.owners.reserveAccountDeletion, { userId: owner1 });

    // Time passing is not proof that owner1's delete failed: Better Auth removes
    // the auth user in a separate transaction after the reservation. Until the
    // recovery prune has confirmed the owner is still live, the reservation must
    // keep counting, or owner2 could delete too and leave nobody.
    await expireReservations(t, serverId);
    await expect(
      t.mutation(internal.owners.reserveAccountDeletion, { userId: owner2 }),
    ).rejects.toThrow("only owner");

    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([owner1, owner2]);
  });

  it("refreshes a retried reservation instead of releasing it", async () => {
    const { t, serverId, owner1 } = await twoOwners();
    await t.mutation(internal.owners.reserveAccountDeletion, { userId: owner1 });
    await expireReservations(t, serverId);
    const before = await t.run(async (ctx) => await ctx.db.get(serverId));
    const stale = before?.ownerDeletionReservations?.[0]?.reservedAt ?? 0;

    // A retry is the deletion still making progress, not a stalled one.
    await t.mutation(internal.owners.reserveAccountDeletion, { userId: owner1 });
    const after = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(after?.ownerDeletionReservations).toHaveLength(1);
    expect(after?.ownerDeletionReservations?.[0]?.reservedAt ?? 0).toBeGreaterThan(stale);
  });

  it("heals a ghost without a reservation when another live owner remains", async () => {
    const { t, serverId, owner1, owner2 } = await twoOwners();
    // A reservation lost across an upgrade or a race: the auth user is gone but
    // nothing recorded a pending deletion.
    await deleteAuthUser(t, owner1);

    await expect(t.mutation(internal.owners.pruneAccountDeletionReservations, {})).resolves.toBe(0);
    await t.finishAllScheduledFunctions(() => {});

    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([owner2]);
    expect(server?.ownerId).toBe(owner2);
    expect(server?.ownerDeletionReservations ?? []).toHaveLength(0);
    const members = await t.run(async (ctx) => await ctx.db.query("members").collect());
    expect(members.find((row) => row.userId === owner1)).toBeUndefined();
  });

  it("flags ghosts without reservations and does not heal the last one", async () => {
    const t = newTestWithAccounts();
    const owner = await seedAccount(t, { email: "owner@example.com" });
    const other = await seedAccount(t, { email: "other@example.com" });
    const { serverId } = await seedWorkspace(t, {
      ownerId: owner,
      ownerIds: [owner, other],
      members: [{ userId: owner }, { userId: other }],
    });
    await deleteAuthUser(t, owner);
    await deleteAuthUser(t, other);

    await expect(t.mutation(internal.owners.pruneAccountDeletionReservations, {})).resolves.toBe(0);
    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual([owner, other]);
    expect(server?.ownerDeletionReservations ?? []).toHaveLength(0);

    const flaggedOnce = await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLog").collect();
      return rows.filter((row) => row.action === "owner.deletion.orphaned");
    });
    expect(flaggedOnce).toHaveLength(2);

    // The hourly prune must not append another row for an unchanged state.
    await t.mutation(internal.owners.pruneAccountDeletionReservations, {});
    const flaggedTwice = await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLog").collect();
      return rows.filter((row) => row.action === "owner.deletion.orphaned");
    });
    expect(flaggedTwice).toHaveLength(2);
  });

  it("deduplicates the orphan audit row for a repeatedly pruned reservation", async () => {
    const t = newTestWithAccounts();
    const owner = await seedAccount(t, { email: "owner@example.com" });
    const other = await seedAccount(t, { email: "other@example.com" });
    const { serverId } = await seedWorkspace(t, {
      ownerId: owner,
      ownerIds: [owner, other],
      members: [{ userId: owner }, { userId: other }],
    });
    await t.mutation(internal.owners.reserveAccountDeletion, { userId: owner });
    await deleteAuthUser(t, owner);
    await deleteAuthUser(t, other);
    await expireReservations(t, serverId);

    await t.mutation(internal.owners.pruneAccountDeletionReservations, {});
    await t.finishAllScheduledFunctions(() => {});
    const first = await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLog").collect();
      return rows.filter((row) => row.action === "owner.deletion.orphaned");
    });
    expect(first.length).toBeGreaterThan(0);

    await t.mutation(internal.owners.pruneAccountDeletionReservations, {});
    await t.finishAllScheduledFunctions(() => {});
    const second = await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLog").collect();
      return rows.filter((row) => row.action === "owner.deletion.orphaned");
    });
    expect(second).toHaveLength(first.length);
  });
});

describe("setupState.ensureOwnerIds", () => {
  it("backfills the legacy owner list once", async () => {
    const t = newTest();
    const { serverId } = await seedWorkspace(t, { ownerId: "owner-1", members: [] });

    await expect(t.mutation(internal.setupState.ensureOwnerIds, {})).resolves.toBe(true);
    const server = await t.run(async (ctx) => await ctx.db.get(serverId));
    expect(server?.ownerIds).toEqual(["owner-1"]);
  });
});
