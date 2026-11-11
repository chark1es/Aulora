/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { hasPermission, Permission } from "@aulora/core";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { useBeforeUnload } from "../../lib/use-before-unload";
import { useSettingsNavigation } from "../../lib/use-settings-navigation";
import {
  childFolders,
  failure,
  type NoteFolder,
  type NoteMember,
  type NoteSearchHit,
  type NoteSummary,
  type NoteTag,
  ROOT,
  UNFILED,
} from "./types";

/** Table-branded note identifiers, structurally compatible with Convex IDs. */
type Id<TableName extends "noteFolders" | "noteTags" | "notePages"> = string & {
  __tableName: TableName;
};

export interface NotesProps {
  ownUserId: string;
  permissions: bigint;
  members: readonly NoteMember[];
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

/** The unsaved editor contents for the open note. */
export interface NoteDraft {
  title: string;
  body: string;
  folderId: Id<"noteFolders"> | null;
  tagIds: string[];
}

/** A destructive action waiting for the user to confirm it. */
export type Confirm =
  | { kind: "deleteNote"; note: NoteSummary }
  | { kind: "deleteFolder"; folder: NoteFolder }
  | { kind: "deleteTag"; tag: NoteTag };

/** The folder form the user has open, if any. */
export type FolderDialog =
  | { mode: "new"; parentId: Id<"noteFolders"> | null }
  | { mode: "rename"; folder: NoteFolder }
  | { mode: "move"; folder: NoteFolder };

/** The tag form the user has open, if any. */
export type TagDialog = { mode: "new" } | { mode: "edit"; tag: NoteTag };

type FolderSelection = Id<"noteFolders"> | typeof UNFILED | typeof ROOT | undefined;

/** What the viewer has switched on: filters, the open note and open dialogs. */
function useNotesState() {
  const [folderId, setFolderId] = useState<FolderSelection>(undefined);
  const [tagId, setTagId] = useState<Id<"noteTags"> | undefined>(undefined);
  const [noteId, setNoteId] = useState<Id<"notePages"> | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const [draft, setDraft] = useState<NoteDraft | undefined>(undefined);
  const [seed, setSeed] = useState<{ noteId: string; revision: number; snapshot: NoteDraft }>();
  const [replacementNoteId, setReplacementNoteId] = useState<string>();
  const [confirm, setConfirm] = useState<Confirm | undefined>(undefined);
  const [folderDialog, setFolderDialog] = useState<FolderDialog | undefined>(undefined);
  const [tagDialog, setTagDialog] = useState<TagDialog | undefined>(undefined);
  return {
    replacementNoteId,
    setReplacementNoteId,
    folderId,
    setFolderId,
    tagId,
    setTagId,
    noteId,
    setNoteId,
    editing,
    setEditing,
    query,
    setQuery,
    showArchived,
    setShowArchived,
    showAllNotes,
    setShowAllNotes,
    tab,
    setTab,
    draft,
    setDraft,
    seed,
    setSeed,
    confirm,
    setConfirm,
    folderDialog,
    setFolderDialog,
    tagDialog,
    setTagDialog,
  };
}

type NotesState = ReturnType<typeof useNotesState>;

function nothingToSettle(): void {
  // Until a write registers its cleanup there is nothing to put away.
}

/** Whether two editor drafts hold the same content. */
function sameDraft(a: NoteDraft, b: NoteDraft): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.folderId === b.folderId &&
    a.tagIds.join("\u0000") === b.tagIds.join("\u0000")
  );
}

/** Runs a write, blocks a second one meanwhile, and keeps its failure for the banner. */
function useRunner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const settled = useRef(nothingToSettle);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      return true;
    } catch (cause) {
      setError(failure(cause));
      return false;
    } finally {
      setBusy(false);
      settled.current();
    }
  };
  return { busy, error, setError, run, settled };
}

/** Every write the Notes view makes. */
function useNoteMutations() {
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

/** Whether a note belongs directly to the folder the explorer is showing. */
function inExplorerFolder(note: NoteSummary, folderId: FolderSelection): boolean {
  if (folderId === undefined || folderId === UNFILED || folderId === ROOT)
    return note.folderId === null;
  return note.folderId === folderId;
}

function useNoteSearch(query: string): readonly NoteSearchHit[] | undefined {
  // The server search runs behind the raw input, one character at a time, and
  // holds its previous hits so the list never flickers while a new one loads.
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
  const [held, setHeld] = useState<readonly NoteSearchHit[] | undefined>(undefined);
  const cleared = query.trim() === "";
  useEffect(() => {
    // Drop old hits once the box is emptied so a new query never starts on them.
    if (cleared) setHeld(undefined);
    else if (result !== undefined) setHeld(result);
  }, [result, cleared]);
  return cleared ? undefined : held;
}

function notePermissions(permissions: bigint) {
  return {
    canView: hasPermission(permissions, Permission.ViewNotes),
    canCreate: hasPermission(permissions, Permission.CreateNotes),
    canEdit: hasPermission(permissions, Permission.EditNotes),
    canDelete: hasPermission(permissions, Permission.DeleteNotes),
    canManage: hasPermission(permissions, Permission.ManageNotes),
  };
}

/**
 * What the explorer shows for the open folder: a folder id selects that
 * folder's own contents, ROOT or nothing is the home view (top-level folders
 * and unfiled notes), and UNFILED is its own flat view.
 */
function useExplorerView(folders: readonly NoteFolder[], state: NotesState, searching: boolean) {
  const atHome = state.folderId === undefined || state.folderId === ROOT;
  const visibleFolders = useMemo(() => {
    if (state.showAllNotes || searching || state.folderId === UNFILED) return [];
    const parentId = atHome ? null : (state.folderId ?? null);
    return childFolders(folders, parentId);
  }, [folders, state.showAllNotes, searching, atHome, state.folderId]);
  const currentFolder =
    state.folderId === undefined || state.folderId === ROOT || state.folderId === UNFILED
      ? undefined
      : folders.find((folder) => folder.id === state.folderId);
  return { atHome, visibleFolders, currentFolder };
}

interface VisibleNotesInput {
  notes: readonly NoteSummary[];
  tags: readonly NoteTag[];
  state: NotesState;
  hitById: ReadonlyMap<string, NoteSearchHit>;
  searching: boolean;
}

/** The notes the list shows: archive, tag and folder filters, then the search text. */
function useVisibleNotes({ notes, tags, state, hitById, searching }: VisibleNotesInput) {
  const tagNames = useMemo(
    () => new Map<string, string>(tags.map((tag) => [tag.id, tag.name])),
    [tags],
  );
  return useMemo(() => {
    const query = state.query.trim().toLowerCase();
    return notes.filter((note) => {
      if (note.archived !== state.showArchived) return false;
      if (state.tagId !== undefined && !note.tagIds.includes(state.tagId)) return false;
      // Search is always a flat result list across every folder.
      if (!searching && !state.showAllNotes && !inExplorerFolder(note, state.folderId))
        return false;
      if (query === "") return true;
      if (hitById.has(note.id)) return true;
      if (note.title.toLowerCase().includes(query)) return true;
      return note.tagIds.some((id) => (tagNames.get(id) ?? "").toLowerCase().includes(query));
    });
  }, [
    notes,
    state.showArchived,
    state.folderId,
    state.tagId,
    state.showAllNotes,
    searching,
    state.query,
    hitById,
    tagNames,
  ]);
}

/** The folders, notes and tags the viewer may see, and the filtered note list. */
function useNotesData(props: NotesProps, state: NotesState) {
  const overview = useQuery(api.workspaceNotes.overview, {});
  const folders = useMemo(() => overview?.folders ?? [], [overview]);
  const notes = useMemo(() => overview?.notes ?? [], [overview]);
  const tags = useMemo(() => overview?.tags ?? [], [overview]);

  const detail = useQuery(
    api.workspaceNotes.get,
    state.noteId !== undefined ? { noteId: state.noteId } : "skip",
  );
  const history = useQuery(
    api.workspaceNotes.history,
    state.noteId !== undefined && state.tab === "history"
      ? { noteId: state.noteId, limit: 50 }
      : "skip",
  );

  const hits = useNoteSearch(state.query);
  const hitById = useMemo(() => new Map((hits ?? []).map((hit) => [hit.id, hit])), [hits]);

  const searching = state.query.trim().length > 0;
  const explorer = useExplorerView(folders, state, searching);
  const visible = useVisibleNotes({ notes, tags, state, hitById, searching });

  return {
    overview,
    folders,
    notes,
    tags,
    detail,
    history,
    hits,
    hitById,
    visible,
    ...explorer,
    searching,
    ...notePermissions(props.permissions),
  };
}

function useNoteSelection(state: NotesState, data: ReturnType<typeof useNotesData>) {
  // Nothing opens on its own: the pane only fills once the viewer picks a note.
  // Clear a selection that no longer exists (deleted, archived or filtered out).
  const knownKey = data.notes.map((note) => note.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to membership changes
  useEffect(() => {
    if (state.noteId === undefined) return;
    if (data.notes.some((note) => note.id === state.noteId)) return;
    state.setNoteId(undefined);
  }, [knownKey]);

  // Switching between the active and archived views closes a note that no
  // longer belongs to the list on screen.
  const archived = state.showArchived;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to the view switch
  useEffect(() => {
    const note = data.notes.find((entry) => entry.id === state.noteId);
    if (note !== undefined && note.archived !== archived) state.setNoteId(undefined);
  }, [archived]);

  // Seed the editor from the server when a different note loads, and reload it
  // when the server revision changes — unless there are unsaved local edits.
  const detailKey =
    data.detail === undefined
      ? undefined
      : `${state.noteId}:${data.detail.id}:${data.detail.revision}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the server key changes
  useEffect(() => {
    const detail = data.detail;
    if (detail === undefined || detailKey === undefined || detail.id !== state.noteId) return;
    const snapshot: NoteDraft = {
      title: detail.title,
      body: detail.body,
      folderId: detail.folderId,
      tagIds: [...detail.tagIds],
    };
    const previous = state.seed;
    const hasLocalEdits =
      previous !== undefined &&
      state.draft !== undefined &&
      !sameDraft(state.draft, previous.snapshot);
    if (previous?.noteId === detail.id && hasLocalEdits) return;
    state.setSeed({ noteId: detail.id, revision: detail.revision, snapshot });
    state.setDraft(snapshot);
    state.setTab("edit");
  }, [detailKey]);
}

function isDraftDirty(state: NotesState): boolean {
  return (
    state.noteId === state.seed?.noteId &&
    state.draft !== undefined &&
    state.seed !== undefined &&
    !sameDraft(state.draft, state.seed.snapshot)
  );
}

/** Everything the Notes view and its parts share. */
export function useNotes(props: NotesProps) {
  const state = useNotesState();
  const data = useNotesData(props, state);
  const runner = useRunner();
  const mutations = useNoteMutations();
  const latest = useRef({ noteId: state.noteId, draft: state.draft });
  latest.current = { noteId: state.noteId, draft: state.draft };

  useNoteSelection(state, data);

  const dirty = isDraftDirty(state);
  const navigation = useSettingsNavigation(true, dirty);
  useBeforeUnload(dirty);
  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);
  useEffect(() => () => props.onDirtyChange?.(false), [props.onDirtyChange]);
  const openNote = (id: Id<"notePages">) => {
    if (id === state.noteId) return;
    navigation.navigate(() => {
      state.setDraft(undefined);
      state.setSeed(undefined);
      state.setReplacementNoteId(undefined);
      state.setNoteId(id);
      state.setEditing(false);
    });
  };

  const createNoteNow = async (): Promise<void> => {
    if (!data.canCreate) return;
    const folderId =
      state.folderId !== undefined && state.folderId !== UNFILED && state.folderId !== ROOT
        ? state.folderId
        : undefined;
    await runner.run(async () => {
      const id = await mutations.createNote({
        title: "Untitled note",
        body: "",
        ...(folderId !== undefined ? { folderId } : {}),
        ...(state.tagId !== undefined ? { tagIds: [state.tagId] } : {}),
      });
      state.setDraft(undefined);
      state.setSeed(undefined);
      state.setReplacementNoteId(undefined);
      state.setNoteId(id);
      state.setTab("edit");
      state.setEditing(true);
    });
  };

  const createNote = () => navigation.navigate(() => void createNoteNow());

  /** Opens a folder in the explorer, closing any note pane. */
  const openFolder = (folderId: FolderSelection) => {
    navigation.navigate(() => {
      state.setFolderId(folderId);
      state.setShowAllNotes(false);
      state.setNoteId(undefined);
      state.setEditing(false);
      state.setDraft(undefined);
      state.setSeed(undefined);
      state.setReplacementNoteId(undefined);
    });
  };

  const closeNote = () =>
    navigation.navigate(() => {
      state.setNoteId(undefined);
      state.setEditing(false);
      state.setDraft(undefined);
      state.setSeed(undefined);
      state.setReplacementNoteId(undefined);
    });

  /** Opens the create-folder dialog inside whichever folder the explorer shows. */
  const newFolderInView = () => {
    const parentId =
      state.folderId !== undefined && state.folderId !== UNFILED && state.folderId !== ROOT
        ? state.folderId
        : null;
    state.setFolderDialog({ mode: "new", parentId });
  };

  const saveNote = async (): Promise<void> => {
    const detail = data.detail;
    if (
      !data.canEdit ||
      detail === undefined ||
      state.draft === undefined ||
      state.noteId !== detail.id ||
      state.seed?.noteId !== detail.id
    )
      return;
    const submitted = state.draft;
    const draft = { ...submitted, title: submitted.title.trim() };
    const baseRevision = state.seed.revision;
    const saved = await runner.run(async () => {
      const revision = await mutations.updateNote({
        noteId: detail.id,
        revision: baseRevision,
        title: draft.title,
        body: draft.body,
        ...(draft.folderId !== null ? { folderId: draft.folderId } : {}),
        tagIds: draft.tagIds as Id<"noteTags">[],
      });
      if (latest.current.noteId !== detail.id) return;
      state.setReplacementNoteId(undefined);
      state.setSeed({ noteId: detail.id, revision, snapshot: draft });
      state.setDraft((current) =>
        current !== undefined && sameDraft(current, submitted) ? draft : current,
      );
    });
    if (
      saved &&
      latest.current.noteId === detail.id &&
      latest.current.draft !== undefined &&
      (sameDraft(latest.current.draft, submitted) || sameDraft(latest.current.draft, draft))
    ) {
      state.setEditing(false);
    }
  };

  const archiveNote = async (note: NoteSummary, archived: boolean): Promise<void> => {
    if (!data.canEdit) return;
    const closes = state.noteId === note.id && archived !== state.showArchived;
    const saved = await runner.run(async () => {
      await mutations.archiveNote({ noteId: note.id, archived });
    });
    if (saved && closes) closeNote();
  };

  const requestDeleteNote = (note: NoteSummary) => {
    state.setConfirm({ kind: "deleteNote", note });
  };
  const requestDeleteFolder = (folder: NoteFolder) => {
    state.setConfirm({ kind: "deleteFolder", folder });
  };
  const requestDeleteTag = (tag: NoteTag) => {
    state.setConfirm({ kind: "deleteTag", tag });
  };

  const confirmDelete = async (): Promise<void> => {
    const target = state.confirm;
    state.setConfirm(undefined);
    if (target === undefined) return;
    if (target.kind === "deleteNote") {
      await runner.run(async () => {
        await mutations.deleteNote({ noteId: target.note.id });
        if (state.noteId === target.note.id) state.setNoteId(undefined);
      });
      return;
    }
    if (target.kind === "deleteFolder") {
      await runner.run(async () => {
        await mutations.deleteFolder({ folderId: target.folder.id });
        if (state.folderId === target.folder.id) state.setFolderId(undefined);
      });
      return;
    }
    await runner.run(async () => {
      await mutations.deleteTag({ tagId: target.tag.id });
      if (state.tagId === target.tag.id) state.setTagId(undefined);
    });
  };

  const createFolder = async (name: string, parentId: Id<"noteFolders"> | null) => {
    if (!data.canCreate) return;
    await runner.run(async () => {
      await mutations.createFolder({
        name,
        ...(parentId !== null ? { parentId } : {}),
      });
      state.setFolderDialog(undefined);
    });
  };

  const renameFolder = async (folder: NoteFolder, name: string) => {
    if (!data.canEdit) return;
    await runner.run(async () => {
      await mutations.renameFolder({ folderId: folder.id, name });
      state.setFolderDialog(undefined);
    });
  };

  const moveFolder = async (folder: NoteFolder, parentId: Id<"noteFolders"> | null) => {
    if (!data.canEdit) return;
    await runner.run(async () => {
      await mutations.moveFolder({
        folderId: folder.id,
        ...(parentId !== null ? { parentId } : {}),
      });
      state.setFolderDialog(undefined);
    });
  };

  const createTag = async (name: string, color: string) => {
    if (!data.canEdit) return;
    await runner.run(async () => {
      await mutations.createTag({ name, color });
      state.setTagDialog(undefined);
    });
  };

  const updateTag = async (tag: NoteTag, name: string, color: string) => {
    if (!data.canEdit) return;
    await runner.run(async () => {
      await mutations.updateTag({ tagId: tag.id, name, color });
      state.setTagDialog(undefined);
    });
  };

  const conflict =
    state.seed?.noteId === data.detail?.id &&
    state.seed !== undefined &&
    data.detail !== undefined &&
    state.seed.revision < data.detail.revision;
  const reloadLatestNow = () => {
    if (data.detail === undefined) return;
    const snapshot: NoteDraft = {
      title: data.detail.title,
      body: data.detail.body,
      folderId: data.detail.folderId,
      tagIds: [...data.detail.tagIds],
    };
    state.setSeed({ noteId: data.detail.id, revision: data.detail.revision, snapshot });
    state.setDraft(snapshot);
    state.setReplacementNoteId(undefined);
    runner.setError(undefined);
  };
  const reloadLatest = () => navigation.navigate(reloadLatestNow);
  const overwriteWithMyVersion = () => {
    if (data.detail === undefined || state.seed?.noteId !== data.detail.id) return;
    state.setReplacementNoteId(data.detail.id);
    state.setSeed({
      noteId: data.detail.id,
      revision: data.detail.revision,
      snapshot: {
        title: data.detail.title,
        body: data.detail.body,
        folderId: data.detail.folderId,
        tagIds: [...data.detail.tagIds],
      },
    });
    runner.setError(undefined);
  };

  return {
    ...props,
    ...state,
    ...data,
    ...runner,
    mutations,
    dirty,
    navigation,
    conflict,
    replacingNewerVersion:
      state.replacementNoteId !== undefined && state.replacementNoteId === state.noteId,
    reloadLatest,
    overwriteWithMyVersion,
    draft: state.seed?.noteId === state.noteId ? state.draft : undefined,
    onBack: () => navigation.navigate(props.onBack),
    openNote,
    openFolder,
    closeNote,
    newFolderInView,
    createNote,
    saveNote,
    archiveNote,
    requestDeleteNote,
    requestDeleteFolder,
    requestDeleteTag,
    confirmDelete,
    createFolder,
    renameFolder,
    moveFolder,
    createTag,
    updateTag,
    clearError: () => {
      runner.setError(undefined);
    },
  };
}

export type NotesController = ReturnType<typeof useNotes>;
