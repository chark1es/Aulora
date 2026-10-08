import {
  type DiffStats,
  hasPermission,
  type NoteFolder,
  type NoteRevisionAction,
  type NoteSummary,
  type NoteTag,
  noteBlocksToPlainText,
  Permission,
  parseNoteMarkdown,
} from "@aulora/core";

/**
 * Pure view helpers for the mobile Notes addon, mirroring the web client's
 * behaviour without importing it. Nothing here talks to the server.
 */

export interface NoteMember {
  readonly userId: string;
  readonly displayName: string;
}

export type NoteOrder = "updated" | "created" | "title";

/** How the note list is narrowed. `folderId` undefined means any folder. */
export interface NoteFilters {
  readonly query: string;
  /** `null` selects unfiled notes; a folder id selects that folder. */
  readonly folderId: string | null | undefined;
  /** Notes carrying any one of these tags. */
  readonly tagIds: readonly string[];
  /** Whether the archived view is showing instead of the active one. */
  readonly archived: boolean;
}

export const NO_NOTE_FILTERS: NoteFilters = {
  query: "",
  folderId: undefined,
  tagIds: [],
  archived: false,
};

/** How many filters are set, for the badge on the filter button. */
export function filterCount(filters: NoteFilters): number {
  return (
    (filters.query.trim() ? 1 : 0) +
    (filters.folderId === undefined ? 0 : 1) +
    filters.tagIds.length +
    (filters.archived ? 1 : 0)
  );
}

/** Choices inside one filter widen the result; separate filters narrow it. */
export function filterNotes<T extends NoteSummary>(notes: readonly T[], filters: NoteFilters): T[] {
  const query = filters.query.trim().toLowerCase();
  return notes.filter(
    (note) =>
      note.archived === filters.archived &&
      (filters.folderId === undefined || note.folderId === filters.folderId) &&
      (!filters.tagIds.length || note.tagIds.some((id) => filters.tagIds.includes(id))) &&
      (query.length === 0 || note.title.toLowerCase().includes(query)),
  );
}

/** Newest first, oldest first, or A–Z by title. */
export function sortNotes<T extends NoteSummary>(notes: readonly T[], order: NoteOrder): T[] {
  return [...notes].sort((a, b) => {
    if (order === "title") return a.title.localeCompare(b.title) || b.updatedAt - a.updatedAt;
    const delta = order === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt;
    return delta || a.title.localeCompare(b.title);
  });
}

/** Filter, then sort, in one step. */
export function selectNotes<T extends NoteSummary>(
  notes: readonly T[],
  filters: NoteFilters,
  order: NoteOrder,
): T[] {
  return sortNotes(filterNotes(notes, filters), order);
}

export interface FolderNode {
  readonly folder: NoteFolder;
  readonly depth: number;
  readonly children: readonly FolderNode[];
}

function sortSiblings(folders: readonly NoteFolder[]): NoteFolder[] {
  return [...folders].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** The folder hierarchy as nested roots, orphaned parents treated as roots. */
export function buildFolderTree(folders: readonly NoteFolder[]): FolderNode[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const byParent = new Map<string | null, NoteFolder[]>();
  for (const folder of folders) {
    const parent = folder.parentId !== null && ids.has(folder.parentId) ? folder.parentId : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(folder);
    byParent.set(parent, siblings);
  }
  const build = (parentId: string | null, depth: number, seen: ReadonlySet<string>): FolderNode[] =>
    sortSiblings(byParent.get(parentId) ?? []).flatMap((folder) => {
      if (seen.has(folder.id)) return [];
      const next = new Set(seen);
      next.add(folder.id);
      return [{ folder, depth, children: build(folder.id, depth + 1, next) }];
    });
  return build(null, 0, new Set());
}

export interface FlatFolder {
  readonly folder: NoteFolder;
  readonly depth: number;
}

/** A tree flattened into display order, each folder carrying its indent depth. */
export function flattenFolderTree(nodes: readonly FolderNode[]): FlatFolder[] {
  return nodes.flatMap((node) => [
    { folder: node.folder, depth: node.depth },
    ...flattenFolderTree(node.children),
  ]);
}

/** Every folder in display order, ready for a folder rail or a picker. */
export function flattenFolders(folders: readonly NoteFolder[]): FlatFolder[] {
  return flattenFolderTree(buildFolderTree(folders));
}

/** A folder's direct children in display order. */
export function folderChildren(
  folders: readonly NoteFolder[],
  parentId: string | null,
): NoteFolder[] {
  return sortSiblings(folders.filter((folder) => folder.parentId === parentId));
}

/** The "Parent / Child" breadcrumb for a folder. */
export function folderPath(folders: readonly NoteFolder[], folderId: string): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  let current = byId.get(folderId);
  let guard = 0;
  while (current !== undefined && guard <= folders.length) {
    names.unshift(current.name);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
    guard += 1;
  }
  return names.join(" / ");
}

/** A folder's name, or "Unfiled" for notes with no folder. */
export function folderName(folders: readonly NoteFolder[], folderId: string | null): string {
  if (folderId === null) return "Unfiled";
  return folders.find((folder) => folder.id === folderId)?.name ?? "Unfiled";
}

export interface NoteGroup<T extends NoteSummary = NoteSummary> {
  readonly key: string;
  readonly label: string;
  readonly notes: T[];
}

const DAY_MS = 86400000;

function localStartOfDay(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Recency buckets for a list already sorted newest first. Empty groups drop out. */
export function groupNotes<T extends NoteSummary>(
  notes: readonly T[],
  now: number,
): NoteGroup<T>[] {
  const buckets = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "week", label: "Previous 7 days" },
    { key: "month", label: "Previous 30 days" },
    { key: "earlier", label: "Earlier" },
  ] as const;
  const grouped = new Map<string, T[]>(buckets.map((bucket) => [bucket.key, []]));
  const today = localStartOfDay(now);
  for (const note of notes) {
    const days = Math.floor((today - localStartOfDay(note.updatedAt)) / DAY_MS);
    const key =
      days <= 0
        ? "today"
        : days === 1
          ? "yesterday"
          : days <= 7
            ? "week"
            : days <= 30
              ? "month"
              : "earlier";
    grouped.get(key)?.push(note);
  }
  return buckets.flatMap((bucket) => {
    const entries = grouped.get(bucket.key);
    return entries !== undefined && entries.length > 0
      ? [{ key: bucket.key, label: bucket.label, notes: entries }]
      : [];
  });
}

/** A note's title, or a stand-in when it has none. */
export function noteTitle(note: { readonly title: string }): string {
  const title = note.title.trim();
  return title.length > 0 ? title : "Untitled note";
}

const PREVIEW_MAX = 140;

/** One collapsed line of a note body, for a list row. */
export function bodyPreview(body: string, max = PREVIEW_MAX): string {
  const text = noteBlocksToPlainText(parseNoteMarkdown(body)).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Whether a draft has anything worth saving. */
export function hasNoteContent(title: string, body: string): boolean {
  return title.trim().length > 0 || body.trim().length > 0;
}

const REVISION_LABELS: Record<NoteRevisionAction, string> = {
  created: "Created",
  updated: "Edited",
  renamed: "Renamed",
  moved: "Moved",
  tagged: "Tags changed",
  archived: "Archived",
  restored: "Restored",
  deleted: "Deleted",
};

/** A human label for a revision's action. */
export function revisionActionLabel(action: string): string {
  return REVISION_LABELS[action as NoteRevisionAction] ?? "Changed";
}

/** "No changes", or a compact "+3 -1" tally for a revision. */
export function diffSummary(stats: DiffStats): string {
  const parts: string[] = [];
  if (stats.added > 0) parts.push(`+${stats.added}`);
  if (stats.removed > 0) parts.push(`-${stats.removed}`);
  return parts.length === 0 ? "No changes" : parts.join(" ");
}

export function archiveActionLabel(archived: boolean): string {
  return archived ? "Restore note" : "Archive note";
}

/** "12 notes", or "3 of 12" while filtering, with an archived suffix. */
export function noteCountLabel(
  shown: number,
  total: number,
  options: { readonly archived: boolean; readonly filtering: boolean },
): string {
  const text = options.filtering ? `${shown} of ${total}` : String(total);
  if (options.archived) return `${text} archived`;
  return `${text} ${total === 1 ? "note" : "notes"}`;
}

/** The tags among `ids`, in the order given, skipping any that are gone. */
export function tagsForIds<T extends NoteTag>(tags: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return ids.flatMap((id) => {
    const tag = byId.get(id);
    return tag === undefined ? [] : [tag];
  });
}

export interface NotePermissions {
  readonly view: boolean;
  readonly create: boolean;
  readonly edit: boolean;
  readonly remove: boolean;
  readonly manage: boolean;
}

/** What the viewer may do with notes in this workspace. */
export function notePermissions(permissions: bigint): NotePermissions {
  return {
    view: hasPermission(permissions, Permission.ViewNotes),
    create: hasPermission(permissions, Permission.CreateNotes),
    edit: hasPermission(permissions, Permission.EditNotes),
    remove: hasPermission(permissions, Permission.DeleteNotes),
    manage: hasPermission(permissions, Permission.ManageNotes),
  };
}
