import { hasPermission } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuth } from "./auth";
import {
  categoryOverridesFor,
  channelPermissions,
  type PermissionContext,
  requirePermissionForUser,
} from "./permissions";

export type ChannelKind = "text" | "announcement" | "voice" | "dm" | "group_dm";

export const DM_CHANNEL_KINDS: readonly ChannelKind[] = ["dm", "group_dm"];

export function isDmKind(kind: string): kind is "dm" | "group_dm" {
  return kind === "dm" || kind === "group_dm";
}

/**
 * Stable dedupe key for a DM or group DM: kind plus the sorted, deduplicated
 * participant ids. Two create calls with the same people always produce the
 * same key, so the server reuses the existing channel.
 */
export function computeDmKey(kind: "dm" | "group_dm", userIds: readonly string[]): string {
  const members = [...new Set(userIds)].sort();
  return `${kind}:${members.join(":")}`;
}

type ReadCtx = QueryCtx | MutationCtx;

export async function findChannelMember(
  ctx: ReadCtx,
  channelId: Id<"channels">,
  userId: string,
): Promise<boolean> {
  const row = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
    .unique();
  return row !== null;
}

export async function requireChannelMember(
  ctx: ReadCtx,
  channelId: Id<"channels">,
  userId: string,
): Promise<void> {
  if (!(await findChannelMember(ctx, channelId, userId))) {
    throw new ConvexError("Not a channel member");
  }
}

export async function listChannelMemberIds(
  ctx: ReadCtx,
  channelId: Id<"channels">,
): Promise<string[]> {
  const rows = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  return rows.map((row) => row.userId);
}

/** Adds a member; returns `true` when the row was newly inserted. */
export async function addChannelMember(
  ctx: MutationCtx,
  channelId: Id<"channels">,
  userId: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (await findChannelMember(ctx, channelId, userId)) {
    return false;
  }
  await ctx.db.insert("channelMembers", { channelId, userId, joinedAt: now });
  return true;
}

/** Removes a member; returns `true` when a row was removed. */
export async function removeChannelMember(
  ctx: MutationCtx,
  channelId: Id<"channels">,
  userId: string,
): Promise<boolean> {
  const row = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
    .unique();
  if (row === null) {
    return false;
  }
  await ctx.db.delete(row._id);
  return true;
}

/**
 * The common access gate for channel-scoped reads and writes: `requirePermission`
 * for the flag, plus a membership check for DMs and group DMs (whose
 * `@everyone` baseline would otherwise make every DM visible) and for private
 * channels (whose membership, not the permission bitfield, decides access).
 */
export async function requireChannelAccess(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<"channels">,
  flag: bigint,
) {
  const { userId } = await requireAuth(ctx);
  return await requireChannelAccessForUser(ctx, userId, channelId, flag);
}

/**
 * {@link requireChannelAccess} for an explicit actor, used where the identity
 * is not the Convex session (for example a signed download token re-validated
 * in an internal function).
 */
export async function requireChannelAccessForUser(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  channelId: Id<"channels">,
  flag: bigint,
) {
  const result = await requirePermissionForUser(ctx, userId, channelId, flag);
  if (isDmKind(result.channel.kind) || result.channel.private === true) {
    await requireChannelMember(ctx, channelId, result.userId);
  }
  return result;
}

/**
 * {@link requireChannelAccess} for an actor whose {@link PermissionContext} is
 * already loaded, so a caller gating many channels pays the role/server load
 * once instead of once per channel. Access decisions are identical.
 */
export async function requireChannelAccessFromContext(
  ctx: QueryCtx | MutationCtx,
  context: PermissionContext,
  channelId: Id<"channels">,
  flag: bigint,
) {
  const channel = await ctx.db.get(channelId);
  if (channel === null) {
    throw new ConvexError("Channel not found");
  }
  const categoryOverrides = await categoryOverridesFor(ctx, channel);
  const permissions = channelPermissions(context, channel, categoryOverrides);
  if (!hasPermission(permissions, flag)) {
    throw new ConvexError("Missing permission");
  }
  if (isDmKind(channel.kind) || channel.private === true) {
    await requireChannelMember(ctx, channelId, context.userId);
  }
  return { userId: context.userId, channel, permissions };
}
