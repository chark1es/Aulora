import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { convexTest } from "convex-test";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { modules } from "./setup";

export type Test = ReturnType<typeof convexTest>;

export const SERVER_SETTINGS = {
  signupEnabled: true,
  inviteOnly: true,
  allowedEmailDomains: [],
};

/** The `@everyone` baseline used by most Phase 2 tests. */
export const EVERYONE_BASE: bigint =
  Permission.ViewChannel |
  Permission.SendMessages |
  Permission.SendInThreads |
  Permission.CreateThreads |
  Permission.AttachFiles |
  Permission.AddReactions |
  Permission.ReadHistory;

export function newTest(): Test {
  return convexTest(schema, modules);
}

export interface ExtraRole {
  readonly key: string;
  readonly permissions: bigint;
  readonly position?: number;
}

export interface MemberSeed {
  readonly userId: string;
  readonly roleIds?: string[];
}

export interface SeedOptions {
  readonly everyonePermissions?: bigint;
  readonly ownerId?: string;
  readonly extraRoles?: readonly ExtraRole[];
  readonly members?: readonly MemberSeed[];
}

/**
 * Seeds the server singleton, `@everyone` and members. `ownerId` defaults to
 * `owner-1`; pass members explicitly to control who can do what.
 */
export async function seedWorkspace(t: Test, options: SeedOptions = {}) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("roles", {
      key: EVERYONE_ROLE_ID,
      name: EVERYONE_ROLE_ID,
      position: 0,
      permissions: options.everyonePermissions ?? EVERYONE_BASE,
      hoisted: false,
      mentionable: true,
    });
    for (const role of options.extraRoles ?? []) {
      await ctx.db.insert("roles", {
        key: role.key,
        name: role.key,
        position: role.position ?? 1,
        permissions: role.permissions,
        hoisted: false,
        mentionable: false,
      });
    }
    const serverId = await ctx.db.insert("server", {
      name: "Acme",
      iconSeed: "seed",
      ownerId: options.ownerId ?? "owner-1",
      settings: SERVER_SETTINGS,
    });
    for (const member of options.members ?? []) {
      await ctx.db.insert("members", {
        userId: member.userId,
        roleIds: member.roleIds ?? [EVERYONE_ROLE_ID],
        joinedAt: Date.now(),
      });
    }
    return { serverId };
  });
}

export interface ChannelSeed {
  readonly kind?: "text" | "announcement" | "dm" | "group_dm";
  readonly nameCiphertext?: string;
  readonly categoryId?: Id<"categories">;
  readonly overrides?: {
    targetId: string;
    targetType: "role" | "member";
    allow: bigint;
    deny: bigint;
  }[];
  readonly archived?: boolean;
  readonly memberIds?: readonly string[];
  readonly dmKey?: string;
}

export async function seedChannel(t: Test, seed: ChannelSeed = {}): Promise<Id<"channels">> {
  return await t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      kind: seed.kind ?? "text",
      overrides: seed.overrides ?? [],
      archived: seed.archived ?? false,
      ...(seed.nameCiphertext !== undefined ? { nameCiphertext: seed.nameCiphertext } : {}),
      ...(seed.categoryId !== undefined ? { categoryId: seed.categoryId } : {}),
      ...(seed.dmKey !== undefined ? { dmKey: seed.dmKey } : {}),
    });
    const now = Date.now();
    for (const userId of seed.memberIds ?? []) {
      await ctx.db.insert("channelMembers", { channelId, userId, joinedAt: now });
    }
    return channelId;
  });
}

/** Stores a blob in Convex storage and returns its storage id. */
export async function storeBlob(t: Test, bytes: number): Promise<Id<"_storage">> {
  return await t.run(async (ctx) => {
    const blob = new Blob([new Uint8Array(bytes)]);
    return await ctx.storage.store(blob);
  });
}

/** Registers a device for a user and returns its id. */
export async function seedDevice(t: Test, userId: string): Promise<Id<"devices">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("devices", {
      userId,
      platform: "web",
      identityKey: `aulora:device:${userId}`,
      lastSeen: Date.now(),
    });
  });
}
