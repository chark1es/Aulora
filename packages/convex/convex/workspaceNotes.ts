import {
  NOTE_BODY_MAX,
  NOTE_FOLDER_NAME_MAX,
  NOTE_MAX_FOLDERS,
  NOTE_MAX_NOTES,
  NOTE_MAX_REVISIONS,
  NOTE_MAX_TAGS,
  NOTE_TAG_NAME_MAX,
  NOTE_TITLE_MAX,
  type NoteRevisionAction,
  Permission,
} from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { assertMayParticipate } from "./lib/bans";
import { requireWorkspacePermission } from "./lib/permissions";
import { sealString } from "./lib/sse";
import {
  folderContent,
  type NoteSnapshotData,
  noteContent,
  noteSearchDocuments,
  requireNotes,
  revisionSnapshot,
  searchNotes,
  tagContent,
  text,
} from "./lib/workspaceNotes";
import {
  currentSnapshot,
  recordRevision,
  revisionAction,
  validateFolder,
  validateTags,
} from "./lib/workspaceNotesMutations";

/** The optional workspace Notes addon (`api.workspaceNotes.*`). */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Enables or disables the Notes addon. Requires `ManageWorkspace`. */
export const setEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.ManageWorkspace);
    await assertMayParticipate(ctx, userId);
    const server = await ctx.db.query("server").first();
    if (!server) throw new ConvexError("Workspace not initialized");
    await ctx.db.patch(server._id, {
      settings: { ...server.settings, notesEnabled: enabled },
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "workspaceNotes.setEnabled",
      targetId: server._id,
      meta: JSON.stringify({ enabled }),
    });
  },
});

/** Folders, notes (including archived) and tags, newest notes first. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireNotes(ctx);
    const [folderDocs, noteDocs, tagDocs] = await Promise.all([
      ctx.db.query("noteFolders").take(NOTE_MAX_FOLDERS),
      ctx.db.query("notePages").withIndex("by_updated").order("desc").take(NOTE_MAX_NOTES),
      ctx.db.query("noteTags").take(NOTE_MAX_TAGS),
    ]);
    const folders = await Promise.all(
      folderDocs
        .sort((a, b) => a.position - b.position)
        .map(async (folder) => ({
          id: folder._id,
          name: await folderContent(folder),
          parentId: folder.parentId ?? null,
          position: folder.position,
        })),
    );
    const notes = await Promise.all(
      noteDocs.map(async (note) => {
        const { title } = await noteContent(note);
        return {
          id: note._id,
          folderId: note.folderId ?? null,
          title,
          tagIds: note.tagIds,
          creatorId: note.creatorId,
          lastEditorId: note.lastEditorId,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          revision: note.revision,
          archived: note.archived,
        };
      }),
    );
    const tags = await Promise.all(
      tagDocs.map(async (tag) => ({
        id: tag._id,
        name: await tagContent(tag),
        color: tag.color,
      })),
    );
    return { folders, notes, tags };
  },
});

/** One note's decrypted title and body. */
export const get = query({
  args: { noteId: v.id("notePages") },
  handler: async (ctx, args) => {
    await requireNotes(ctx);
    const note = await ctx.db.get(args.noteId);
    if (!note) throw new ConvexError("Note not found");
    const { title, body } = await noteContent(note);
    return {
      id: note._id,
      folderId: note.folderId ?? null,
      title,
      body,
      tagIds: note.tagIds,
      creatorId: note.creatorId,
      lastEditorId: note.lastEditorId,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      revision: note.revision,
      archived: note.archived,
    };
  },
});

/** Sealed revision snapshots for one note, newest first. */
export const history = query({
  args: { noteId: v.id("notePages"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireNotes(ctx);
    const note = await ctx.db.get(args.noteId);
    if (!note) throw new ConvexError("Note not found");
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), NOTE_MAX_REVISIONS);
    const rows = await ctx.db
      .query("noteRevisions")
      .withIndex("by_note", (q) => q.eq("noteId", args.noteId))
      .order("desc")
      .take(limit);
    return Promise.all(
      rows.map(async (row) => ({
        id: row._id,
        noteId: row.noteId,
        actorId: row.actorId,
        action: row.action as NoteRevisionAction,
        before: await revisionSnapshot(row._id, row.beforeCiphertext),
        after: await revisionSnapshot(row._id, row.afterCiphertext),
        at: row.at,
      })),
    );
  },
});

/** Permission-filtered, server-side search over decrypted titles and bodies. */
export const search = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireNotes(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 30), 1), NOTE_MAX_NOTES);
    const notes = await ctx.db
      .query("notePages")
      .withIndex("by_updated")
      .order("desc")
      .take(NOTE_MAX_NOTES);
    const documents = await Promise.all(
      notes.map(async (note) => {
        const { title, body } = await noteContent(note);
        return { id: note._id, title, body, updatedAt: note.updatedAt };
      }),
    );
    return searchNotes(noteSearchDocuments(documents), args.query, limit);
  },
});

export const createFolder = mutation({
  args: { name: v.string(), parentId: v.optional(v.id("noteFolders")) },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.CreateNotes);
    await assertMayParticipate(ctx, userId);
    text(args.name, "Folder name", NOTE_FOLDER_NAME_MAX);
    if (args.parentId !== undefined && (await ctx.db.get(args.parentId)) === null)
      throw new ConvexError("Folder not found");
    const folders = await ctx.db.query("noteFolders").take(NOTE_MAX_FOLDERS);
    if (folders.length >= NOTE_MAX_FOLDERS)
      throw new ConvexError(`This workspace has reached its ${NOTE_MAX_FOLDERS}-folder limit`);
    const position =
      Math.max(-1, ...folders.filter((f) => f.parentId === args.parentId).map((f) => f.position)) +
      1;
    const now = Date.now();
    const id = await ctx.db.insert("noteFolders", {
      nameCiphertext: "",
      ...(args.parentId !== undefined ? { parentId: args.parentId } : {}),
      position,
      creatorId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(id, {
      nameCiphertext: await sealString(
        { scope: "workspaceNote.folder", recordId: id },
        args.name.trim(),
      ),
    });
    return id;
  },
});

export const renameFolder = mutation({
  args: { folderId: v.id("noteFolders"), name: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.EditNotes);
    await assertMayParticipate(ctx, userId);
    text(args.name, "Folder name", NOTE_FOLDER_NAME_MAX);
    const folder = await ctx.db.get(args.folderId);
    if (!folder) throw new ConvexError("Folder not found");
    await ctx.db.patch(folder._id, {
      nameCiphertext: await sealString(
        { scope: "workspaceNote.folder", recordId: folder._id },
        args.name.trim(),
      ),
      updatedAt: Date.now(),
    });
  },
});

export const moveFolder = mutation({
  args: { folderId: v.id("noteFolders"), parentId: v.optional(v.id("noteFolders")) },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.EditNotes);
    await assertMayParticipate(ctx, userId);
    const folder = await ctx.db.get(args.folderId);
    if (!folder) throw new ConvexError("Folder not found");
    if (args.parentId !== undefined) {
      if (args.parentId === folder._id) throw new ConvexError("A folder cannot contain itself");
      const parent = await ctx.db.get(args.parentId);
      if (!parent) throw new ConvexError("Folder not found");
      let ancestor = parent.parentId;
      while (ancestor !== undefined) {
        if (ancestor === folder._id)
          throw new ConvexError("A folder cannot be moved inside itself");
        ancestor = (await ctx.db.get(ancestor))?.parentId;
      }
    }
    const folders = await ctx.db.query("noteFolders").take(NOTE_MAX_FOLDERS);
    const position =
      Math.max(
        -1,
        ...folders
          .filter((f) => f._id !== folder._id && f.parentId === args.parentId)
          .map((f) => f.position),
      ) + 1;
    await ctx.db.patch(folder._id, {
      ...(args.parentId !== undefined ? { parentId: args.parentId } : { parentId: undefined }),
      position,
      updatedAt: Date.now(),
    });
  },
});

export const deleteFolder = mutation({
  args: { folderId: v.id("noteFolders") },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.DeleteNotes);
    await assertMayParticipate(ctx, userId);
    const folder = await ctx.db.get(args.folderId);
    if (!folder) throw new ConvexError("Folder not found");
    const children = await ctx.db
      .query("noteFolders")
      .withIndex("by_parent", (q) => q.eq("parentId", folder._id))
      .take(1);
    if (children.length > 0) throw new ConvexError("Move or delete the child folders first");
    const notes = await ctx.db
      .query("notePages")
      .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
      .take(1);
    if (notes.length > 0) throw new ConvexError("Move or delete the notes in this folder first");
    await ctx.db.delete(folder._id);
    await writeAudit(ctx, {
      actorId: userId,
      action: "workspaceNotes.deleteFolder",
      targetId: folder._id,
    });
  },
});

export const createNote = mutation({
  args: {
    folderId: v.optional(v.id("noteFolders")),
    title: v.string(),
    body: v.string(),
    tagIds: v.optional(v.array(v.id("noteTags"))),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.CreateNotes);
    await assertMayParticipate(ctx, userId);
    text(args.title, "Title", NOTE_TITLE_MAX);
    text(args.body, "Body", NOTE_BODY_MAX, false);
    await validateFolder(ctx, args.folderId);
    const tagIds = await validateTags(ctx, args.tagIds ?? []);
    if ((await ctx.db.query("notePages").take(NOTE_MAX_NOTES)).length >= NOTE_MAX_NOTES)
      throw new ConvexError(`This workspace has reached its ${NOTE_MAX_NOTES}-note limit`);
    const now = Date.now();
    const id = await ctx.db.insert("notePages", {
      ...(args.folderId !== undefined ? { folderId: args.folderId } : {}),
      titleCiphertext: "",
      bodyCiphertext: "",
      tagIds,
      creatorId: userId,
      lastEditorId: userId,
      archived: false,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    });
    await ctx.db.patch(id, {
      titleCiphertext: await sealString(
        { scope: "workspaceNote.page", recordId: id },
        args.title.trim(),
      ),
      bodyCiphertext: await sealString({ scope: "workspaceNote.page", recordId: id }, args.body),
    });
    await recordRevision(ctx, id, userId, "created", undefined, {
      title: args.title.trim(),
      body: args.body,
      folderId: args.folderId ?? null,
      tagIds,
    });
    return id;
  },
});

export const updateNote = mutation({
  args: {
    noteId: v.id("notePages"),
    revision: v.number(),
    title: v.string(),
    body: v.string(),
    folderId: v.optional(v.id("noteFolders")),
    tagIds: v.array(v.id("noteTags")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.EditNotes);
    await assertMayParticipate(ctx, userId);
    const note = await ctx.db.get(args.noteId);
    if (!note) throw new ConvexError("Note not found");
    if (note.revision !== args.revision)
      throw new ConvexError("The note changed. Reload it and try again");
    text(args.title, "Title", NOTE_TITLE_MAX);
    text(args.body, "Body", NOTE_BODY_MAX, false);
    await validateFolder(ctx, args.folderId);
    const tagIds = await validateTags(ctx, args.tagIds);
    const before = await currentSnapshot(note);
    const after: NoteSnapshotData = {
      title: args.title.trim(),
      body: args.body,
      folderId: args.folderId ?? null,
      tagIds,
    };
    const revision = note.revision + 1;
    await ctx.db.patch(note._id, {
      titleCiphertext: await sealString(
        { scope: "workspaceNote.page", recordId: note._id },
        after.title,
      ),
      bodyCiphertext: await sealString(
        { scope: "workspaceNote.page", recordId: note._id },
        after.body,
      ),
      folderId: args.folderId,
      tagIds,
      lastEditorId: userId,
      updatedAt: Date.now(),
      revision,
    });
    await recordRevision(ctx, note._id, userId, revisionAction(before, after), before, after);
    return revision;
  },
});

export const archiveNote = mutation({
  args: { noteId: v.id("notePages"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.EditNotes);
    await assertMayParticipate(ctx, userId);
    const note = await ctx.db.get(args.noteId);
    if (!note) throw new ConvexError("Note not found");
    if (note.archived === args.archived) return;
    const snapshot = await currentSnapshot(note);
    await ctx.db.patch(note._id, {
      archived: args.archived,
      lastEditorId: userId,
      updatedAt: Date.now(),
      revision: note.revision + 1,
    });
    await recordRevision(
      ctx,
      note._id,
      userId,
      args.archived ? "archived" : "restored",
      snapshot,
      snapshot,
    );
  },
});

export const deleteNote = mutation({
  args: { noteId: v.id("notePages") },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.DeleteNotes);
    await assertMayParticipate(ctx, userId);
    const note = await ctx.db.get(args.noteId);
    if (!note) throw new ConvexError("Note not found");
    await ctx.db.delete(note._id);
    await ctx.scheduler.runAfter(0, internal.workspaceNotesCleanup.cleanupNote, {
      noteId: note._id,
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "workspaceNotes.deleteNote",
      targetId: note._id,
    });
  },
});

export const createTag = mutation({
  args: { name: v.string(), color: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.EditNotes);
    await assertMayParticipate(ctx, userId);
    text(args.name, "Tag name", NOTE_TAG_NAME_MAX);
    if (!HEX_COLOR.test(args.color)) throw new ConvexError("Tag colors must be hex colors");
    if ((await ctx.db.query("noteTags").take(NOTE_MAX_TAGS)).length >= NOTE_MAX_TAGS)
      throw new ConvexError(`This workspace has reached its ${NOTE_MAX_TAGS}-tag limit`);
    const id = await ctx.db.insert("noteTags", {
      nameCiphertext: "",
      color: args.color.toLowerCase(),
      creatorId: userId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(id, {
      nameCiphertext: await sealString(
        { scope: "workspaceNote.tag", recordId: id },
        args.name.trim(),
      ),
    });
    return id;
  },
});

export const updateTag = mutation({
  args: { tagId: v.id("noteTags"), name: v.string(), color: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.EditNotes);
    await assertMayParticipate(ctx, userId);
    text(args.name, "Tag name", NOTE_TAG_NAME_MAX);
    if (!HEX_COLOR.test(args.color)) throw new ConvexError("Tag colors must be hex colors");
    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new ConvexError("Tag not found");
    await ctx.db.patch(tag._id, {
      nameCiphertext: await sealString(
        { scope: "workspaceNote.tag", recordId: tag._id },
        args.name.trim(),
      ),
      color: args.color.toLowerCase(),
    });
  },
});

export const deleteTag = mutation({
  args: { tagId: v.id("noteTags") },
  handler: async (ctx, args) => {
    const { userId } = await requireNotes(ctx, Permission.DeleteNotes);
    await assertMayParticipate(ctx, userId);
    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new ConvexError("Tag not found");
    const notes = await ctx.db.query("notePages").take(NOTE_MAX_NOTES);
    for (const note of notes) {
      if (note.tagIds.includes(tag._id)) {
        await ctx.db.patch(note._id, {
          tagIds: note.tagIds.filter((id) => id !== tag._id),
        });
      }
    }
    await ctx.db.delete(tag._id);
    await writeAudit(ctx, {
      actorId: userId,
      action: "workspaceNotes.deleteTag",
      targetId: tag._id,
    });
  },
});
