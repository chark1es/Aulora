import { hasPermission, Permission } from "@aulora/core";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isDmKind } from "./channels";
import {
  categoryOverridesById,
  channelPermissions,
  loadPermissionContext,
  overridesForChannel,
} from "./permissions";
import { openContent } from "./sealed";

/** One row of the Threads inbox, with its root body opened server-side. */
export interface ThreadInboxRow {
  /** Root message id. */
  readonly id: Id<"messages">;
  readonly channelId: Id<"channels">;
  readonly authorId: string;
  /** Plaintext root body (`openContent`); never the stored ciphertext. */
  readonly body: string;
  /** Root `_creationTime`. */
  readonly createdAt: number;
  readonly replyCount: number;
  readonly lastReplyAt: number | null;
  /** Recent distinct repliers, from the root's maintained participant list. */
  readonly participantIds: string[];
  /** Users mentioned by the root itself. Reply mentions live on participation rows. */
  readonly mentionedUserIds: string[];
  readonly viewerParticipated: boolean;
  readonly viewerMentioned: boolean;
}

/**
 * The viewer's `threadParticipants` rows examined, newest first. Bounds how many
 * rows the inbox and its mention badge scan; the previous implementation also
 * re-read every returned thread's reply history.
 */
const THREAD_INBOX_CANDIDATE_LIMIT = 500;
/** Maximum threads returned, mentioned first then most recently active. */
export const THREAD_INBOX_MAX_ROWS = 50;
/** Default page of threads when the caller does not pass `limit`. */
export const THREAD_INBOX_DEFAULT_ROWS = 50;

/** Clamps a requested thread page to a bounded, non-empty window. */
export function clampThreadInboxLimit(limit: number | undefined): number {
  const requested = Math.floor(limit ?? THREAD_INBOX_DEFAULT_ROWS);
  if (!Number.isFinite(requested) || requested < 1) {
    return 1;
  }
  return Math.min(requested, THREAD_INBOX_MAX_ROWS);
}

/**
 * Filters `channelIds` down to the ones the viewer may currently view, so a
 * thread in a channel the viewer has since been removed from is dropped rather
 * than leaking its root body. Permission bits, category overrides and DM/private
 * membership are resolved in batched reads (one category query, one
 * `channelMembers.by_user` query) instead of once per channel.
 */
async function viewableChannelIds(
  ctx: QueryCtx,
  userId: string,
  channelIds: readonly Id<"channels">[],
  pointMemberships = false,
): Promise<Set<string>> {
  const unique = [...new Set(channelIds)];
  const viewable = new Set<string>();
  if (unique.length === 0) {
    return viewable;
  }
  const context = await loadPermissionContext(ctx, userId);
  const overridesByCategory = await categoryOverridesById(ctx);
  const memberships = pointMemberships ? new Set<string>() : await memberChannelIds(ctx, userId);
  const channels = await Promise.all(unique.map((channelId) => ctx.db.get(channelId)));
  for (const channel of channels) {
    if (channel === null) {
      continue;
    }
    const permissions = channelPermissions(
      context,
      channel,
      overridesForChannel(overridesByCategory, channel),
    );
    if (!hasPermission(permissions, Permission.ViewChannel)) {
      continue;
    }
    if (isDmKind(channel.kind) || channel.private === true) {
      const member = pointMemberships
        ? await ctx.db
            .query("channelMembers")
            .withIndex("by_channel_user", (q) =>
              q.eq("channelId", channel._id).eq("userId", userId),
            )
            .unique()
        : memberships.has(channel._id);
      if (!member) continue;
    }
    viewable.add(channel._id);
  }
  return viewable;
}

/** The viewer's explicit channel memberships, read once through `by_user`. */
async function memberChannelIds(ctx: QueryCtx, userId: string): Promise<Set<string>> {
  const rows = await ctx.db
    .query("channelMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(THREAD_INBOX_CANDIDATE_LIMIT);
  return new Set(rows.map((row) => row.channelId));
}

/** Builds an inbox row for a root, or `null` when the viewer has no stake in it. */
function threadCandidate(
  root: Doc<"messages">,
  participation: Doc<"threadParticipants">,
): Omit<ThreadInboxRow, "body"> | null {
  // A root with no replies is not a thread; ignore any legacy participation
  // rows created before thread participation was reply-only.
  if ((root.replyCount ?? 0) === 0) {
    return null;
  }
  // The root's maintained counters are authoritative: replies bump
  // `replyCount`, `lastReplyAt` and the capped replier list on send, so the
  // inbox no longer scans each thread's reply history to reconstruct them.
  const viewerMentioned = participation.mentioned;
  const viewerParticipated = participation.participated === true;
  return {
    id: root._id,
    channelId: root.channelId,
    authorId: root.authorId,
    createdAt: root._creationTime,
    replyCount: root.replyCount ?? 0,
    lastReplyAt: root.lastReplyAt ?? null,
    participantIds: [...(root.replyParticipantIds ?? [])],
    mentionedUserIds: root.deletedAt === undefined ? [...root.mentionUserIds] : [],
    viewerParticipated,
    viewerMentioned,
  };
}

/**
 * Powers the "Threads" inbox: the threads the viewer participated in by posting
 * a reply to the root, or was mentioned in (a mention anywhere in the root or
 * any reply counts). Participation is reply-only — authoring the root alone does
 * not add the viewer. Bodies are opened server-side so the client always
 * receives plaintext, never ciphertext.
 *
 * Reads the viewer's `threadParticipants` rows through `by_user`, ordered by
 * activity, and loads deduplicated candidate roots before selecting the page. Reply
 * counts, activity and repliers come from the root's maintained fields instead
 * of a bounded reply scan per thread. `limit` bounds output, not candidate reads;
 * the full inbox should only be subscribed while it is open.
 */
export async function loadThreadInbox(
  ctx: QueryCtx,
  userId: string,
  limit: number = THREAD_INBOX_DEFAULT_ROWS,
  decryptBodies = true,
  mentionsOnly = false,
): Promise<ThreadInboxRow[]> {
  const maxRows = clampThreadInboxLimit(limit);
  const participations = await ctx.db
    .query("threadParticipants")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(THREAD_INBOX_CANDIDATE_LIMIT);

  // Rows are already ordered by activity, and `upsertThreadParticipant` keeps
  // one row per (viewer, thread), so the first row per root is its newest.
  const participationByRoot = new Map<Id<"messages">, Doc<"threadParticipants">>();
  for (const row of participations) {
    if (!participationByRoot.has(row.threadRootId)) {
      participationByRoot.set(row.threadRootId, row);
    }
  }

  // A page can skip threads in channels the viewer lost access to, so examine
  // a bounded window of candidates instead of exactly `limit` roots.
  const window = [...participationByRoot.values()];
  if (window.length === 0) return [];
  const viewable = await viewableChannelIds(
    ctx,
    userId,
    window.map((row) => row.channelId),
  );

  const rootsById = new Map<Id<"messages">, Doc<"messages">>();
  const rows: ThreadInboxRow[] = [];
  for (const participation of window) {
    if (!viewable.has(participation.channelId)) {
      continue;
    }
    const root = await ctx.db.get(participation.threadRootId);
    if (root === null) {
      continue;
    }
    const candidate = threadCandidate(root, participation);
    if (candidate === null) {
      continue;
    }
    rootsById.set(root._id, root);
    rows.push({ ...candidate, body: "" });
  }
  if (rows.length === 0) return [];
  const selected = rows
    .sort(
      (a, b) =>
        Number(b.viewerMentioned) - Number(a.viewerMentioned) ||
        (b.lastReplyAt ?? b.createdAt) - (a.lastReplyAt ?? a.createdAt),
    )
    .slice(0, maxRows);
  if (mentionsOnly) return selected.filter((row) => row.viewerMentioned);
  if (!decryptBodies) return selected;
  return await Promise.all(
    selected.map(async (row) => {
      const root = rootsById.get(row.id);
      return {
        ...row,
        body:
          root === undefined || root.deletedAt !== undefined
            ? ""
            : await openContent(
                { scope: "message", recordId: root.channelId as string },
                root.ciphertext,
              ),
      };
    }),
  );
}

/**
 * Counts the threads the viewer was mentioned in that they can still view. Used
 * for the always-visible Threads badge: participation candidates are bounded, and no message body is opened.
 */
export async function countThreadMentions(ctx: QueryCtx, userId: string): Promise<number> {
  const rows = await ctx.db
    .query("threadParticipants")
    .withIndex("by_user_mentioned", (q) => q.eq("userId", userId).eq("mentioned", true))
    .order("desc")
    .take(THREAD_INBOX_MAX_ROWS);
  if (rows.length === 0) return 0;
  const viewable = await viewableChannelIds(
    ctx,
    userId,
    rows.map((row) => row.channelId),
    true,
  );
  let count = 0;
  for (const row of rows) {
    if (!viewable.has(row.channelId)) continue;
    const root = await ctx.db.get(row.threadRootId);
    if (root !== null && root.channelId === row.channelId && (root.replyCount ?? 0) > 0) count++;
  }
  return count;
}

/** Cursor pages use the mention index first, then the remaining participation rows. */
export async function loadThreadInboxPage(ctx: QueryCtx, userId: string, cursor: string | null) {
  const state: { mentioned: boolean; cursor: string | null } =
    cursor === null ? { mentioned: true, cursor: null } : JSON.parse(cursor);
  const page = await ctx.db
    .query("threadParticipants")
    .withIndex("by_user_mentioned", (q) => q.eq("userId", userId).eq("mentioned", state.mentioned))
    .order("desc")
    .paginate({ numItems: 50, cursor: state.cursor });
  const viewable = await viewableChannelIds(
    ctx,
    userId,
    page.page.map((r) => r.channelId),
    true,
  );
  const rows: ThreadInboxRow[] = [];
  for (const participation of page.page) {
    if (!viewable.has(participation.channelId)) continue;
    const root = await ctx.db.get(participation.threadRootId);
    if (root === null || root.channelId !== participation.channelId) continue;
    const candidate = threadCandidate(root, participation);
    if (candidate === null) continue;
    rows.push({
      ...candidate,
      body:
        root.deletedAt === undefined
          ? await openContent(
              { scope: "message", recordId: root.channelId as string },
              root.ciphertext,
            )
          : "",
    });
  }
  const isDone = page.isDone && !state.mentioned;
  return {
    page: rows,
    isDone,
    continueCursor: isDone
      ? ""
      : JSON.stringify(
          page.isDone
            ? { mentioned: false, cursor: null }
            : { ...state, cursor: page.continueCursor },
        ),
  };
}
