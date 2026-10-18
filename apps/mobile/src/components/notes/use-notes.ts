/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { failure } from "../../lib/kanban";
import {
  buildFolderTree,
  filterCount,
  flattenFolders,
  folderChildren,
  folderPath,
  groupNotes,
  NO_NOTE_FILTERS,
  type NoteFilters,
  type NoteHit,
  type NoteMember,
  type NoteOrder,
  type NotePermissions,
  notePermissions,
  selectNotes,
  tagsForIds,
} from "../../lib/notes";

export type NotesOverview = FunctionReturnType<typeof api.workspaceNotes.overview>;
export type NoteListItem = NotesOverview["notes"][number];
export type NoteFolderView = NotesOverview["folders"][number];
export type NoteTagView = NotesOverview["tags"][number];
export type NoteDetailView = FunctionReturnType<typeof api.workspaceNotes.get>;
export type NoteHistoryEntry = FunctionReturnType<typeof api.workspaceNotes.history>[number];

export interface NotesProps {
  readonly ownUserId: string;
  readonly permissions: bigint;
  readonly members: readonly NoteMember[];
  /** The note the viewer last had open, kept by the parent across tab visits. */
  readonly noteId: string | null;
  readonly onNoteChange: (noteId: string | null) => void;
  /** Present when the list was opened from somewhere with a way back. */
  readonly onBack?: (() => void) | undefined;
}

/** Whether the list, one note's editor or its history is showing. */
export type NotesMode = "list" | "editor" | "history";

/** The sheet currently over the notes list, if any. */
export type NotesSheet =
  | { readonly kind: "note"; readonly noteId: string }
  | { readonly kind: "create" }
  | { readonly kind: "folder"; readonly folderId: string }
  | {
      readonly kind: "folderForm";
      readonly folderId: string | null;
      readonly parentId: string | null;
    }
  | { readonly kind: "moveFolder"; readonly folderId: string }
  | { readonly kind: "tags" }
  | { readonly kind: "tagFilter" }
  | { readonly kind: "more" };

/** What the viewer has switched on: filters, sort and what is open. */
function useNotesState() {
  const [mode, setMode] = useState<NotesMode>("list");
  const [filters, setFilters] = useState<NoteFilters>(NO_NOTE_FILTERS);
  const [order, setOrder] = useState<NoteOrder>("updated");
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<NotesSheet | undefined>();
  return {
    mode,
    setMode,
    filters,
    setFilters,
    order,
    setOrder,
    searching,
    setSearching,
    open,
    setOpen,
  };
}

type NotesState = ReturnType<typeof useNotesState>;

/** Runs a write and keeps its failure for the banner. */
function useRunner() {
  const [error, setError] = useState<string | undefined>();
  const run = useCallback(async (work: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await work();
      return true;
    } catch (cause) {
      setError(failure(cause));
      return false;
    }
  }, []);
  return { error, setError, run };
}

/** Every write the notes screens make. */
export function useNotesMutations() {
  return {
    createFolder: useMutation(api.workspaceNotes.createFolder),
    renameFolder: useMutation(api.workspaceNotes.renameFolder),
    moveFolder: useMutation(api.workspaceNotes.moveFolder),
    deleteFolder: useMutation(api.workspaceNotes.deleteFolder),
    createNote: useMutation(api.workspaceNotes.createNote),
    updateNote: useMutation(api.workspaceNotes.updateNote),
    archiveNote: useMutation(api.workspaceNotes.archiveNote),
    deleteNote: useMutation(api.workspaceNotes.deleteNote),
    createTag: useMutation(api.workspaceNotes.createTag),
    updateTag: useMutation(api.workspaceNotes.updateTag),
    deleteTag: useMutation(api.workspaceNotes.deleteTag),
  };
}

export type NoteMutations = ReturnType<typeof useNotesMutations>;

/** The server search hits for one query, holding the last result to avoid flicker. */
function useNoteHits(query: string): ReadonlyMap<string, NoteHit> {
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const value = query.trim();
    const timer = setTimeout(() => {
      setDebounced(value);
    }, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);
  const result = useQuery(
    api.workspaceNotes.search,
    debounced.length >= 1 ? { query: debounced } : "skip",
  );
  const [held, setHeld] = useState<readonly { id: string; snippet: string }[]>([]);
  useEffect(() => {
    if (result !== undefined) setHeld(result);
  }, [result]);
  return useMemo(() => new Map(held.map((hit) => [hit.id, hit])), [held]);
}

/** The folders, notes and tags the viewer may see, already filtered. */
function useNotesData(props: NotesProps, state: NotesState) {
  const overview = useQuery(api.workspaceNotes.overview, {});
  const folders = useMemo(() => overview?.folders ?? [], [overview]);
  const notes = useMemo(() => overview?.notes ?? [], [overview]);
  const tags = useMemo(() => overview?.tags ?? [], [overview]);
  const selectedId = props.noteId;
  const detail = useQuery(
    api.workspaceNotes.get,
    selectedId !== null && state.mode !== "list" ? { noteId: selectedId as never } : "skip",
  );
  const history = useQuery(
    api.workspaceNotes.history,
    selectedId !== null && state.mode === "history"
      ? { noteId: selectedId as never, limit: 50 }
      : "skip",
  );
  const hits = useNoteHits(state.filters.query);
  const searching = state.filters.query.trim().length > 0;
  const visible = useMemo(
    () => selectNotes(notes, state.filters, state.order, hits),
    [notes, state.filters, state.order, hits],
  );
  const groups = useMemo(() => groupNotes(visible, Date.now()), [visible]);
  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  // The child folders shown at the top of the list: top-level ones at home,
  // and the open folder's own children once drilled in.
  const openFolderId = state.filters.folderId;
  const childFoldersInView = useMemo(() => {
    if (searching || openFolderId === null) return [];
    return folderChildren(folders, openFolderId === undefined ? null : openFolderId);
  }, [folders, searching, openFolderId]);
  return {
    overview,
    folders,
    notes,
    tags,
    detail,
    history,
    hits,
    visible,
    groups,
    flatFolders,
    folderTree,
    childFoldersInView,
    searching,
    selecting: filterCount(state.filters) > 0,
  };
}

/** Everything the notes screens and their parts share. */
export function useNotes(props: NotesProps) {
  const state = useNotesState();
  const permissions: NotePermissions = useMemo(
    () => notePermissions(props.permissions),
    [props.permissions],
  );
  const data = useNotesData(props, state);
  const runner = useRunner();
  const mutations = useNotesMutations();
  const selectedTagIds = state.filters.tagIds;
  return {
    ...state,
    ...data,
    ...runner,
    mutations,
    permissions,
    canView: permissions.view,
    tagsForSelected: tagsForIds(data.tags, selectedTagIds),
    ownUserId: props.ownUserId,
    members: props.members,
    selectedId: props.noteId,
    onBack: props.onBack,
    /** Opens a note in the editor and remembers it for the next visit. */
    openNote: (noteId: string) => {
      props.onNoteChange(noteId);
      state.setMode("editor");
    },
    /** Opens a blank editor; the id arrives once it is created. */
    newNote: () => {
      props.onNoteChange(null);
      state.setMode("editor");
    },
    openHistory: (noteId: string) => {
      props.onNoteChange(noteId);
      state.setMode("history");
    },
    backToList: () => {
      state.setMode("list");
    },
    /** Drills into a folder (or `null`/undefined for Unfiled/home) from the list. */
    openFolder: (folderId: string | null | undefined) => {
      props.onNoteChange(null);
      state.setMode("list");
      state.setFilters({ ...state.filters, query: "", folderId });
    },
    /** Returns from a folder to its parent, or to the home view at the root. */
    goUpFolder: () => {
      const current = state.filters.folderId;
      if (current === undefined || current === null) return;
      const folder = data.folders.find((entry) => entry.id === current);
      state.setFilters({ ...state.filters, query: "", folderId: folder?.parentId ?? undefined });
    },
    /** The breadcrumb for the open folder, e.g. "Work / Web". */
    folderPathLabel:
      state.filters.folderId === undefined || state.filters.folderId === null
        ? ""
        : folderPath(data.folders, state.filters.folderId),
    /** Leaves the editor and forgets the note, e.g. after deleting it. */
    closeNote: () => {
      props.onNoteChange(null);
      state.setMode("list");
    },
  };
}

export type NotesController = ReturnType<typeof useNotes>;
