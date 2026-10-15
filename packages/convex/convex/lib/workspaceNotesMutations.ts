import { NOTE_MAX_REVISIONS, NOTE_MAX_TAGS, type NoteRevisionAction } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { type NoteSnapshotData, noteContent, sealSnapshot } from "./workspaceNotes";

/** Decrypted before/after content of a note, for change classification. */
export async function currentSnapshot(note: Doc<"notePages">): Promise<NoteSnapshotData> {
  const { title, body } = await noteContent(note);
  return {
    title,
    body,
    folderId: note.folderId ?? null,
    tagIds: [...note.tagIds],
  };
}

/** Picks the most specific revision action for a note edit. */
export function revisionAction(
  before: NoteSnapshotData,
  after: NoteSnapshotData,
): NoteRevisionAction {
  const titleChanged = before.title !== after.title;
  const bodyChanged = before.body !== after.body;
  const folderChanged = before.folderId !== after.folderId;
  const tagsChanged = before.tagIds.join("\u0000") !== after.tagIds.join("\u0000");
  const changes = [titleChanged, bodyChanged, folderChanged, tagsChanged].filter(Boolean).length;
  if (changes === 1) {
    if (titleChanged) return "renamed";
    if (folderChanged) return "moved";
    if (tagsChanged) return "tagged";
  }
  return "updated";
}

export async function validateFolder(
  ctx: MutationCtx,
  folderId?: Id<"noteFolders">,
): Promise<void> {
  if (folderId !== undefined && (await ctx.db.get(folderId)) === null)
    throw new ConvexError("Folder not found");
}

export async function validateTags(
  ctx: MutationCtx,
  ids: readonly Id<"noteTags">[],
): Promise<Id<"noteTags">[]> {
  const unique = [...new Set(ids)];
  if (unique.length > NOTE_MAX_TAGS) throw new ConvexError("Too many tags on one note");
  for (const id of unique) {
    if ((await ctx.db.get(id)) === null) throw new ConvexError("Tag not found");
  }
  return unique;
}

/** Appends a sealed revision row and prunes to the newest `NOTE_MAX_REVISIONS`. */
export async function recordRevision(
  ctx: MutationCtx,
  noteId: Id<"notePages">,
  actorId: string,
  action: NoteRevisionAction,
  before?: NoteSnapshotData,
  after?: NoteSnapshotData,
) {
  const revisionId = await ctx.db.insert("noteRevisions", {
    noteId,
    actorId,
    action,
    at: Date.now(),
  });
  const sealedBefore = before === undefined ? undefined : await sealSnapshot(revisionId, before);
  const sealedAfter = after === undefined ? undefined : await sealSnapshot(revisionId, after);
  if (sealedBefore !== undefined || sealedAfter !== undefined) {
    await ctx.db.patch(revisionId, {
      ...(sealedBefore !== undefined ? { beforeCiphertext: sealedBefore } : {}),
      ...(sealedAfter !== undefined ? { afterCiphertext: sealedAfter } : {}),
    });
  }
  const revisions = await ctx.db
    .query("noteRevisions")
    .withIndex("by_note", (q) => q.eq("noteId", noteId))
    .collect();
  if (revisions.length > NOTE_MAX_REVISIONS) {
    const oldestFirst = revisions.sort((a, b) => a.at - b.at);
    for (const stale of oldestFirst.slice(0, revisions.length - NOTE_MAX_REVISIONS)) {
      await ctx.db.delete(stale._id);
    }
  }
}
