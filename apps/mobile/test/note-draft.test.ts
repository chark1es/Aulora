import { describe, expect, it } from "vitest";
import {
  decideNoteSeed,
  type NoteDraftSeed,
  type NoteDraftState,
  noteDraftDirty,
  noteNeedsReload,
  noteSaveRequest,
  rebaseNoteDraft,
  requestNoteDiscard,
  runNoteSave,
} from "../src/lib/note-draft";

const seed: NoteDraftSeed = {
  noteId: "note-1",
  revision: 3,
  title: "Plan",
  body: "Original",
  folderId: null,
  tagIds: ["a"],
};

function state(patch: Partial<NoteDraftState> = {}): NoteDraftState {
  return {
    seed,
    title: seed.title,
    body: seed.body,
    folderId: seed.folderId,
    tagIds: seed.tagIds,
    ...patch,
  };
}

describe("note draft seeding", () => {
  it("is clean until a field differs from the seeded revision", () => {
    expect(noteDraftDirty(state())).toBe(false);
    expect(noteDraftDirty(state({ body: "Edited" }))).toBe(true);
    expect(noteDraftDirty(state({ tagIds: ["a", "b"] }))).toBe(true);
    expect(noteDraftDirty({ ...state(), seed: undefined })).toBe(true);
  });

  it("keeps unsaved edits when a newer revision arrives for the same note", () => {
    expect(decideNoteSeed(seed, { noteId: "note-1", revision: 4 }, true)).toBe("keep");
  });

  it("reseeds a clean draft when the same note changes remotely", () => {
    expect(decideNoteSeed(seed, { noteId: "note-1", revision: 4 }, false)).toBe("seed");
    expect(decideNoteSeed(seed, { noteId: "note-1", revision: 3 }, false)).toBe("unchanged");
  });

  it("always loads a different note, even with a dirty draft", () => {
    expect(decideNoteSeed(seed, { noteId: "note-2", revision: 9 }, true)).toBe("seed");
  });

  it("seeds an empty editor once the note loads", () => {
    expect(decideNoteSeed(undefined, { noteId: "note-1", revision: 1 }, false)).toBe("seed");
  });

  it("asks for a reload when the subscribed note advanced past the draft", () => {
    expect(noteNeedsReload(seed, { noteId: "note-1", revision: 4 })).toBe(true);
    expect(noteNeedsReload(seed, { noteId: "note-1", revision: 3 })).toBe(false);
    // A stale snapshot after a save is not a conflict.
    expect(noteNeedsReload(seed, { noteId: "note-1", revision: 2 })).toBe(false);
    expect(noteNeedsReload(seed, { noteId: "note-2", revision: 9 })).toBe(false);
    expect(noteNeedsReload(undefined, { noteId: "note-1", revision: 4 })).toBe(false);
  });
});

describe("note saving", () => {
  const fields = {
    title: "  Plan  ",
    body: "Edited body",
    folderId: null,
    tagIds: ["a", "b"],
  };

  it("saves against the draft's base revision and normalises the title", async () => {
    const update = async (request: {
      readonly noteId: string;
      readonly revision: number;
      readonly title: string;
    }) => {
      expect(request).toMatchObject({ noteId: "note-1", revision: 3, title: "Plan" });
      return 4;
    };
    const result = await runNoteSave({
      note: { id: "note-1", revision: 5 },
      baseRevision: 3,
      fields,
      create: async () => "unused",
      update,
    });
    expect(result).toEqual({
      kind: "saved",
      seed: {
        noteId: "note-1",
        revision: 4,
        title: "Plan",
        body: "Edited body",
        folderId: null,
        tagIds: ["a", "b"],
      },
    });
    // markSaved also writes the trimmed title back to the field, so the saved
    // draft is clean even though the field held trailing whitespace.
    expect(
      noteDraftDirty({
        seed: result.kind === "saved" ? result.seed : seed,
        title: "Plan",
        body: fields.body,
        folderId: fields.folderId,
        tagIds: fields.tagIds,
      }),
    ).toBe(false);
  });

  it("reports a stale revision as a conflict instead of a generic failure", async () => {
    const result = await runNoteSave({
      note: { id: "note-1", revision: 5 },
      baseRevision: 3,
      fields,
      create: async () => "unused",
      update: async () => {
        throw new Error("The note changed. Reload it and try again");
      },
    });
    expect(result.kind).toBe("conflict");
    expect(result.kind === "conflict" ? result.message : "").toContain("The note changed");
  });

  it("keeps other save failures generic", async () => {
    const result = await runNoteSave({
      note: { id: "note-1", revision: 3 },
      baseRevision: 3,
      fields,
      create: async () => "unused",
      update: async () => {
        throw new Error("Permission denied");
      },
    });
    expect(result).toEqual({ kind: "failed", message: "Permission denied" });
  });

  it("creates a new note without a revision check", async () => {
    const result = await runNoteSave({
      note: undefined,
      baseRevision: undefined,
      fields,
      create: async (request) => {
        expect(request.title).toBe("Plan");
        return "new-note";
      },
      update: async () => {
        throw new Error("update should not run");
      },
    });
    expect(result).toEqual({ kind: "created", noteId: "new-note" });
  });

  it("omits a null folder from the server request", () => {
    expect(noteSaveRequest(fields)).toEqual({
      title: "Plan",
      body: "Edited body",
      tagIds: ["a", "b"],
    });
    expect(noteSaveRequest({ ...fields, folderId: "folder-1" })).toMatchObject({
      folderId: "folder-1",
    });
  });
});

describe("explicit conflict resolution and discard", () => {
  it("rebases every local field onto the latest revision and saves successfully", async () => {
    const local = state({
      title: "My title",
      body: "My body",
      folderId: "mine",
      tagIds: ["local"],
    });
    const latest = { ...seed, revision: 8, title: "Remote title", body: "Remote body" };
    const rebased = rebaseNoteDraft(local, latest);
    expect(rebased).toEqual({ ...local, seed: latest });
    expect(noteDraftDirty(rebased)).toBe(true);
    expect(noteNeedsReload(rebased.seed, latest)).toBe(false);
    const result = await runNoteSave({
      note: { id: seed.noteId, revision: 8 },
      baseRevision: rebased.seed?.revision,
      fields: rebased,
      create: async () => "unused",
      update: async (request) => {
        expect(request).toMatchObject({
          revision: 8,
          title: "My title",
          body: "My body",
          folderId: "mine",
          tagIds: ["local"],
        });
        return 9;
      },
    });
    expect(result.kind).toBe("saved");
  });

  it("guards both reload and navigation until discard is confirmed", () => {
    for (const action of ["reload", "back", "history"]) {
      const actions: string[] = [];
      let confirm: (() => void) | undefined;
      requestNoteDiscard(
        true,
        () => actions.push(action),
        (discard) => {
          confirm = discard;
        },
      );
      expect(actions).toEqual([]); // cancel leaves the draft alone
      confirm?.();
      expect(actions).toEqual([action]);
    }
  });

  it("allows a clean draft to leave immediately and protects a new unsaved note", () => {
    let left = false;
    requestNoteDiscard(
      false,
      () => {
        left = true;
      },
      () => {
        throw new Error("unneeded prompt");
      },
    );
    expect(left).toBe(true);
    expect(noteDraftDirty(state({ seed: undefined, title: "New" }))).toBe(true);
    expect(
      noteDraftDirty({ seed: undefined, title: "", body: "", folderId: null, tagIds: [] }),
    ).toBe(false);
  });
});
