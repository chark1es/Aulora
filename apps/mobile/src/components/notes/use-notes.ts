/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { failure } from "../../lib/kanban";
import {
  buildFolderTree,
  filterCount,
  flattenFolders,
  groupNotes,
  NO_NOTE_FILTERS,
  type NoteFilters,
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
  const visible = useMemo(
    () => selectNotes(notes, state.filters, state.order),
    [notes, state.filters, state.order],
  );
  const groups = useMemo(() => groupNotes(visible, Date.now()), [visible]);
  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  return {
    overview,
    folders,
    notes,
    tags,
    detail,
    history,
    visible,
    groups,
    flatFolders,
    folderTree,
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
    /** Leaves the editor and forgets the note, e.g. after deleting it. */
    closeNote: () => {
      props.onNoteChange(null);
      state.setMode("list");
    },
  };
}

export type NotesController = ReturnType<typeof useNotes>;
