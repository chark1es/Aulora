/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { hasPermission, Permission } from "@aulora/core";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";
import {
  failure,
  type NoteFolder,
  type NoteMember,
  type NoteSummary,
  type NoteTag,
  UNFILED,
} from "./types";

export interface NotesProps {
  ownUserId: string;
  permissions: bigint;
  members: readonly NoteMember[];
  onBack: () => void;
}

/** The unsaved editor contents for the open note. */
export interface NoteDraft {
  title: string;
  body: string;
  folderId: NoteFolder["id"] | null;
  tagIds: string[];
}

/** A destructive action waiting for the user to confirm it. */
export type Confirm =
  | { kind: "deleteNote"; note: NoteSummary }
  | { kind: "deleteFolder"; folder: NoteFolder }
  | { kind: "deleteTag"; tag: NoteTag };

/** The folder form the user has open, if any. */
export type FolderDialog =
  | { mode: "new"; parentId: NoteFolder["id"] | null }
  | { mode: "rename"; folder: NoteFolder }
  | { mode: "move"; folder: NoteFolder };

/** The tag form the user has open, if any. */
export type TagDialog = { mode: "new" } | { mode: "edit"; tag: NoteTag };

type FolderSelection = NoteFolder["id"] | typeof UNFILED | undefined;

/** What the viewer has switched on: filters, the open note and open dialogs. */
function useNotesState() {
  const [folderId, setFolderId] = useState<FolderSelection>(undefined);
  const [tagId, setTagId] = useState<NoteTag["id"] | undefined>(undefined);
  const [noteId, setNoteId] = useState<NoteSummary["id"] | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const [draft, setDraft] = useState<NoteDraft | undefined>(undefined);
  const [confirm, setConfirm] = useState<Confirm | undefined>(undefined);
  const [folderDialog, setFolderDialog] = useState<FolderDialog | undefined>(undefined);
  const [tagDialog, setTagDialog] = useState<TagDialog | undefined>(undefined);
  return {
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
    tab,
    setTab,
    draft,
    setDraft,
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

/** The folders a selected folder contains, including itself. */
function folderScope(
  folders: readonly NoteFolder[],
  folderId: FolderSelection,
): ReadonlySet<string> | null {
  if (folderId === undefined || folderId === UNFILED) return null;
  const byParent = new Map<string, NoteFolder[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? "";
    const list = byParent.get(key) ?? [];
    list.push(folder);
    byParent.set(key, list);
  }
  const scope = new Set<string>();
  const queue = [folderId as string];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || scope.has(id)) continue;
    scope.add(id);
    for (const child of byParent.get(id) ?? []) queue.push(child.id);
  }
  return scope;
}

function inScope(
  note: NoteSummary,
  folderId: FolderSelection,
  scope: ReadonlySet<string> | null,
): boolean {
  if (folderId === undefined) return true;
  if (folderId === UNFILED) return note.folderId === null;
  return note.folderId !== null && (scope?.has(note.folderId) ?? false);
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

  const scope = useMemo(() => folderScope(folders, state.folderId), [folders, state.folderId]);
  const tagNames = useMemo(
    () => new Map<string, string>(tags.map((tag) => [tag.id, tag.name])),
    [tags],
  );

  // The server search runs behind the raw input; the list still filters instantly.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const value = state.query.trim();
    const timer = setTimeout(() => {
      setDebounced(value);
    }, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [state.query]);
  const hits = useQuery(
    api.workspaceNotes.search,
    debounced.length >= 2 ? { query: debounced } : "skip",
  );
  const hitById = useMemo(() => new Map((hits ?? []).map((hit) => [hit.id, hit])), [hits]);

  const visible = useMemo(() => {
    const query = state.query.trim().toLowerCase();
    return notes.filter((note) => {
      if (note.archived !== state.showArchived) return false;
      if (!inScope(note, state.folderId, scope)) return false;
      if (state.tagId !== undefined && !note.tagIds.includes(state.tagId)) return false;
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
    state.query,
    scope,
    hitById,
    tagNames,
  ]);

  const detailSummary = notes.find((note) => note.id === state.noteId);

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
    detailSummary,
    scope,
    canView: hasPermission(props.permissions, Permission.ViewNotes),
    canCreate: hasPermission(props.permissions, Permission.CreateNotes),
    canEdit: hasPermission(props.permissions, Permission.EditNotes),
    canDelete: hasPermission(props.permissions, Permission.DeleteNotes),
    canManage: hasPermission(props.permissions, Permission.ManageNotes),
  };
}

/** Everything the Notes view and its parts share. */
export function useNotes(props: NotesProps) {
  const state = useNotesState();
  const data = useNotesData(props, state);
  const runner = useRunner();
  const mutations = useNoteMutations();

  const visibleKey = data.visible.map((note) => note.id).join(",");
  // Keep a valid note selected as filters change; fall back to the first row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reselect only when the visible set changes
  useEffect(() => {
    if (state.noteId !== undefined && data.visible.some((note) => note.id === state.noteId)) {
      return;
    }
    state.setNoteId(data.visible[0]?.id);
  }, [visibleKey]);

  // Seed the editor from the server when a different note loads, and reload it
  // when the server revision changes — unless there are unsaved local edits.
  const detailKey =
    data.detail === undefined ? undefined : `${data.detail.id}:${data.detail.revision}`;
  const seeded = useRef<{ key: string; snapshot: NoteDraft } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the server key changes
  useEffect(() => {
    const detail = data.detail;
    if (detail === undefined || detailKey === undefined) return;
    const snapshot: NoteDraft = {
      title: detail.title,
      body: detail.body,
      folderId: detail.folderId,
      tagIds: [...detail.tagIds],
    };
    const previous = seeded.current;
    const hasLocalEdits =
      previous !== null && state.draft !== undefined && !sameDraft(state.draft, previous.snapshot);
    seeded.current = { key: detailKey, snapshot };
    if (previous !== null && hasLocalEdits) return;
    state.setDraft(snapshot);
    state.setTab("edit");
  }, [detailKey]);

  const openNote = (id: NoteSummary["id"]) => {
    state.setNoteId(id);
    state.setEditing(false);
  };

  const createNote = async (): Promise<void> => {
    if (!data.canCreate) return;
    const folderId =
      state.folderId !== undefined && state.folderId !== UNFILED ? state.folderId : undefined;
    await runner.run(async () => {
      const id = await mutations.createNote({
        title: "Untitled note",
        body: "",
        ...(folderId !== undefined ? { folderId } : {}),
        ...(state.tagId !== undefined ? { tagIds: [state.tagId] } : {}),
      });
      state.setNoteId(id);
      state.setTab("edit");
      state.setEditing(true);
    });
  };

  const saveNote = async (): Promise<void> => {
    const detail = data.detail;
    if (!data.canEdit || detail === undefined || state.draft === undefined) return;
    const draft = state.draft;
    const saved = await runner.run(async () => {
      await mutations.updateNote({
        noteId: detail.id,
        revision: detail.revision,
        title: draft.title,
        body: draft.body,
        ...(draft.folderId !== null ? { folderId: draft.folderId } : {}),
        tagIds: draft.tagIds as Id<"noteTags">[],
      });
    });
    if (saved) state.setEditing(false);
  };

  const archiveNote = async (note: NoteSummary, archived: boolean): Promise<void> => {
    if (!data.canEdit) return;
    await runner.run(async () => {
      await mutations.archiveNote({ noteId: note.id, archived });
    });
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

  const createFolder = async (name: string, parentId: NoteFolder["id"] | null) => {
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

  const moveFolder = async (folder: NoteFolder, parentId: NoteFolder["id"] | null) => {
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

  const dirty =
    state.draft !== undefined &&
    data.detail !== undefined &&
    !sameDraft(state.draft, {
      title: data.detail.title,
      body: data.detail.body,
      folderId: data.detail.folderId,
      tagIds: [...data.detail.tagIds],
    });

  return {
    ...props,
    ...state,
    ...data,
    ...runner,
    mutations,
    dirty,
    openNote,
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
