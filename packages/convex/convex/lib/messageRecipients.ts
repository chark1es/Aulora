import { Permission } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { PRESENCE_OFFLINE_MS } from "../presence";
import { broadcastAudiencePage } from "./broadcastMentions";
import { categoryChannels } from "./categoryChannels";
import { requireChannelAccessForUser } from "./channels";
import { mapInChunks } from "./concurrency";

export const BROADCAST_CURSOR_PREFIX = "aulora-broadcast-v1:";

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
  massMention?: boolean;
  hereOnly?: boolean;
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
  const mentionedUsers = new Set(message.mentionUserIds);
  for (const member of members) {
    addCandidate(candidates, member.userId, channelId, mentionedUsers.has(member.userId));
  }

  // `#channel` mentions notify that channel's members too, even when they are
  // not members of the message's own channel.
  const mentionedChannels = [...new Set(message.mentionChannelIds ?? [])];
  const existingChannels = await mapInChunks(
    mentionedChannels,
    50,
    async (id) => await channelExists(ctx, id as Id<"channels">),
  );
  // Merge in original order: the first candidate channel governs preferences.
  const ids = mentionedChannels.filter((_, index) => existingChannels[index]);
  const batches = await mapInChunks(ids, 50, async (id) => {
    const rows = new Map<string, CandidateInfo>();
    await addChannelMembers(ctx, rows, id as Id<"channels">, true);
    return rows;
  });
  for (const rows of batches) {
    for (const [id, info] of rows) addCandidate(candidates, id, info.channelId, true);
  }

  // Category mentions notify members of every channel in those categories.
  const categoryIds = new Set(message.mentionCategoryIds ?? []);
  if (categoryIds.size > 0) {
    const channels = (await ctx.db.query("channels").collect()).filter(
      (channel) => channel.categoryId !== undefined && categoryIds.has(channel.categoryId),
    );
    const batches = await mapInChunks(channels, 50, async (channel) => {
      const rows = new Map<string, CandidateInfo>();
      await addChannelMembers(ctx, rows, channel._id, true);
      return rows;
    });
    for (const rows of batches) {
      for (const [id, info] of rows) addCandidate(candidates, id, info.channelId, true);
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
 * Loads notification preferences for the candidates, using the per-user
 * indexes (`by_user_scope`, `by_user_channel`) so a resolution reads only the
 * rows for the people it is about. Nothing here scans the workspace table.
 */
async function loadPrefsByUser(
  ctx: QueryCtx,
  channelByUser: ReadonlyMap<string, Id<"channels">>,
): Promise<Map<string, UserPrefs>> {
  const prefs = new Map<string, UserPrefs>();
  await mapInChunks([...channelByUser], 25, async ([userId, channelId]) => {
    const [server, channel] = await Promise.all([
      ctx.db
        .query("notificationPrefs")
        .withIndex("by_user_scope", (q) => q.eq("userId", userId).eq("scope", "server"))
        .unique(),
      ctx.db
        .query("notificationPrefs")
        .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
        .unique(),
    ]);
    const channels = new Map<string, Doc<"notificationPrefs">>();
    if (channel !== null) {
      channels.set(channelId, channel);
    }
    prefs.set(userId, {
      server: server ?? undefined,
      channels,
    });
  });
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
  await mapInChunks([...userIds], 50, async (userId) => {
    const presence = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (presence !== null) {
      presenceByUser.set(userId, presence);
    }
  });
  const eligible = targets.filter(([userId, info]) => {
    const presence = presenceByUser.get(userId);
    if (
      presence !== undefined &&
      presence.status !== "offline" &&
      now - presence.lastHeartbeat < ACTIVE_PRESENCE_MS
    )
      return false;
    if (info.massMention && presence?.status === "dnd") return false;
    return (
      !info.hereOnly ||
      (presence !== undefined &&
        presence.status !== "offline" &&
        now - presence.lastHeartbeat < PRESENCE_OFFLINE_MS)
    );
  });
  const channelByUser = new Map(
    eligible.map(([userId, info]) => [userId, info.channelId] as const),
  );
  const prefsByUser = await loadPrefsByUser(ctx, channelByUser);

  const recipients: string[] = [];
  for (const [userId, info] of eligible) {
    const chosen = chosenPref(prefsByUser.get(userId), info.channelId);
    const level = chosen?.level ?? "all";
    if (
      info.massMention &&
      (chosen?.suppressMassMentions ?? prefsByUser.get(userId)?.server?.suppressMassMentions) ===
        true
    )
      continue;
    if (level === "nothing") {
      continue;
    }
    if (chosen?.muteUntil !== undefined && chosen.muteUntil > now) {
      continue;
    }
    if (level === "mentions" && !info.mentioned) {
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

/** One bounded mass-mention page; no per-user notification/participation writes. */
export async function resolveBroadcastRecipients(
  ctx: QueryCtx,
  message: Doc<"messages">,
  cursor: string | null,
) {
  const targets = [...new Set(message.mentionChannelIds ?? [])] as Id<"channels">[];
  for (const categoryId of new Set(message.mentionCategoryIds ?? [])) {
    for (const channel of await categoryChannels(ctx, categoryId as Id<"categories">))
      if (!targets.includes(channel._id)) targets.push(channel._id);
  }
  const direct = new Set(message.broadcastDirectUserIds ?? message.mentionUserIds);
  async function belongs(userId: string, channelId: Id<"channels">) {
    return (
      (await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
        .unique()) !== null
    );
  }
  async function sourceVisible(userId: string) {
    try {
      await requireChannelAccessForUser(ctx, userId, message.channelId, Permission.ViewChannel);
      return true;
    } catch (error) {
      if (error instanceof ConvexError) return false;
      throw error;
    }
  }
  let state: { phase: "broadcast" | "extra"; index: number; cursor: string | null } = {
    phase: "broadcast",
    index: 0,
    cursor,
  };
  // Already scheduled pre-upgrade jobs carry the raw Convex audience cursor.
  if (cursor?.startsWith(BROADCAST_CURSOR_PREFIX)) {
    try {
      const parsed = JSON.parse(cursor.slice(BROADCAST_CURSOR_PREFIX.length));
      if (
        (parsed.phase !== "broadcast" && parsed.phase !== "extra") ||
        !Number.isSafeInteger(parsed.index) ||
        parsed.index < 0 ||
        (parsed.cursor !== null && typeof parsed.cursor !== "string")
      )
        throw new Error("invalid");
      state = parsed;
    } catch {
      throw new ConvexError("Invalid broadcast cursor");
    }
  }
  const candidates = new Map<string, CandidateInfo>();
  let next: string | null;
  if (state.phase === "broadcast") {
    const page = await broadcastAudiencePage(ctx, message.channelId, state.cursor);
    await mapInChunks(page.userIds, 25, async (userId) => {
      let ordinary = direct.has(userId);
      let prefChannelId = message.channelId;
      const sourceMember = targets.length === 0 || (await belongs(userId, message.channelId));
      for (const target of targets)
        if (await belongs(userId, target)) {
          ordinary = true;
          if (!sourceMember) prefChannelId = target;
          break;
        }
      candidates.set(userId, {
        channelId: prefChannelId,
        mentioned: true,
        massMention: !ordinary,
        hereOnly: !ordinary && message.mentionHere === true && message.mentionEveryone !== true,
      });
    });
    next =
      page.cursor !== null
        ? BROADCAST_CURSOR_PREFIX + JSON.stringify({ ...state, cursor: page.cursor })
        : targets.length > 0
          ? BROADCAST_CURSOR_PREFIX + JSON.stringify({ phase: "extra", index: 0, cursor: null })
          : null;
  } else {
    const target = targets[state.index];
    if (target === undefined) return { recipients: [], cursor: null };
    const page = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", target))
      .paginate({ numItems: 200, cursor: state.cursor });
    await mapInChunks(page.page, 25, async (row) => {
      // Source viewers are delivered on broadcast pages. Remaining pages are
      // disjoint by first-mentioned-channel membership, including across retries.
      if (await sourceVisible(row.userId)) return;
      for (const earlier of targets.slice(0, state.index))
        if (await belongs(row.userId, earlier)) return;
      candidates.set(row.userId, { channelId: target, mentioned: true });
    });
    next = !page.isDone
      ? BROADCAST_CURSOR_PREFIX + JSON.stringify({ ...state, cursor: page.continueCursor })
      : state.index + 1 < targets.length
        ? BROADCAST_CURSOR_PREFIX +
          JSON.stringify({ phase: "extra", index: state.index + 1, cursor: null })
        : null;
  }
  return {
    recipients: await filterRecipients(ctx, candidates, message.authorId, Date.now()),
    cursor: next,
  };
}
