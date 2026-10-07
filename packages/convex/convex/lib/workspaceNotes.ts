import {
  hasPermission,
  type NoteSearchHit,
  type NoteSnapshot,
  Permission,
  tokenize,
} from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuth } from "./auth";
import { listActiveBans } from "./bans";
import { loadPermissionContext, workspacePermissions } from "./permissions";
import { openContent } from "./sealed";
import { sealString } from "./sse";

/** Shared gates, content openers and search for the optional Notes addon. */

type ReadCtx = QueryCtx | MutationCtx;

/**
 * The single read/write gate for the Notes addon: the addon must be enabled,
 * the caller must not be banned and they must hold `ViewNotes` plus `flag`.
 * Mirrors {@link requireKanbanUser}.
 */
export async function requireNotesUser(ctx: ReadCtx, userId: string, flag = Permission.ViewNotes) {
  const server = await ctx.db.query("server").first();
  if (server?.settings.notesEnabled !== true) throw new ConvexError("Notes is disabled");
  if ((await listActiveBans(ctx, userId)).length > 0)
    throw new ConvexError("You are banned from this workspace");
  const context = await loadPermissionContext(ctx, userId);
  const permissions = workspacePermissions(context);
  if (!hasPermission(permissions, Permission.ViewNotes) || !hasPermission(permissions, flag)) {
    throw new ConvexError("Missing Notes permission");
  }
  return { userId, permissions };
}

/** {@link requireNotesUser} for the current session identity. */
export async function requireNotes(ctx: ReadCtx, flag = Permission.ViewNotes) {
  const { userId } = await requireAuth(ctx);
  return requireNotesUser(ctx, userId, flag);
}

/** Opens a folder's sealed name. */
export async function folderContent(folder: {
  _id: Id<"noteFolders">;
  nameCiphertext: string;
}): Promise<string> {
  return await openContent(
    { scope: "workspaceNote.folder", recordId: folder._id },
    folder.nameCiphertext,
  );
}

/** Opens a note's sealed title and body. */
export async function noteContent(note: {
  _id: Id<"notePages">;
  titleCiphertext: string;
  bodyCiphertext: string;
}): Promise<{ title: string; body: string }> {
  const context = { scope: "workspaceNote.page", recordId: note._id };
  return {
    title: await openContent(context, note.titleCiphertext),
    body: await openContent(context, note.bodyCiphertext),
  };
}

/** Opens a tag's sealed name. */
export async function tagContent(tag: {
  _id: Id<"noteTags">;
  nameCiphertext: string;
}): Promise<string> {
  return await openContent({ scope: "workspaceNote.tag", recordId: tag._id }, tag.nameCiphertext);
}

/** Opens one side of a sealed revision snapshot. `undefined` means "no side". */
export async function revisionSnapshot(
  revisionId: string,
  sealed: string | undefined,
): Promise<NoteSnapshot | null> {
  if (sealed === undefined) return null;
  const parsed: unknown = JSON.parse(
    await openContent({ scope: "workspaceNote.revision", recordId: revisionId }, sealed),
  );
  return parsed as NoteSnapshot;
}

/** Server-side note snapshot persisted (sealed) on each revision. */
export type NoteSnapshotData = NoteSnapshot;

/** Seals a snapshot JSON string under one revision row's context. */
export async function sealSnapshot(
  revisionId: string,
  snapshot: NoteSnapshotData,
): Promise<string> {
  return await sealString(
    { scope: "workspaceNote.revision", recordId: revisionId },
    JSON.stringify(snapshot),
  );
}

/** Length validator shared by folders, tags and notes. */
export function text(value: string, name: string, max: number, required = true) {
  if ((required && !value.trim()) || value.length > max)
    throw new ConvexError(`${name} must be ${required ? "1" : "0"}–${max} characters`);
}

/** One decrypted note prepared for server-side search. */
export interface NoteSearchDocument {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly updatedAt: number;
}

/** Builds searchable documents from decrypted note content. */
export function noteSearchDocuments(notes: readonly NoteSearchDocument[]): NoteSearchDocument[] {
  return notes.map((note) => ({
    id: note.id,
    title: note.title,
    body: note.body,
    updatedAt: note.updatedAt,
  }));
}

const SNIPPET_RADIUS = 60;

/** Tokenizes a query and ranks decrypted notes by exact then prefix matches. */
export function searchNotes(
  documents: readonly NoteSearchDocument[],
  query: string,
  limit = 30,
  minPrefixLength = 2,
): NoteSearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0 || limit <= 0) return [];
  const byId = new Map(documents.map((document) => [document.id, document]));
  const titleTokens = new Map<string, Set<string>>();
  const postings = new Map<string, Set<string>>();
  for (const document of documents) {
    const title = new Set(tokenize(document.title));
    titleTokens.set(document.id, title);
    const tokens = new Set([...title, ...tokenize(document.body)]);
    for (const token of tokens) {
      const posting = postings.get(token) ?? new Set<string>();
      posting.add(document.id);
      postings.set(token, posting);
    }
  }
  const scores = new Map<string, number>();
  for (const term of terms) {
    const exact = postings.get(term);
    if (exact !== undefined) {
      for (const id of exact) scores.set(id, (scores.get(id) ?? 0) + 3);
    }
    if (term.length >= minPrefixLength) {
      for (const [token, posting] of postings) {
        if (token === term || !token.startsWith(term)) continue;
        for (const id of posting) scores.set(id, Math.max(scores.get(id) ?? 0, 1) + 1);
      }
    }
  }
  const results: NoteSearchHit[] = [];
  for (const [id, score] of scores) {
    const document = byId.get(id);
    if (document === undefined) continue;
    const titleMatch = [...(titleTokens.get(id) ?? [])].some((token) =>
      terms.some(
        (term) => token === term || (term.length >= minPrefixLength && token.startsWith(term)),
      ),
    );
    results.push({
      id,
      title: document.title,
      snippet: snippet(document, terms),
      score: titleMatch ? score + 5 : score,
      updatedAt: document.updatedAt,
    });
  }
  results.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
  return results.slice(0, limit);
}

function snippet(document: NoteSearchDocument, terms: readonly string[]): string {
  const source = document.body.trim().length > 0 ? document.body : document.title;
  const lower = source.normalize("NFKC").toLowerCase();
  let position = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (position === -1 || found < position)) position = found;
  }
  if (position === -1) {
    const trimmed = source.slice(0, SNIPPET_RADIUS * 2).trim();
    return source.length > SNIPPET_RADIUS * 2 ? `${trimmed}…` : trimmed;
  }
  const start = Math.max(0, position - SNIPPET_RADIUS);
  const end = Math.min(source.length, position + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  return `${prefix}${source.slice(start, end).trim()}${suffix}`;
}
