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

/** A bare URL, ending at whitespace, an angle bracket, a quote or a backtick (\x60). */
const URL_PATTERN = /(?<![^\s([{])https?:\/\/[^\s<>"'\x60]+/gi;
const FENCE_MARKER = /^ {0,3}(\x60{3,}|~{3,})(.*)$/;

interface Fence {
  readonly char: string;
  readonly length: number;
  /** Text after the marker; a closing fence has none. */
  readonly rest: string;
}

function fenceMarker(line: string): Fence | undefined {
  const match = FENCE_MARKER.exec(line);
  if (match === null) return undefined;
  const [, run = "", rest = ""] = match;
  return { char: run.charAt(0), length: run.length, rest };
}

/** Drop quoted lines and fenced code; everything else is kept as prose. */
function stripQuotesAndFences(body: string): string {
  let fence: Fence | undefined;
  return body
    .split(/\r?\n/)
    .map((line) => {
      // Quoted lines cannot open or close a fence in the surrounding prose.
      if (/^\s*>/.test(line)) return "";
      const marker = fenceMarker(line);
      if (fence !== undefined) {
        if (
          marker !== undefined &&
          marker.char === fence.char &&
          marker.length >= fence.length &&
          marker.rest.trim() === ""
        )
          fence = undefined;
        return "";
      }
      if (marker !== undefined) {
        fence = marker;
        return "";
      }
      return line;
    })
    .join("\n");
}

/** Replace inline code spans with a space. Only equal-length backtick runs delimit a span; unmatched runs are prose. */
function stripInlineCode(prose: string): string {
  const runs = [...prose.matchAll(/\x60+/g)];
  let result = "";
  let start = 0;
  // Runs before this index already belong to a stripped span.
  let spanEnd = 0;
  for (const [i, opener] of runs.entries()) {
    if (i < spanEnd) continue;
    const end = runs.findIndex((run, j) => j > i && run[0].length === opener[0].length);
    if (end === -1) continue;
    const closer = runs.at(end);
    if (closer === undefined) continue;
    result += `${prose.slice(start, opener.index)} `;
    start = closer.index + closer[0].length;
    spanEnd = end + 1;
  }
  return result + prose.slice(start);
}

/** Strip quoted lines and fenced/inline code before recognizing broadcast tokens. */
export function broadcastTokenText(body: string): string {
  // URLs render as links, so a token inside one is never a visible mention; blank them
  // in place (same masking as packages/core) so server and client agree.
  return stripInlineCode(stripQuotesAndFences(body)).replace(URL_PATTERN, (url) =>
    " ".repeat(url.length),
  );
}

const BROADCAST_TOKEN = /(?<![\w@.-])@(everyone|here)(?![\w.-])/gi;

export function hasBroadcastToken(body: string, name: "everyone" | "here"): boolean {
  for (const match of broadcastTokenText(body).matchAll(BROADCAST_TOKEN)) {
    const [, token = ""] = match;
    if (token.toLowerCase() === name) return true;
  }
  return false;
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

/** One page of candidate rows: channel members for private/DM channels, workspace members otherwise. */
async function audienceCandidates(
  ctx: QueryCtx,
  channel: Doc<"channels">,
  cursor: string | null,
  numItems: number,
) {
  if (isDmKind(channel.kind) || channel.private === true)
    return await ctx.db
      .query("channelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .paginate({ numItems, cursor });
  return await ctx.db.query("members").withIndex("by_joined").paginate({ numItems, cursor });
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
  const unrestrictedPublic =
    !channel.private &&
    !isDmKind(channel.kind) &&
    channel.overrides.length === 0 &&
    overrides.length === 0;
  if (small && (server?.memberCount ?? 0) > LEGACY_BROADCAST_EXPANSION_LIMIT && unrestrictedPublic)
    return { userIds: [], cursor: null };
  const page = await audienceCandidates(ctx, channel, cursor, numItems);
  // For unrestricted public channels, >100 workspace members already proves
  // compatibility expansion is too large; do not pay per-candidate lookups.
  if (small && unrestrictedPublic && page.page.length > LEGACY_BROADCAST_EXPANSION_LIMIT)
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
