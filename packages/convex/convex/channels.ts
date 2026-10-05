import { hasPermission, Permission } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { assertMayParticipate } from "./lib/bans";
import {
  applyPrivateOverrides,
  type ChannelSummary,
  clearChannelMembers,
  computeBlockedOverrides,
  createDmChannel,
  NAME_CONTEXT,
  nextChannelPosition,
  privateGrant,
  resolvePrivateTargets,
  resolveVisibleMemberIds,
  TOPIC_CONTEXT,
  toSummary,
  viewerChannelPrefs,
} from "./lib/channelHelpers";
import {
  removeChannelMember as deleteChannelMember,
  findChannelMember,
  addChannelMember as insertChannelMember,
  isDmKind,
  listChannelMemberIds,
  requireChannelAccess,
} from "./lib/channels";
import { overwriteValidator, validateOverrides } from "./lib/overrides";
import {
  categoryOverridesFor,
  channelPermissions,
  loadPermissionContext,
  requireMember,
  requirePermission,
  requireWorkspacePermission,
} from "./lib/permissions";
import { sealString } from "./lib/sse";

export { MAX_GROUP_DM_MEMBERS } from "./lib/channelHelpers";

const createKindValidator = v.union(
  v.literal("text"),
  v.literal("announcement"),
  v.literal("voice"),
);

/**
 * Creates a text, announcement or voice channel. ManageChannels is resolved
 * against the workspace baseline plus the target category's overrides. A
 * private channel starts with its creator plus any whitelisted members and
 * roles (granted `ViewChannel | SendMessages`, or the voice flags for a voice
 * channel). The channel gets the next position within its category.
 */
export const create = mutation({
  args: {
    kind: createKindValidator,
    name: v.string(),
    topic: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    overrides: v.optional(v.array(overwriteValidator)),
    private: v.optional(v.boolean()),
    memberIds: v.optional(v.array(v.string())),
    roleIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(
      ctx,
      Permission.ManageChannels,
      args.categoryId,
    );
    let overrides = args.overrides ?? [];
    let memberUserIds = new Set<string>();
    if (args.private === true) {
      const roleIds = args.roleIds ?? [];
      const memberIds = args.memberIds ?? [];
      memberUserIds = await resolvePrivateTargets(ctx, args.memberIds, args.roleIds);
      overrides = applyPrivateOverrides(overrides, roleIds, memberIds, privateGrant(args.kind));
    }
    validateOverrides(overrides);
    const nameCiphertext = await sealString(NAME_CONTEXT, args.name);
    const topic = args.topic?.trim() ?? "";
    const topicCiphertext = topic.length > 0 ? await sealString(TOPIC_CONTEXT, topic) : undefined;
    const position = await nextChannelPosition(ctx, args.categoryId);
    const channelId = await ctx.db.insert("channels", {
      kind: args.kind,
      overrides,
      archived: false,
      position,
      nameCiphertext,
      ...(topicCiphertext !== undefined ? { topicCiphertext } : {}),
      ...(args.private === true ? { private: true } : {}),
      ...(args.categoryId !== undefined ? { categoryId: args.categoryId } : {}),
    });
    if (args.private === true) {
      await insertChannelMember(ctx, channelId, userId);
      for (const memberId of memberUserIds) {
        await insertChannelMember(ctx, channelId, memberId);
      }
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.create",
      targetId: channelId,
      meta: JSON.stringify({ kind: args.kind, private: args.private === true }),
    });
    return channelId;
  },
});

/**
 * Paginated channel list. Private channels are only returned to explicit
 * members. Non-private channels without `ViewChannel` after category and
 * channel overrides are filtered out of the page. DMs are listed separately by
 * {@link listDms}.
 */
export const list = query({
  args: { paginationOpts: v.optional(paginationOptsValidator) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const context = await loadPermissionContext(ctx, userId);
    const viewerPrefs = await viewerChannelPrefs(ctx, userId);
    // DMs are filtered before pagination so they never crowd channels out of
    // a page; they are listed by `listDms`.
    const result = await ctx.db
      .query("channels")
      .filter((q) => q.and(q.neq(q.field("kind"), "dm"), q.neq(q.field("kind"), "group_dm")))
      .order("asc")
      .paginate(args.paginationOpts ?? { numItems: 50, cursor: null });

    const page: ChannelSummary[] = [];
    for (const channel of result.page) {
      if (channel.private === true) {
        // Membership is the only gate for a private channel.
        if (await findChannelMember(ctx, channel._id, userId)) {
          page.push(
            await toSummary(
              channel,
              await listChannelMemberIds(ctx, channel._id),
              viewerPrefs.get(channel._id),
            ),
          );
        }
        continue;
      }
      const categoryOverrides = await categoryOverridesFor(ctx, channel);
      const permissions = channelPermissions(context, channel, categoryOverrides);
      if (!hasPermission(permissions, Permission.ViewChannel)) {
        continue;
      }
      page.push(await toSummary(channel, undefined, viewerPrefs.get(channel._id)));
    }
    return { ...result, page };
  },
});

/**
 * Applies a batch of drag-and-drop moves. Each move needs `ManageChannels` on
 * its channel. `categoryId` omitted leaves the category unchanged; `null`
 * moves the channel to the uncategorised group.
 */
export const reorder = mutation({
  args: {
    moves: v.array(
      v.object({
        channelId: v.id("channels"),
        categoryId: v.optional(v.union(v.id("categories"), v.null())),
        position: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let actorId: string | null = null;
    for (const move of args.moves) {
      const { userId } = await requirePermission(ctx, move.channelId, Permission.ManageChannels);
      actorId = userId;
      await ctx.db.patch(move.channelId, {
        position: move.position,
        ...(move.categoryId !== undefined
          ? { categoryId: move.categoryId === null ? undefined : move.categoryId }
          : {}),
      });
    }
    if (actorId !== null) {
      await writeAudit(ctx, {
        actorId,
        action: "channel.reorder",
        meta: JSON.stringify({ count: args.moves.length }),
      });
    }
    return null;
  },
});

/**
 * The workspace members who can currently view a channel. Private channels and
 * DMs return their explicit members; other channels resolve each member's
 * effective permission bitfield (category + channel overrides).
 */
export const visibleMemberIds = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const { channel } = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    if (isDmKind(channel.kind) || channel.private === true) {
      return await listChannelMemberIds(ctx, channel._id);
    }
    return await resolveVisibleMemberIds(ctx, channel);
  },
});

/** Fetches one visible channel; DMs and private channels also require membership. */
export const get = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const result = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const memberIds =
      isDmKind(result.channel.kind) || result.channel.private === true
        ? await listChannelMemberIds(ctx, result.channel._id)
        : undefined;
    const viewerPrefs = await viewerChannelPrefs(ctx, result.userId);
    return await toSummary(result.channel, memberIds, viewerPrefs.get(result.channel._id));
  },
});

/** Sets a new channel name, sealing the plaintext. */
export const rename = mutation({
  args: { channelId: v.id("channels"), name: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, args.channelId, Permission.ManageChannels);
    const nameCiphertext = await sealString(NAME_CONTEXT, args.name);
    await ctx.db.patch(args.channelId, { nameCiphertext });
    await writeAudit(ctx, { actorId: userId, action: "channel.rename", targetId: args.channelId });
    return null;
  },
});

/** Sets a new channel topic; an empty or absent topic clears it. */
export const setTopic = mutation({
  args: { channelId: v.id("channels"), topic: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, args.channelId, Permission.ManageChannels);
    const topic = args.topic?.trim() ?? "";
    const topicCiphertext = topic.length > 0 ? await sealString(TOPIC_CONTEXT, topic) : undefined;
    await ctx.db.patch(args.channelId, { topicCiphertext });
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.setTopic",
      targetId: args.channelId,
    });
    return null;
  },
});

/**
 * Switches a channel between private and public. Making it private resets
 * membership to the actor plus the supplied members; making it public clears
 * every membership row and removes the `private` flag.
 */
export const setPrivate = mutation({
  args: {
    channelId: v.id("channels"),
    private: v.boolean(),
    memberIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId, channel } = await requirePermission(
      ctx,
      args.channelId,
      Permission.ManageChannels,
    );
    if (isDmKind(channel.kind)) {
      throw new ConvexError("Cannot change the privacy of a DM");
    }
    await clearChannelMembers(ctx, args.channelId);
    if (args.private) {
      await ctx.db.patch(args.channelId, { private: true });
      await insertChannelMember(ctx, args.channelId, userId);
      for (const memberId of new Set(args.memberIds ?? [])) {
        await insertChannelMember(ctx, args.channelId, memberId);
      }
    } else {
      await ctx.db.patch(args.channelId, { private: undefined });
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.setPrivate",
      targetId: args.channelId,
      meta: JSON.stringify({ private: args.private }),
    });
    return null;
  },
});

/**
 * Replaces the members denied `ViewChannel` on a channel. The deny bit is
 * toggled surgically so other allow/deny bits on each member override are
 * preserved; role overrides are untouched. On a private channel, blocking also
 * removes membership and unblocking restores it.
 */
export const setBlockedUsers = mutation({
  args: { channelId: v.id("channels"), userIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { userId, channel } = await requirePermission(
      ctx,
      args.channelId,
      Permission.ManageChannels,
    );
    if (isDmKind(channel.kind)) {
      throw new ConvexError("Cannot block users from a DM");
    }
    const blocked = new Set(args.userIds);
    const { next, previouslyBlocked } = computeBlockedOverrides(channel, blocked);
    validateOverrides(next);
    await ctx.db.patch(args.channelId, { overrides: next });
    if (channel.private === true) {
      for (const blockedId of blocked) {
        if (!previouslyBlocked.has(blockedId)) {
          await deleteChannelMember(ctx, args.channelId, blockedId);
        }
      }
      for (const unblockedId of previouslyBlocked) {
        if (!blocked.has(unblockedId)) {
          await insertChannelMember(ctx, args.channelId, unblockedId);
        }
      }
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.setBlocked",
      targetId: args.channelId,
      meta: JSON.stringify({ count: blocked.size }),
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

/** Alias of {@link archive}. */
export const archiveChannel = archive;
/** Alias of {@link unarchive}. */
export const unarchiveChannel = unarchive;

/** Replaces a channel's permission overrides. Requires `ManageChannels`. */
export const setOverrides = mutation({
  args: { channelId: v.id("channels"), overrides: v.array(overwriteValidator) },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, args.channelId, Permission.ManageChannels);
    validateOverrides(args.overrides);
    const channel = await ctx.db.get(args.channelId);
    if (channel === null) {
      throw new ConvexError("Channel not found");
    }
    await ctx.db.patch(args.channelId, { overrides: args.overrides });
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.setOverrides",
      targetId: args.channelId,
      meta: JSON.stringify({ count: args.overrides.length }),
    });
    return null;
  },
});

/** Clears one override target from a channel. */
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
    await ctx.db.patch(args.channelId, { overrides: nextOverrides });
    await writeAudit(ctx, {
      actorId: userId,
      action: "channel.clearOverride",
      targetId: args.channelId,
      meta: JSON.stringify({ targetId: args.targetId, targetType: args.targetType }),
    });
    return null;
  },
});

/**
 * Joins a public channel. The requester must have `ViewChannel`. Private
 * channels cannot be self-joined; a member must add you. Returns whether the
 * caller was newly added as a member.
 */
export const join = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const { userId, channel } = await requirePermission(
      ctx,
      args.channelId,
      Permission.ViewChannel,
    );
    await assertMayParticipate(ctx, userId);
    if (isDmKind(channel.kind)) {
      throw new ConvexError("Cannot join a DM");
    }
    if (channel.private === true) {
      throw new ConvexError("This channel is private. Ask a member to add you.");
    }
    const added = await insertChannelMember(ctx, args.channelId, userId);
    return { joined: added };
  },
});

/**
 * Adds a member to a private channel. Requires `ManageChannels` for the
 * channel (or its creator, who holds membership).
 */
export const addMember = mutation({
  args: { channelId: v.id("channels"), userId: v.string() },
  handler: async (ctx, args) => {
    const { userId: actorId, channel } = await requirePermission(
      ctx,
      args.channelId,
      Permission.ManageChannels,
    );
    if (channel.private !== true) {
      throw new ConvexError("Only private channels manage members directly");
    }
    const added = await insertChannelMember(ctx, args.channelId, args.userId);
    if (added) {
      await writeAudit(ctx, {
        actorId,
        action: "channel.member.add",
        targetId: args.channelId,
        meta: JSON.stringify({ userId: args.userId }),
      });
    }
    return { added };
  },
});

/** Alias of {@link addMember}. */
export const addChannelMember = addMember;

/**
 * Removes a member from a private channel. The actor may remove anyone with
 * `ManageChannels`, or themself (leaving).
 */
export const removeMember = mutation({
  args: { channelId: v.id("channels"), userId: v.string() },
  handler: async (ctx, args) => {
    const { userId: actorId, channel } = await requirePermission(
      ctx,
      args.channelId,
      Permission.ViewChannel,
    );
    if (channel.private !== true) {
      throw new ConvexError("Only private channels manage members directly");
    }
    if (args.userId !== actorId) {
      await requirePermission(ctx, args.channelId, Permission.ManageChannels);
    }
    const removed = await deleteChannelMember(ctx, args.channelId, args.userId);
    if (removed) {
      await writeAudit(ctx, {
        actorId,
        action: "channel.member.remove",
        targetId: args.channelId,
        meta: JSON.stringify({ userId: args.userId }),
      });
    }
    return { removed };
  },
});

/** Alias of {@link removeMember}. */
export const removeChannelMember = removeMember;

/** Leaves a channel. Returns whether a membership row was removed. */
export const leave = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const removed = await deleteChannelMember(ctx, args.channelId, userId);
    return { left: removed };
  },
});

/** Creates (or reuses) a 1:1 DM with another user. */
export const createDm = mutation({
  args: { otherUserId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    return await createDmChannel(ctx, userId, [args.otherUserId], "dm");
  },
});

/** Creates (or reuses) a group DM. Total participants, caller included, <= 10. */
export const createGroupDm = mutation({
  args: { memberIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    return await createDmChannel(ctx, userId, args.memberIds, "group_dm");
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
    const viewerPrefs = await viewerChannelPrefs(ctx, userId);
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
      page.push(
        await toSummary(
          channel,
          await listChannelMemberIds(ctx, channel._id),
          viewerPrefs.get(channel._id),
        ),
      );
    }
    return { ...result, page };
  },
});
