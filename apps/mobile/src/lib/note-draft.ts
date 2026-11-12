import { failure } from "./kanban";

/** The server revision a local note draft was seeded from. */
export interface NoteDraftSeed {
  readonly noteId: string;
  readonly revision: number;
  readonly title: string;
  readonly body: string;
  readonly folderId: string | null;
  readonly tagIds: readonly string[];
}

/** What the editor currently holds, plus the revision it started from. */
export interface NoteDraftState {
  readonly seed: NoteDraftSeed | undefined;
  readonly title: string;
  readonly body: string;
  readonly folderId: string | null;
  readonly tagIds: readonly string[];
}

/** Whether any local field differs from the revision the draft was seeded from. */
export function noteDraftDirty(state: NoteDraftState): boolean {
  const { seed } = state;
  if (seed === undefined) {
    return (
      state.title.length > 0 ||
      state.body.length > 0 ||
      state.folderId !== null ||
      state.tagIds.length > 0
    );
  }
  return (
    seed.title !== state.title ||
    seed.body !== state.body ||
    seed.folderId !== state.folderId ||
    seed.tagIds.length !== state.tagIds.length ||
    seed.tagIds.some((tagId, index) => tagId !== state.tagIds[index])
  );
}

/**
 * Whether a new note snapshot should replace the draft fields.
 *
 * `seed` matches the same revision: nothing to do. A different note is always
 * loaded. The same note at a newer revision keeps the local draft when it has
 * unsaved edits, so a live subscription update cannot wipe typing; the draft
 * keeps tracking the revision it is based on so saving still uses that base.
 */
export function decideNoteSeed(
  seed: NoteDraftSeed | undefined,
  next: { readonly noteId: string; readonly revision: number },
  dirty: boolean,
): "seed" | "keep" | "unchanged" {
  if (seed === undefined || seed.noteId !== next.noteId) {
    return "seed";
  }
  if (seed.revision === next.revision) {
    return "unchanged";
  }
  return dirty ? "keep" : "seed";
}

/** Whether the subscribed note is newer than the revision the draft is based on. */
export function noteNeedsReload(
  seed: NoteDraftSeed | undefined,
  note: { readonly noteId: string; readonly revision: number } | undefined,
): boolean {
  if (seed === undefined || note === undefined || seed.noteId !== note.noteId) {
    return false;
  }
  return seed.revision < note.revision;
}

/** The fields a note save writes, with the title normalised the way the server does. */
export interface NoteSaveRequest {
  readonly title: string;
  readonly body: string;
  readonly folderId?: string | null;
  readonly tagIds: readonly string[];
}

export interface NoteSaveFields {
  readonly title: string;
  readonly body: string;
  readonly folderId: string | null;
  readonly tagIds: readonly string[];
}

/** Builds a save request, trimming the title so the local draft matches the server. */
export function noteSaveRequest(fields: NoteSaveFields): NoteSaveRequest {
  return {
    title: fields.title.trim(),
    body: fields.body,
    ...(fields.folderId !== null ? { folderId: fields.folderId } : {}),
    tagIds: [...fields.tagIds],
  };
}

/** The clean seed a successful save produces. */
export function noteSavedSeed(
  noteId: string,
  revision: number,
  request: NoteSaveRequest,
  folderId: string | null,
): NoteDraftSeed {
  return {
    noteId,
    revision,
    title: request.title,
    body: request.body,
    folderId,
    tagIds: [...request.tagIds],
  };
}

/** Whether a failed update was rejected because the note changed underneath. */
export function noteRevisionConflict(message: string): boolean {
  return message.includes("The note changed");
}

/** What a save attempt did, so the editor can update its draft or offer a reload. */
export type NoteSaveResult =
  | { readonly kind: "created"; readonly noteId: string }
  | { readonly kind: "saved"; readonly seed: NoteDraftSeed }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/** Saves a draft against the revision it was seeded from and classifies the outcome. */
export async function runNoteSave(input: {
  readonly note: { readonly id: string; readonly revision: number } | undefined;
  readonly baseRevision: number | undefined;
  readonly fields: NoteSaveFields;
  readonly create: (_request: NoteSaveRequest) => Promise<string>;
  readonly update: (
    _request: NoteSaveRequest & { noteId: string; revision: number },
  ) => Promise<number>;
}): Promise<NoteSaveResult> {
  const request = noteSaveRequest(input.fields);
  try {
    if (input.note === undefined) {
      return { kind: "created", noteId: await input.create(request) };
    }
    const revision = await input.update({
      noteId: input.note.id,
      // Save against the revision this draft was seeded from, not a newer remote
      // revision that arrived while the viewer was typing.
      revision: input.baseRevision ?? input.note.revision,
      ...request,
    });
    return {
      kind: "saved",
      seed: noteSavedSeed(input.note.id, revision, request, input.fields.folderId),
    };
  } catch (cause) {
    const message = failure(cause);
    return noteRevisionConflict(message)
      ? { kind: "conflict", message }
      : { kind: "failed", message };
  }
}

/** Explicitly adopts the latest base while preserving every local field. */
export function rebaseNoteDraft(state: NoteDraftState, latest: NoteDraftSeed): NoteDraftState {
  if (state.seed?.noteId !== latest.noteId) return state;
  return { ...state, seed: latest };
}

/** A discard action only runs immediately when the draft is clean. */
export function requestNoteDiscard(
  dirty: boolean,
  discard: () => void,
  confirm: (discard: () => void) => void,
): void {
  if (dirty) confirm(discard);
  else discard();
}
