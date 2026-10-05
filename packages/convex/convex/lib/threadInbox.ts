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

/** Newest messages scanned when assembling the inbox (no new index). */
const THREAD_INBOX_SCAN_LIMIT = 1000;
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

/** Groups recent replies by their thread root, collecting authors and mentions. */
function accumulateThreads(
  recent: readonly Doc<"messages">[],
): Map<Id<"messages">, ThreadAccumulator> {
  const byRoot = new Map<Id<"messages">, ThreadAccumulator>();
  for (const message of recent) {
    const rootId = message.threadRootId;
    if (rootId === undefined) {
      continue;
    }
    const accumulator =
      byRoot.get(rootId) ??
      ({
        participantIds: new Set<string>(),
        mentionedUserIds: new Set<string>(),
        replyCount: 0,
        maxReplyAt: 0,
      } satisfies ThreadAccumulator);
    accumulator.participantIds.add(message.authorId);
    for (const mentioned of message.mentionUserIds) {
      accumulator.mentionedUserIds.add(mentioned);
    }
    accumulator.replyCount += 1;
    accumulator.maxReplyAt = Math.max(accumulator.maxReplyAt, message._creationTime);
    byRoot.set(rootId, accumulator);
  }
  return byRoot;
}

async function loadRoots(
  ctx: QueryCtx,
  byRoot: Map<Id<"messages">, ThreadAccumulator>,
): Promise<Map<Id<"messages">, Doc<"messages">>> {
  const rootEntries = await Promise.all(
    [...byRoot.keys()].map(async (rootId) => {
      const root = await ctx.db.get(rootId);
      return root === null ? null : { rootId, root };
    }),
  );
  const rootById = new Map<Id<"messages">, Doc<"messages">>();
  for (const entry of rootEntries) {
    if (entry !== null) {
      rootById.set(entry.rootId, entry.root);
    }
  }
  return rootById;
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
 */
export async function loadThreadInbox(ctx: QueryCtx, userId: string): Promise<ThreadInboxRow[]> {
  const recent = await ctx.db.query("messages").order("desc").take(THREAD_INBOX_SCAN_LIMIT);

  const byRoot = accumulateThreads(recent);
  const rootById = await loadRoots(ctx, byRoot);
  const viewable = await viewableChannelIds(
    ctx,
    userId,
    [...rootById.values()].map((root) => root.channelId),
  );

  const candidates: Omit<ThreadInboxRow, "body">[] = [];
  for (const [rootId, root] of rootById) {
    if (!viewable.has(root.channelId)) {
      continue;
    }
    const accumulator = byRoot.get(rootId);
    if (accumulator === undefined) {
      continue;
    }
    const candidate = threadCandidate(rootId, root, accumulator, userId);
    if (candidate !== null) {
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => (b.lastReplyAt ?? b.createdAt) - (a.lastReplyAt ?? a.createdAt));

  const top = candidates.slice(0, THREAD_INBOX_MAX_ROWS);
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
