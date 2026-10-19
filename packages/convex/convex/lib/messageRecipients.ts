import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type NotificationLevel = "all" | "mentions" | "nothing";

/** A recipient whose presence heartbeat is younger than this is treated as
 * actively using Aulora, so it is skipped (the plan's "skips anyone active"). */
export const ACTIVE_PRESENCE_MS = 60_000;

export interface ResolvedPref {
  readonly level: NotificationLevel;
  readonly muteUntil: number | undefined;
}

/**
 * Channel prefs win over server prefs; absent both, the default is "all". A
 * `muteUntil` in the future suppresses delivery regardless of level.
 */
export async function resolvePref(
  ctx: QueryCtx,
  userId: string,
  channelId: Id<"channels">,
): Promise<ResolvedPref> {
  const rows = await ctx.db
    .query("notificationPrefs")
    .withIndex("by_user_scope", (q) => q.eq("userId", userId))
    .collect();
  const channelPref = rows.find((row) => row.scope === "channel" && row.channelId === channelId);
  const serverPref = rows.find((row) => row.scope === "server");
  const chosen = channelPref ?? serverPref;
  return {
    level: chosen?.level ?? "all",
    muteUntil: chosen?.muteUntil,
  };
}

interface CandidateInfo {
  channelId: Id<"channels">;
  mentioned: boolean;
}

function addCandidate(
  candidates: Map<string, CandidateInfo>,
  userId: string,
  prefChannelId: Id<"channels">,
  mentioned: boolean,
): void {
  const existing = candidates.get(userId);
  if (existing === undefined) {
    candidates.set(userId, { channelId: prefChannelId, mentioned });
    return;
  }
  // A later mention upgrades a plain member to mentioned.
  existing.mentioned = existing.mentioned || mentioned;
}

async function addChannelMembers(
  ctx: QueryCtx,
  candidates: Map<string, CandidateInfo>,
  channelId: Id<"channels">,
  mentioned: boolean,
): Promise<void> {
  const rows = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  for (const row of rows) {
    addCandidate(candidates, row.userId, channelId, mentioned);
  }
}

async function channelExists(ctx: QueryCtx, channelId: Id<"channels">): Promise<boolean> {
  try {
    return (await ctx.db.get(channelId)) !== null;
  } catch {
    return false;
  }
}

/**
 * Collects candidate recipients for a message, keyed by user id. The value
 * records which channel's preference governs the wake (the message's channel
 * for direct members, the mentioned channel/category's channel otherwise) and
 * whether the user was explicitly mentioned.
 */
async function collectCandidates(
  ctx: QueryCtx,
  message: Doc<"messages">,
): Promise<Map<string, CandidateInfo>> {
  const channelId = message.channelId;
  const candidates = new Map<string, CandidateInfo>();
  const members = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  for (const member of members) {
    addCandidate(
      candidates,
      member.userId,
      channelId,
      message.mentionUserIds.includes(member.userId),
    );
  }

  // `#channel` mentions notify that channel's members too, even when they are
  // not members of the message's own channel.
  for (const mentioned of new Set(message.mentionChannelIds ?? [])) {
    const mentionedChannelId = mentioned as Id<"channels">;
    if (await channelExists(ctx, mentionedChannelId)) {
      await addChannelMembers(ctx, candidates, mentionedChannelId, true);
    }
  }

  // Category mentions notify members of every channel in those categories.
  const categoryIds = new Set(message.mentionCategoryIds ?? []);
  if (categoryIds.size > 0) {
    for (const channel of await ctx.db.query("channels").collect()) {
      if (channel.categoryId !== undefined && categoryIds.has(channel.categoryId)) {
        await addChannelMembers(ctx, candidates, channel._id, true);
      }
    }
  }
  return candidates;
}

/** A user's preference rows, split by scope, for one recipient resolution. */
interface UserPrefs {
  readonly server: Doc<"notificationPrefs"> | undefined;
  readonly channels: ReadonlyMap<string, Doc<"notificationPrefs">>;
}

/**
 * Loads notification preferences for every candidate in a single pass. The
 * preference table only holds rows for users who changed a setting, so one
 * collect grouped by user replaces a separate indexed collect per candidate.
 */
async function loadPrefsByUser(
  ctx: QueryCtx,
  userIds: ReadonlySet<string>,
): Promise<Map<string, UserPrefs>> {
  const prefs = new Map<string, UserPrefs>();
  if (userIds.size === 0) {
    return prefs;
  }
  const rows = await ctx.db.query("notificationPrefs").collect();
  const serverByUser = new Map<string, Doc<"notificationPrefs">>();
  const channelsByUser = new Map<string, Map<string, Doc<"notificationPrefs">>>();
  for (const row of rows) {
    if (!userIds.has(row.userId)) {
      continue;
    }
    if (row.scope === "server") {
      serverByUser.set(row.userId, row);
    } else if (row.channelId !== undefined) {
      const channels = channelsByUser.get(row.userId) ?? new Map();
      channels.set(row.channelId, row);
      channelsByUser.set(row.userId, channels);
    }
  }
  for (const userId of userIds) {
    prefs.set(userId, {
      server: serverByUser.get(userId),
      channels: channelsByUser.get(userId) ?? new Map(),
    });
  }
  return prefs;
}

/** Channel prefs win over server prefs; absent both, the caller applies "all". */
function chosenPref(
  prefs: UserPrefs | undefined,
  channelId: Id<"channels">,
): Doc<"notificationPrefs"> | undefined {
  return prefs?.channels.get(channelId) ?? prefs?.server;
}

async function filterRecipients(
  ctx: QueryCtx,
  candidates: Map<string, CandidateInfo>,
  authorId: string,
  now: number,
): Promise<string[]> {
  // The author is never a recipient.
  const targets = [...candidates.entries()].filter(([userId]) => userId !== authorId);
  const userIds = new Set(targets.map(([userId]) => userId));

  // Presence is read only for candidate users (via `by_user`) instead of
  // collecting the whole `presence` table.
  const presenceByUser = new Map<string, Doc<"presence">>();
  for (const userId of userIds) {
    const presence = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (presence !== null) {
      presenceByUser.set(userId, presence);
    }
  }
  const prefsByUser = await loadPrefsByUser(ctx, userIds);

  const recipients: string[] = [];
  for (const [userId, info] of targets) {
    const chosen = chosenPref(prefsByUser.get(userId), info.channelId);
    const level = chosen?.level ?? "all";
    if (level === "nothing") {
      continue;
    }
    if (chosen?.muteUntil !== undefined && chosen.muteUntil > now) {
      continue;
    }
    if (level === "mentions" && !info.mentioned) {
      continue;
    }
    const presence = presenceByUser.get(userId);
    if (
      presence !== undefined &&
      presence.status !== "offline" &&
      now - presence.lastHeartbeat < ACTIVE_PRESENCE_MS
    ) {
      continue;
    }
    recipients.push(userId);
  }
  return recipients;
}

/**
 * Resolves the users who should be woken for a message: members of the
 * message's channel, plus members of any `#channel` mentioned and of every
 * channel in a mentioned category. Excludes the author, applies per-user
 * preferences (mention-gated when set) and skips anyone currently active.
 */
export async function resolveMessageRecipients(
  ctx: QueryCtx,
  message: Doc<"messages">,
): Promise<string[]> {
  const candidates = await collectCandidates(ctx, message);
  return await filterRecipients(ctx, candidates, message.authorId, Date.now());
}
