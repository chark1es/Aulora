import { EVERYONE_ROLE_ID, hasPermission, Permission, resolvePermissions } from "@aulora/core";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import {
  computeDmKey,
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
  requirePermission,
  requireWorkspacePermission,
} from "./lib/permissions";
import { openContentOptional } from "./lib/sealed";
import { sealString } from "./lib/sse";

const createKindValidator = v.union(v.literal("text"), v.literal("announcement"));

/** Maximum participants in a group DM, including the caller. */
export const MAX_GROUP_DM_MEMBERS = 10;

const NAME_CONTEXT = { scope: "channel.name" } as const;
const TOPIC_CONTEXT = { scope: "channel.topic" } as const;

interface ChannelSummary {
  readonly id: Id<"channels">;
  readonly kind: Doc<"channels">["kind"];
  readonly categoryId: Id<"categories"> | null;
  /** Decrypted channel name; `null` when unset. */
  readonly name: string | null;
  /** Decrypted channel topic; `null` when unset. */
  readonly topic: string | null;
  readonly archived: boolean;
  /** A private channel: only explicit members ever see it. */
  readonly isPrivate: boolean;
  /** Current role/member permission overrides, read-only for the editors. */
  readonly overrides: Doc<"channels">["overrides"];
  /** Display order within its category; falls back to creation order when unset. */
  readonly position: number;
  readonly memberIds?: string[];
}

async function toSummary(channel: Doc<"channels">, memberIds?: string[]): Promise<ChannelSummary> {
  return {
    id: channel._id,
    kind: channel.kind,
    categoryId: channel.categoryId ?? null,
    name: await openContentOptional(NAME_CONTEXT, channel.nameCiphertext),
    topic: await openContentOptional(TOPIC_CONTEXT, channel.topicCiphertext),
    archived: channel.archived,
    isPrivate: channel.private === true,
    overrides: channel.overrides,
    position: channel.position ?? 0,
    ...(memberIds !== undefined ? { memberIds } : {}),
  };
}

/**
 * The next display position in a category: one past the highest defined
 * position among its channels, or `0` when none has a position yet.
 */
async function nextChannelPosition(
  ctx: MutationCtx,
  categoryId: Id<"categories"> | undefined,
): Promise<number> {
  const siblings =
    categoryId !== undefined
      ? await ctx.db
          .query("channels")
          .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
          .collect()
      : (await ctx.db.query("channels").collect()).filter(
          (channel) => channel.categoryId === undefined,
        );
  let max = -1;
  for (const sibling of siblings) {
    if (sibling.position !== undefined && sibling.position > max) {
      max = sibling.position;
    }
  }
  return max + 1;
}

/** Adds `grant` to the matching override's `allow`, or appends a new grant-only override. */
function mergeGrantOverride(
  overrides: Doc<"channels">["overrides"],
  targetType: "role" | "member",
  targetId: string,
  grant: bigint,
): Doc<"channels">["overrides"] {
  const index = overrides.findIndex(
    (override) => override.targetId === targetId && override.targetType === targetType,
  );
  if (index < 0) {
    return [...overrides, { targetId, targetType, allow: grant, deny: 0n }];
  }
  return overrides.map((override, i) =>
    i === index ? { ...override, allow: override.allow | grant } : override,
  );
}

/**
 * Creates a text or announcement channel. ManageChannels is resolved against
 * the workspace baseline plus the target category's overrides. A private
 * channel starts with its creator plus any whitelisted members and roles
 * (granted `ViewChannel | SendMessages`). The channel gets the next position
 * within its category.
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
    const memberUserIds = new Set<string>();
    let overrides = args.overrides ?? [];
    if (args.private === true) {
      for (const memberId of args.memberIds ?? []) {
        memberUserIds.add(memberId);
      }
      const roleIds = args.roleIds ?? [];
      if (roleIds.length > 0) {
        const roleSet = new Set(roleIds);
        const members = await ctx.db.query("members").collect();
        for (const member of members) {
          if (member.roleIds.some((roleId) => roleSet.has(roleId))) {
            memberUserIds.add(member.userId);
          }
        }
      }
      const grant = Permission.ViewChannel | Permission.SendMessages;
      for (const roleId of roleIds) {
        overrides = mergeGrantOverride(overrides, "role", roleId, grant);
      }
      for (const memberId of args.memberIds ?? []) {
        overrides = mergeGrantOverride(overrides, "member", memberId, grant);
      }
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
          page.push(await toSummary(channel, await listChannelMemberIds(ctx, channel._id)));
        }
        continue;
      }
      const categoryOverrides = await categoryOverridesFor(ctx, channel);
      const permissions = channelPermissions(context, channel, categoryOverrides);
      if (!hasPermission(permissions, Permission.ViewChannel)) {
        continue;
      }
      page.push(await toSummary(channel));
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
    const server = await ctx.db.query("server").first();
    const ownerId = server?.ownerId ?? null;
    const members = await ctx.db.query("members").collect();
    const roles = (await ctx.db.query("roles").collect()).map((role) => {
      const id = role.key ?? role._id;
      return {
        id,
        position: role.position,
        permissions: role.permissions,
        isEveryone: id === EVERYONE_ROLE_ID,
      };
    });
    const categoryOverrides = await categoryOverridesFor(ctx, channel);
    const visible: string[] = [];
    for (const member of members) {
      const permissions = resolvePermissions({
        actor: {
          userId: member.userId,
          roleIds: member.roleIds,
          isOwner: member.userId === ownerId,
        },
        roles,
        categoryOverrides,
        channelOverrides: channel.overrides,
      });
      if (hasPermission(permissions, Permission.ViewChannel)) {
        visible.push(member.userId);
      }
    }
    return visible;
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
    return await toSummary(result.channel, memberIds);
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
    if (isDmKind(channel.kind)) {
      throw new ConvexError("Cannot join a DM");
    }
    if (channel.private === true) {
      throw new ConvexError("This channel is private. Ask a member to add you.");
    }
    const added = await insertChannelMember(ctx, args.channelId, userId);
    if (added) {
      await writeAudit(ctx, { actorId: userId, action: "channel.join", targetId: args.channelId });
    }
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
    if (removed) {
      await writeAudit(ctx, { actorId: userId, action: "channel.leave", targetId: args.channelId });
    }
    return { left: removed };
  },
});

async function createDmChannel(
  ctx: MutationCtx,
  userId: string,
  otherUserIds: readonly string[],
  kind: "dm" | "group_dm",
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
  });
  const now = Date.now();
  for (const memberId of memberIds) {
    await insertChannelMember(ctx, channelId, memberId, now);
  }
  return { channelId, created: true };
}

/** Creates (or reuses) a 1:1 DM with another user. */
export const createDm = mutation({
  args: { otherUserId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const result = await createDmChannel(ctx, userId, [args.otherUserId], "dm");
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
  args: { memberIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const result = await createDmChannel(ctx, userId, args.memberIds, "group_dm");
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
      page.push(await toSummary(channel, await listChannelMemberIds(ctx, channel._id)));
    }
    return { ...result, page };
  },
});
