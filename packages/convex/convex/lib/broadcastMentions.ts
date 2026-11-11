import { hasPermission, Permission } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isDmKind, requireChannelAccessForUser } from "./channels";
import { mapInChunks } from "./concurrency";
import { ownerIdsOf } from "./owners";
import { categoryOverridesFor, channelPermissions, loadPermissionContext } from "./permissions";

/** Compatibility only; broadcast delivery and badges never depend on this list. */
export const LEGACY_BROADCAST_EXPANSION_LIMIT = 100;
export const BROADCAST_BATCH_SIZE = 200;
/** Fixed window shared across channels and both honored broadcast markers. */
export const MASS_PING_LIMIT = 3;
export const MASS_PING_WINDOW_MS = 60_000;

/** Strip quoted lines and fenced/inline code before recognizing broadcast tokens. */
export function broadcastTokenText(body: string): string {
  let fence: { char: string; length: number } | undefined;
  const prose = body
    .split(/\r?\n/)
    .map((line) => {
      // Quoted lines cannot open or close a fence in the surrounding prose.
      if (/^\s*>/.test(line)) return "";
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence !== undefined) {
        if (
          marker &&
          marker[1]?.[0] === fence.char &&
          marker[1].length >= fence.length &&
          marker[2]?.trim() === ""
        )
          fence = undefined;
        return "";
      }
      if (marker?.[1]) {
        fence = { char: marker[1][0] ?? "`", length: marker[1].length };
        return "";
      }
      return line;
    })
    .join("\n");
  // Only equal-length backtick runs delimit an inline span; unmatched runs are prose.
  const runs = [...prose.matchAll(/`+/g)];
  let result = "";
  let start = 0;
  for (let i = 0; i < runs.length; i++) {
    const opener = runs[i];
    if (!opener) continue;
    const end = runs.findIndex((run, j) => j > i && run[0].length === opener[0].length);
    const closer = runs[end];
    if (!closer) continue;
    result += `${prose.slice(start, opener.index)} `;
    start = closer.index + closer[0].length;
    i = end;
  }
  // URLs render as links, so a token inside one is never a visible mention; blank them
  // in place (same masking as packages/core) so server and client agree.
  return (result + prose.slice(start)).replace(/(?<![^\s([{])https?:\/\/[^\s<>"'`]+/gi, (url) =>
    " ".repeat(url.length),
  );
}

/** Token boundaries remain /(?<![\\w@.-])@(everyone|here)(?![\\w.-])/i. */
export function hasBroadcastToken(body: string, name: "everyone" | "here"): boolean {
  const text = broadcastTokenText(body);
  return new RegExp(`(?<![\\w@.-])@${name}(?![\\w.-])`, "i").test(text);
}

export function mentionsViewer(
  message: Pick<
    Doc<"messages">,
    "authorId" | "mentionUserIds" | "mentionEveryone" | "mentionHere" | "_creationTime"
  >,
  userId: string,
  joinedAt = 0,
): boolean {
  if (message.authorId === userId) return false;
  if (message.mentionEveryone === true || message.mentionHere === true)
    return message._creationTime >= joinedAt;
  return message.mentionUserIds.includes(userId);
}

/** A bounded page, rechecking current access and bans at delivery time. */
export async function broadcastAudiencePage(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  cursor: string | null,
  small = false,
) {
  const channel = await ctx.db.get(channelId);
  if (channel === null || channel.archived) return { userIds: [], cursor: null };
  const server = await ctx.db.query("server").first();
  const owners = new Set(ownerIdsOf(server));
  const owner = owners.values().next().value;
  if (owner === undefined) return { userIds: [], cursor: null };
  const context = await loadPermissionContext(ctx, owner);
  const overrides = await categoryOverridesFor(ctx, channel);
  const numItems = Math.min(
    small ? LEGACY_BROADCAST_EXPANSION_LIMIT + 1 : BROADCAST_BATCH_SIZE,
    BROADCAST_BATCH_SIZE,
  );
  if (
    small &&
    (server?.memberCount ?? 0) > LEGACY_BROADCAST_EXPANSION_LIMIT &&
    !channel.private &&
    !isDmKind(channel.kind) &&
    channel.overrides.length === 0 &&
    overrides.length === 0
  )
    return { userIds: [], cursor: null };
  const page =
    isDmKind(channel.kind) || channel.private === true
      ? await ctx.db
          .query("channelMembers")
          .withIndex("by_channel", (q) => q.eq("channelId", channelId))
          .paginate({ numItems, cursor })
      : await ctx.db.query("members").withIndex("by_joined").paginate({ numItems, cursor });
  // For unrestricted public channels, >100 workspace members already proves
  // compatibility expansion is too large; do not pay per-candidate lookups.
  if (
    small &&
    !channel.private &&
    !isDmKind(channel.kind) &&
    channel.overrides.length === 0 &&
    overrides.length === 0 &&
    page.page.length > LEGACY_BROADCAST_EXPANSION_LIMIT
  )
    return { userIds: [], cursor: null };
  const rows = new Map(page.page.map((row) => [row.userId, row]));
  // Owners need not have a workspace member row. Include them only once;
  // private/DM audiences still come exclusively from channel membership.
  const ids = [...rows.keys()];
  if (cursor === null && !channel.private && !isDmKind(channel.kind))
    for (const id of owners) if (!ids.includes(id)) ids.push(id);
  const visible = await mapInChunks(ids, 25, async (userId) => {
    if (cursor !== null && owners.has(userId) && !channel.private && !isDmKind(channel.kind))
      return null;
    const ban = await ctx.db
      .query("bans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (ban !== null && (ban.expiresAt === undefined || ban.expiresAt > Date.now())) return null;
    try {
      const cached = rows.get(userId);
      const member =
        cached !== undefined && "roleIds" in cached
          ? cached
          : await ctx.db
              .query("members")
              .withIndex("by_user", (q) => q.eq("userId", userId))
              .unique();
      if (member === null && !owners.has(userId)) return null;
      if (userId.startsWith("bot_")) {
        await requireChannelAccessForUser(ctx, userId, channelId, Permission.ViewChannel);
        return userId;
      }
      const permissions = channelPermissions(
        { ...context, userId, isOwner: owners.has(userId), roleIds: member?.roleIds ?? [] },
        channel,
        overrides,
      );
      return hasPermission(permissions, Permission.ViewChannel) ? userId : null;
    } catch (error) {
      if (error instanceof ConvexError) return null;
      throw error;
    }
  });
  return {
    userIds: visible.filter((id): id is string => id !== null),
    cursor: page.isDone ? null : page.continueCursor,
  };
}

/** Badge eligibility starts at workspace join and, for private channels, channel join. */
export async function broadcastJoinedAt(
  ctx: QueryCtx,
  userId: string,
  channelId: Id<"channels">,
): Promise<number> {
  const member = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const channel = await ctx.db.get(channelId);
  if (channel?.private || (channel && isDmKind(channel.kind))) {
    const membership = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();
    return Math.max(
      member?.joinedAt ?? 0,
      membership?.joinedAt ?? 0,
      membership?._creationTime ?? 0,
    );
  }
  return member?.joinedAt ?? 0;
}
