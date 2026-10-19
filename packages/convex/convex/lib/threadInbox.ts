import { hasPermission, Permission } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { findChannelMember, isDmKind } from "./channels";
import { categoryOverridesFor, channelPermissions, loadPermissionContext } from "./permissions";
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
  /** Distinct authors of the replies scanned. */
  readonly participantIds: string[];
  /** Distinct users mentioned by the root or any scanned reply. */
  readonly mentionedUserIds: string[];
  readonly viewerParticipated: boolean;
  readonly viewerMentioned: boolean;
}

/**
 * The viewer's most recent `threadParticipants` rows examined, newest first.
 * Bounds how many thread roots are loaded; the previous implementation scanned
 * a fixed 1000-message global window instead.
 */
const THREAD_INBOX_CANDIDATE_LIMIT = 200;
/**
 * Replies scanned per returned thread when reconstructing reply-derived fields
 * (`participantIds`, `mentionedUserIds`, reply counts). Bounds the per-thread
 * read; the root's maintained `replyCount`/`lastReplyAt` stay authoritative.
 */
const THREAD_INBOX_REPLY_LIMIT = 200;
/** Maximum threads returned, most recently active first. */
const THREAD_INBOX_MAX_ROWS = 50;

/**
 * Filters `channelIds` down to the ones the viewer may currently view, so a
 * thread in a channel the viewer has since been removed from is dropped rather
 * than leaking its root body. Permission bits plus DM/private membership are
 * resolved once per distinct channel.
 */
async function viewableChannelIds(
  ctx: QueryCtx,
  userId: string,
  channelIds: readonly Id<"channels">[],
): Promise<Set<string>> {
  const unique = [...new Set(channelIds)];
  const viewable = new Set<string>();
  if (unique.length === 0) {
    return viewable;
  }
  const context = await loadPermissionContext(ctx, userId);
  for (const channelId of unique) {
    const channel = await ctx.db.get(channelId);
    if (channel === null) {
      continue;
    }
    const categoryOverrides = await categoryOverridesFor(ctx, channel);
    const permissions = channelPermissions(context, channel, categoryOverrides);
    if (!hasPermission(permissions, Permission.ViewChannel)) {
      continue;
    }
    if (
      (isDmKind(channel.kind) || channel.private === true) &&
      !(await findChannelMember(ctx, channelId, userId))
    ) {
      continue;
    }
    viewable.add(channelId);
  }
  return viewable;
}

interface ThreadAccumulator {
  readonly participantIds: Set<string>;
  readonly mentionedUserIds: Set<string>;
  replyCount: number;
  maxReplyAt: number;
}

/** Collects reply authors and mentions for one thread's scanned replies. */
function accumulateReplies(replies: readonly Doc<"messages">[]): ThreadAccumulator {
  const accumulator: ThreadAccumulator = {
    participantIds: new Set<string>(),
    mentionedUserIds: new Set<string>(),
    replyCount: 0,
    maxReplyAt: 0,
  };
  for (const message of replies) {
    accumulator.participantIds.add(message.authorId);
    for (const mentioned of message.mentionUserIds) {
      accumulator.mentionedUserIds.add(mentioned);
    }
    accumulator.replyCount += 1;
    accumulator.maxReplyAt = Math.max(accumulator.maxReplyAt, message._creationTime);
  }
  return accumulator;
}

/** The thread's most recent activity, for ordering the inbox. */
function activityAt(root: Doc<"messages">): number {
  return root.lastReplyAt ?? root._creationTime;
}

/** Builds an inbox row for a root, or `null` when the viewer has no stake in it. */
function threadCandidate(
  rootId: Id<"messages">,
  root: Doc<"messages">,
  accumulator: ThreadAccumulator,
  userId: string,
): Omit<ThreadInboxRow, "body"> | null {
  const participantIds = [...accumulator.participantIds].sort();
  const mentionedUserIds = [
    ...new Set([...(root.mentionUserIds ?? []), ...accumulator.mentionedUserIds]),
  ].sort();
  const viewerParticipated = participantIds.includes(userId);
  const viewerMentioned = mentionedUserIds.includes(userId);
  if (!viewerParticipated && !viewerMentioned) {
    return null;
  }
  return {
    id: rootId,
    channelId: root.channelId,
    authorId: root.authorId,
    createdAt: root._creationTime,
    replyCount: root.replyCount ?? accumulator.replyCount,
    lastReplyAt: root.lastReplyAt ?? accumulator.maxReplyAt,
    participantIds,
    mentionedUserIds,
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
 * Candidate threads come from the viewer's `threadParticipants` rows, so the
 * read scales with the viewer's participation rather than the whole `messages`
 * table. Reply-derived fields are reconstructed only for the threads we return,
 * each bounded by {@link THREAD_INBOX_REPLY_LIMIT}.
 */
export async function loadThreadInbox(ctx: QueryCtx, userId: string): Promise<ThreadInboxRow[]> {
  const participations = await ctx.db
    .query("threadParticipants")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(THREAD_INBOX_CANDIDATE_LIMIT);

  // One participation row per (viewer, thread); keep the newest.
  const rootIds = new Set<Id<"messages">>();
  for (const row of participations) {
    rootIds.add(row.threadRootId);
  }
  const rootEntries = await Promise.all(
    [...rootIds].map(async (rootId) => {
      const root = await ctx.db.get(rootId);
      return root === null ? null : root;
    }),
  );
  const roots = rootEntries.filter((root): root is Doc<"messages"> => root !== null);

  const viewable = await viewableChannelIds(
    ctx,
    userId,
    roots.map((root) => root.channelId),
  );

  // Order by activity before reconstructing reply-derived fields, so replies are
  // scanned only for the threads that can make the response.
  const ordered = roots
    .filter((root) => viewable.has(root.channelId))
    .sort((a, b) => activityAt(b) - activityAt(a))
    .slice(0, THREAD_INBOX_MAX_ROWS);

  const candidates: Omit<ThreadInboxRow, "body">[] = [];
  for (const root of ordered) {
    const replies = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadRootId", root._id))
      .take(THREAD_INBOX_REPLY_LIMIT);
    const candidate = threadCandidate(root._id, root, accumulateReplies(replies), userId);
    if (candidate !== null) {
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => (b.lastReplyAt ?? b.createdAt) - (a.lastReplyAt ?? a.createdAt));

  const top = candidates.slice(0, THREAD_INBOX_MAX_ROWS);
  const rootById = new Map(roots.map((root) => [root._id, root]));
  return await Promise.all(
    top.map(async (row) => {
      const root = rootById.get(row.id);
      if (root === undefined) {
        throw new ConvexError("Thread root not found");
      }
      return {
        ...row,
        body: await openContent(
          { scope: "message", recordId: root.channelId as string },
          root.ciphertext,
        ),
      };
    }),
  );
}
