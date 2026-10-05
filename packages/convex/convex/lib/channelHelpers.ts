import { EVERYONE_ROLE_ID, hasPermission, Permission, resolvePermissions } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { requireChannelAccess } from "./channels";
import { addChannelMember, computeDmKey } from "./channels";
import { categoryOverridesFor } from "./permissions";
import { openContentOptional } from "./sealed";
import type { Nullable } from "./types";

type ReadCtx = Parameters<typeof requireChannelAccess>[0];

export const NAME_CONTEXT = { scope: "channel.name" } as const;
export const TOPIC_CONTEXT = { scope: "channel.topic" } as const;

/** Maximum participants in a group DM, including the caller. */
export const MAX_GROUP_DM_MEMBERS = 10;

export interface ChannelSummary {
  readonly id: Id<"channels">;
  readonly kind: Doc<"channels">["kind"];
  readonly categoryId: Nullable<Id<"categories">>;
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
  /** Hidden from the viewer's sidebar. */
  readonly hidden: boolean;
  /** Viewer has muted notifications for this channel. */
  readonly muted: boolean;
  readonly memberIds?: string[];
}

export interface ViewerChannelPref {
  readonly hidden: boolean;
  readonly muted: boolean;
}

/** The viewer's per-channel hidden/muted flags, keyed by channel id. */
export async function viewerChannelPrefs(
  ctx: ReadCtx,
  userId: string,
): Promise<Map<string, ViewerChannelPref>> {
  const rows = await ctx.db
    .query("notificationPrefs")
    .withIndex("by_user_scope", (q) => q.eq("userId", userId))
    .collect();
  const now = Date.now();
  const prefs = new Map<string, ViewerChannelPref>();
  for (const row of rows) {
    if (row.channelId === undefined) {
      continue;
    }
    prefs.set(row.channelId, {
      hidden: row.hidden === true,
      muted: row.level === "nothing" || (row.muteUntil !== undefined && row.muteUntil > now),
    });
  }
  return prefs;
}

export async function toSummary(
  channel: Doc<"channels">,
  memberIds?: string[],
  pref?: ViewerChannelPref,
): Promise<ChannelSummary> {
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
    hidden: pref?.hidden ?? false,
    muted: pref?.muted ?? false,
    ...(memberIds !== undefined ? { memberIds } : {}),
  };
}

/**
 * The next display position in a category: one past the highest defined
 * position among its channels, or `0` when none has a position yet.
 */
export async function nextChannelPosition(
  ctx: MutationCtx,
  categoryId?: Id<"categories">,
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
export function mergeGrantOverride(
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

/** Removes every membership row for a channel. */
export async function clearChannelMembers(
  ctx: MutationCtx,
  channelId: Id<"channels">,
): Promise<void> {
  const rows = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}

/** The creator plus explicit members and members of any whitelisted roles. */
export async function resolvePrivateTargets(
  ctx: MutationCtx,
  memberIds: readonly string[] | undefined,
  roleIds: readonly string[] | undefined,
): Promise<Set<string>> {
  const memberUserIds = new Set<string>();
  for (const memberId of memberIds ?? []) {
    memberUserIds.add(memberId);
  }
  if ((roleIds ?? []).length > 0) {
    const roleSet = new Set(roleIds);
    const members = await ctx.db.query("members").collect();
    for (const member of members) {
      if (member.roleIds.some((roleId) => roleSet.has(roleId))) {
        memberUserIds.add(member.userId);
      }
    }
  }
  return memberUserIds;
}

/** The grant a private channel's initial members receive. */
export function privateGrant(kind: "text" | "announcement" | "voice"): bigint {
  return kind === "voice"
    ? Permission.ViewChannel |
        Permission.Connect |
        Permission.Speak |
        Permission.Stream |
        Permission.UseVideo
    : Permission.ViewChannel | Permission.SendMessages;
}

export function applyPrivateOverrides(
  overrides: Doc<"channels">["overrides"],
  roleIds: readonly string[],
  memberIds: readonly string[],
  grant: bigint,
): Doc<"channels">["overrides"] {
  let next = overrides;
  for (const roleId of roleIds) {
    next = mergeGrantOverride(next, "role", roleId, grant);
  }
  for (const memberId of memberIds) {
    next = mergeGrantOverride(next, "member", memberId, grant);
  }
  return next;
}

/**
 * Recomputes a channel's overrides after a block toggle: blocks gain a
 * `ViewChannel` deny, unblocks drop it, empty overrides are pruned and newly
 * blocked members with no override gain one.
 */
export function computeBlockedOverrides(
  channel: Doc<"channels">,
  blocked: ReadonlySet<string>,
): { next: Doc<"channels">["overrides"]; previouslyBlocked: Set<string> } {
  const previouslyBlocked = new Set(
    channel.overrides
      .filter(
        (override) =>
          override.targetType === "member" && (override.deny & Permission.ViewChannel) !== 0n,
      )
      .map((override) => override.targetId),
  );
  const next: Doc<"channels">["overrides"] = channel.overrides
    .map((override) => {
      if (override.targetType !== "member") {
        return override;
      }
      if (blocked.has(override.targetId)) {
        return {
          ...override,
          allow: override.allow & ~Permission.ViewChannel,
          deny: override.deny | Permission.ViewChannel,
        };
      }
      if ((override.deny & Permission.ViewChannel) !== 0n) {
        return { ...override, deny: override.deny & ~Permission.ViewChannel };
      }
      return override;
    })
    .filter((override) => override.allow !== 0n || override.deny !== 0n);
  for (const blockedId of blocked) {
    const exists = next.some(
      (override) => override.targetType === "member" && override.targetId === blockedId,
    );
    if (!exists) {
      next.push({
        targetId: blockedId,
        targetType: "member",
        allow: 0n,
        deny: Permission.ViewChannel,
      });
    }
  }
  return { next, previouslyBlocked };
}

/** Every workspace member whose effective permissions can view the channel. */
export async function resolveVisibleMemberIds(
  ctx: ReadCtx,
  channel: Doc<"channels">,
): Promise<string[]> {
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
}

export async function createDmChannel(
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
    await addChannelMember(ctx, channelId, memberId, now);
  }
  return { channelId, created: true };
}
