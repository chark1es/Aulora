import { hasPermission, Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import {
  addChannelMember,
  computeDmKey,
  isDmKind,
  listChannelMemberIds,
  removeChannelMember,
  requireChannelAccess,
} from "./lib/channels";
import { overwriteValidator, validateOverrides } from "./lib/overrides";
import {
  categoryOverridesFor,
  channelOverrideRemovals,
  channelPermissions,
  loadPermissionContext,
  mlsSignal,
  requirePermission,
  requireWorkspacePermission,
} from "./lib/permissions";

const createKindValidator = v.union(v.literal("text"), v.literal("announcement"));

/** Maximum participants in a group DM, including the caller. */
export const MAX_GROUP_DM_MEMBERS = 10;

interface ChannelSummary {
  readonly id: Id<"channels">;
  readonly kind: Doc<"channels">["kind"];
  readonly categoryId: Id<"categories"> | null;
  readonly nameCiphertext: string | null;
  readonly topicCiphertext: string | null;
  readonly mlsGroupId: string | null;
  readonly archived: boolean;
  readonly currentEpoch: number | null;
  readonly memberIds?: string[];
}

function toSummary(channel: Doc<"channels">, memberIds?: string[]): ChannelSummary {
  return {
    id: channel._id,
    kind: channel.kind,
    categoryId: channel.categoryId ?? null,
    nameCiphertext: channel.nameCiphertext ?? null,
    topicCiphertext: channel.topicCiphertext ?? null,
    mlsGroupId: channel.mlsGroupId ?? null,
    archived: channel.archived,
    currentEpoch: channel.currentEpoch ?? null,
    ...(memberIds !== undefined ? { memberIds } : {}),
  };
}

/**
 * Creates a text or announcement channel. ManageChannels is resolved against
 * the workspace baseline plus the target category's overrides.
 */
export const create = mutation({
  args: {
    kind: createKindValidator,
    nameCiphertext: v.optional(v.string()),
    topicCiphertext: v.optional(v.string()),
    mlsGroupId: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    overrides: v.optional(v.array(overwriteValidator)),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(
      ctx,
      Permission.ManageChannels,
      args.categoryId,
    );
    validateOverrides(args.overrides ?? []);
    const channelId = await ctx.db.insert("channels", {
      kind: args.kind,
      overrides: args.overrides ?? [],
      archived: false,
      ...(args.categoryId !== undefined ? { categoryId: args.categoryId } : {}),
      ...(args.nameCiphertext !== undefined ? { nameCiphertext: args.nameCiphertext } : {}),
      ...(args.topicCiphertext !== undefined ? { topicCiphertext: args.topicCiphertext } : {}),
      ...(args.mlsGroupId !== undefined ? { mlsGroupId: args.mlsGroupId } : {}),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.create",
      targetId: channelId,
      meta: JSON.stringify({ kind: args.kind }),
    });
    return channelId;
  },
});

/**
 * Paginated channel list. Channels without `ViewChannel` after category and
 * channel overrides are filtered out of the page. DMs are listed separately by
 * {@link listDms}.
 */
export const list = query({
  args: { paginationOpts: v.optional(paginationOptsValidator) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const context = await loadPermissionContext(ctx, userId);
    const result = await ctx.db
      .query("channels")
      .order("asc")
      .paginate(args.paginationOpts ?? { numItems: 50, cursor: null });

    const page: ChannelSummary[] = [];
    for (const channel of result.page) {
      if (isDmKind(channel.kind)) {
        continue;
      }
      const categoryOverrides = await categoryOverridesFor(ctx, channel);
      const permissions = channelPermissions(context, channel, categoryOverrides);
      if (!hasPermission(permissions, Permission.ViewChannel)) {
        continue;
      }
      page.push(toSummary(channel));
    }
    return { ...result, page };
  },
});

/** Fetches one visible channel; DMs additionally require membership. */
export const get = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const result = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const memberIds = isDmKind(result.channel.kind)
      ? await listChannelMemberIds(ctx, result.channel._id)
      : undefined;
    return toSummary(result.channel, memberIds);
  },
});

/** Sets a new encrypted channel name. */
export const rename = mutation({
  args: { channelId: v.id("channels"), nameCiphertext: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, args.channelId, Permission.ManageChannels);
    await ctx.db.patch(args.channelId, { nameCiphertext: args.nameCiphertext });
    await writeAudit(ctx, { actorId: userId, action: "channel.rename", targetId: args.channelId });
    return null;
  },
});

/** Sets a new encrypted channel topic. */
export const setTopic = mutation({
  args: { channelId: v.id("channels"), topicCiphertext: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, args.channelId, Permission.ManageChannels);
    await ctx.db.patch(args.channelId, { topicCiphertext: args.topicCiphertext });
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.setTopic",
      targetId: args.channelId,
    });
    return null;
  },
});

/**
 * Records the MLS group id for a channel that does not have one yet. This is
 * the first-joiner bootstrap: only ViewChannel is required (the creator of a
 * public channel may not hold ManageChannels), and a channel that already has
 * a different group id is rejected so a second client cannot fork the group.
 */
export const setMlsGroupId = mutation({
  args: { channelId: v.id("channels"), mlsGroupId: v.string() },
  handler: async (ctx, args) => {
    const { userId, channel } = await requirePermission(
      ctx,
      args.channelId,
      Permission.ViewChannel,
    );
    if (channel.mlsGroupId !== undefined) {
      if (channel.mlsGroupId !== args.mlsGroupId) {
        throw new ConvexError("Channel already has an MLS group");
      }
      return null;
    }
    await ctx.db.patch(args.channelId, { mlsGroupId: args.mlsGroupId });
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.setMlsGroupId",
      targetId: args.channelId,
    });
    return null;
  },
});

export const archive = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, args.channelId, Permission.ManageChannels);
    await ctx.db.patch(args.channelId, { archived: true });
    await writeAudit(ctx, { actorId: userId, action: "channel.archive", targetId: args.channelId });
    return null;
  },
});

export const unarchive = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, args.channelId, Permission.ManageChannels);
    await ctx.db.patch(args.channelId, { archived: false });
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.unarchive",
      targetId: args.channelId,
    });
    return null;
  },
});

/**
 * Replaces a channel's permission overrides. Members who lose `ViewChannel` as
 * a result are returned as MLS removals for the client to commit. Requires
 * `ManageChannels` (resolved against the channel and its category overrides).
 */
export const setOverrides = mutation({
  args: { channelId: v.id("channels"), overrides: v.array(overwriteValidator) },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, args.channelId, Permission.ManageChannels);
    validateOverrides(args.overrides);
    const channel = await ctx.db.get(args.channelId);
    if (channel === null) {
      throw new ConvexError("Channel not found");
    }
    const removals = await channelOverrideRemovals(ctx, channel, args.overrides);
    await ctx.db.patch(args.channelId, { overrides: args.overrides });
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.setOverrides",
      targetId: args.channelId,
      meta: JSON.stringify({ count: args.overrides.length }),
    });
    return mlsSignal(removals);
  },
});

/** Clears one override target from a channel. Returns any MLS removals. */
export const clearOverride = mutation({
  args: {
    channelId: v.id("channels"),
    targetId: v.string(),
    targetType: v.union(v.literal("role"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, args.channelId, Permission.ManageChannels);
    const channel = await ctx.db.get(args.channelId);
    if (channel === null) {
      throw new ConvexError("Channel not found");
    }
    const nextOverrides = channel.overrides.filter(
      (override) =>
        !(override.targetId === args.targetId && override.targetType === args.targetType),
    );
    const removals = await channelOverrideRemovals(ctx, channel, nextOverrides);
    await ctx.db.patch(args.channelId, { overrides: nextOverrides });
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.clearOverride",
      targetId: args.channelId,
      meta: JSON.stringify({ targetId: args.targetId, targetType: args.targetType }),
    });
    return mlsSignal(removals);
  },
});

/**
 * Joins a public channel's MLS group. The requester must have `ViewChannel`.
 * Returns the MLS action a client should publish (`add`), or `null` when the
 * caller was already a member. The server never builds commits itself.
 */
export const join = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const { userId, channel } = await requirePermission(
      ctx,
      args.channelId,
      Permission.ViewChannel,
    );
    if (isDmKind(channel.kind)) {
      throw new ConvexError("Cannot join a DM");
    }
    const added = await addChannelMember(ctx, args.channelId, userId);
    if (added) {
      await writeAudit(ctx, { actorId: userId, action: "channel.join", targetId: args.channelId });
    }
    return { joined: true, mlsAction: added ? ("add" as const) : null };
  },
});

/** Leaves a channel's MLS group; returns the MLS action (`remove`) if changed. */
export const leave = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const removed = await removeChannelMember(ctx, args.channelId, userId);
    if (removed) {
      await writeAudit(ctx, { actorId: userId, action: "channel.leave", targetId: args.channelId });
    }
    return { left: true, mlsAction: removed ? ("remove" as const) : null };
  },
});

async function createDmChannel(
  ctx: MutationCtx,
  userId: string,
  otherUserIds: readonly string[],
  kind: "dm" | "group_dm",
  mlsGroupId: string | undefined,
): Promise<{ channelId: Id<"channels">; created: boolean }> {
  const memberIds = [...new Set([userId, ...otherUserIds])];
  if (memberIds.length < 2) {
    throw new ConvexError("A DM needs at least two members");
  }
  if (memberIds.length > MAX_GROUP_DM_MEMBERS) {
    throw new ConvexError("Too many DM members");
  }
  const dmKey = computeDmKey(kind, memberIds);
  const existing = await ctx.db
    .query("channels")
    .withIndex("by_dm_key", (q) => q.eq("dmKey", dmKey))
    .unique();
  if (existing !== null) {
    return { channelId: existing._id, created: false };
  }
  const channelId = await ctx.db.insert("channels", {
    kind,
    overrides: [],
    archived: false,
    dmKey,
    ...(mlsGroupId !== undefined ? { mlsGroupId } : {}),
  });
  const now = Date.now();
  for (const memberId of memberIds) {
    await addChannelMember(ctx, channelId, memberId, now);
  }
  return { channelId, created: true };
}

/** Creates (or reuses) a 1:1 DM with another user. */
export const createDm = mutation({
  args: { otherUserId: v.string(), mlsGroupId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const result = await createDmChannel(ctx, userId, [args.otherUserId], "dm", args.mlsGroupId);
    if (result.created) {
      await writeAudit(ctx, {
        actorId: userId,
        action: "channel.createDm",
        targetId: result.channelId,
      });
    }
    return result;
  },
});

/** Creates (or reuses) a group DM. Total participants, caller included, <= 10. */
export const createGroupDm = mutation({
  args: { memberIds: v.array(v.string()), mlsGroupId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const result = await createDmChannel(ctx, userId, args.memberIds, "group_dm", args.mlsGroupId);
    if (result.created) {
      await writeAudit(ctx, {
        actorId: userId,
        action: "channel.createGroupDm",
        targetId: result.channelId,
      });
    }
    return result;
  },
});

/**
 * Paginated DMs and group DMs the caller participates in, newest membership
 * first. Membership is proven by `channelMembers`, not `ViewChannel`.
 */
export const listDms = query({
  args: { paginationOpts: v.optional(paginationOptsValidator) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const result = await ctx.db
      .query("channelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts ?? { numItems: 50, cursor: null });

    const page: ChannelSummary[] = [];
    for (const membership of result.page) {
      const channel = await ctx.db.get(membership.channelId);
      if (channel === null || !isDmKind(channel.kind)) {
        continue;
      }
      page.push(toSummary(channel, await listChannelMemberIds(ctx, channel._id)));
    }
    return { ...result, page };
  },
});
