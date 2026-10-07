import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../packages/convex/convex/_generated/api";

/** Shapes the Notes addon returns, derived from the Convex API. */
export type NotesOverview = FunctionReturnType<typeof api.workspaceNotes.overview>;
export type NoteFolder = NotesOverview["folders"][number];
export type NoteSummary = NotesOverview["notes"][number];
export type NoteTag = NotesOverview["tags"][number];
export type NoteDetail = FunctionReturnType<typeof api.workspaceNotes.get>;
export type NoteRevision = FunctionReturnType<typeof api.workspaceNotes.history>[number];
export type NoteSearchHit = FunctionReturnType<typeof api.workspaceNotes.search>[number];

/** A workspace member, for resolving note authors and editors. */
export interface NoteMember {
  userId: string;
  displayName: string;
}

/** The sentinel folder selection that shows notes without a folder. */
export const UNFILED = "__unfiled__";

/** A folder in depth-first order, carrying its indent depth. */
export interface FlatFolder {
  folder: NoteFolder;
  depth: number;
}

/** Flattens the folder tree depth-first so it can render as an indented list. */
export function flattenFolders(folders: readonly NoteFolder[]): FlatFolder[] {
  const children = new Map<string, NoteFolder[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? "";
    const list = children.get(key) ?? [];
    list.push(folder);
    children.set(key, list);
  }
  const out: FlatFolder[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const folder of [...(children.get(parentId) ?? [])].sort(
      (a, b) => a.position - b.position,
    )) {
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

export function failure(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Could not save. Try again.";
}

/** Shared field styling for the note form controls. */
export const control =
  "w-full rounded-input border border-border bg-surface-3 px-3 py-2 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";

/** A relative "time ago" label, mirroring the Kanban board. */
export function relativeTime(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Absolute date and time for history rows and note metadata. */
export function formatTimestamp(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
