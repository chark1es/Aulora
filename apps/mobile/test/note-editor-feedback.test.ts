import { beforeEach, expect, it, vi } from "vitest";
import { editorActions } from "../src/components/notes/note-editor-actions";
import { useNoteEditor } from "../src/components/notes/use-note-editor";
import type { NotesController } from "../src/components/notes/use-notes";

// Stateful hook cells let the native editor run without loading a native renderer.
const hooks = vi.hoisted(() => ({
  cells: [] as unknown[],
  setters: [] as ((next: unknown) => void)[],
  slot: 0,
  changed: false,
  effects: [] as (() => void)[],
  alert: vi.fn(),
}));
vi.mock("react-native", () => ({ Alert: { alert: hooks.alert } }));
vi.mock("../src/components/kanban/board-menus", () => ({ confirm: vi.fn() }));
vi.mock("react", () => {
  const memo = (factory: () => unknown, deps: readonly unknown[]) => {
    const slot = hooks.slot++;
    const previous = hooks.cells[slot] as { deps: readonly unknown[]; value: unknown } | undefined;
    if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) {
      hooks.cells[slot] = { deps, value: factory() };
    }
    return (hooks.cells[slot] as { value: unknown }).value;
  };
  return {
    useState: (initial: unknown) => {
      const slot = hooks.slot++;
      if (!(slot in hooks.cells)) hooks.cells[slot] = initial;
      hooks.setters[slot] ??= (next: unknown) => {
        const value = typeof next === "function" ? next(hooks.cells[slot]) : next;
        if (value !== hooks.cells[slot]) hooks.changed = true;
        hooks.cells[slot] = value;
      };
      return [hooks.cells[slot], hooks.setters[slot]];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
    useRef: (current: unknown) => memo(() => ({ current }), []),
    useEffect: (effect: () => void, deps: readonly unknown[]) =>
      memo(() => {
        hooks.effects.push(effect);
      }, deps),
  };
});

beforeEach(() => {
  hooks.cells = [];
  hooks.setters = [];
  hooks.alert.mockClear();
});

function setup(options: { selectedId?: string | null; detail?: boolean } = {}) {
  const detail:
    | {
        id: string;
        revision: number;
        title: string;
        body: string;
        folderId: null;
        tagIds: never[];
      }
    | undefined =
    options.detail === false
      ? undefined
      : {
          id: "note",
          revision: 1,
          title: "Plan",
          body: "Original",
          folderId: null,
          tagIds: [],
        };
  const ctl = {
    detail,
    selectedId: options.selectedId,
    permissions: { edit: true, remove: true },
    mutations: { updateNote: vi.fn(async () => 3) },
    setError: vi.fn(),
    backToList: vi.fn(),
    openHistory: vi.fn(),
  };
  const render = () => {
    let editor: ReturnType<typeof useNoteEditor>;
    do {
      hooks.changed = false;
      hooks.slot = 0;
      hooks.effects = [];
      // biome-ignore lint/correctness/useHookAtTopLevel: this loop simulates native renders with stable hook cells.
      editor = useNoteEditor(ctl as unknown as NotesController);
      for (const effect of hooks.effects) effect();
    } while (hooks.changed);
    return editor;
  };
  return { ctl, render };
}

it("keeps the replacement hint through failed saves and clears it with Saved only after success", async () => {
  const { ctl, render } = setup();
  expect(render().dirty).toBe(false);
  render().setBody("My version");
  ctl.detail = {
    id: "note",
    revision: 2,
    title: "Plan",
    body: "Remote version",
    folderId: null,
    tagIds: [],
  };
  expect(render().reloadPrompt).toBe(true);
  render().keepMyVersion();
  expect(render()).toMatchObject({
    reloadPrompt: false,
    replacingNewerVersion: true,
    saved: false,
    body: "My version",
  });
  ctl.mutations.updateNote.mockRejectedValueOnce(new Error("Permission denied"));
  render().save();
  await vi.waitFor(() => expect(ctl.setError).toHaveBeenCalledWith("Permission denied"));
  expect(render()).toMatchObject({ replacingNewerVersion: true, saved: false, dirty: true });
  render().save();
  await vi.waitFor(() => expect(render().saved).toBe(true));
  expect(ctl.mutations.updateNote).toHaveBeenLastCalledWith(
    expect.objectContaining({ revision: 2, body: "My version" }),
  );
  expect(render()).toMatchObject({
    reloadPrompt: false,
    replacingNewerVersion: false,
    dirty: false,
  });
});

it("uses shared discard wording and preserves edits when Keep editing is selected", () => {
  const { ctl, render } = setup();
  render().setBody("Unsaved");
  render().backToList();
  expect(ctl.backToList).not.toHaveBeenCalled();
  expect(hooks.alert).toHaveBeenCalledWith("Discard unsaved changes?", expect.any(String), [
    { text: "Keep editing", style: "cancel" },
    { text: "Discard changes", style: "destructive", onPress: expect.any(Function) },
  ]);
  expect(render().body).toBe("Unsaved");
});

it("opens an existing note read-only and returns to viewing after a save", async () => {
  const { render } = setup();
  expect(render().editing).toBe(false);

  render().setEditing(true);
  expect(render().editing).toBe(true);

  render().setBody("Edited");
  render().save();
  await vi.waitFor(() => expect(render().saved).toBe(true));
  expect(render().editing).toBe(false);
});

it("opens a new note straight into editing", () => {
  const { render } = setup({ selectedId: null, detail: false });
  expect(render().editing).toBe(true);
});

it("ignores a second save tap while the first write is still in flight", async () => {
  const { ctl, render } = setup({ selectedId: "note" });
  let finish: ((revision: number) => void) | undefined;
  ctl.mutations.updateNote.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  render().setEditing(true);
  render().setBody("Edited");
  const editor = render();
  editor.save();
  // A second tap before the busy state renders must not queue another write.
  editor.save();
  expect(ctl.mutations.updateNote).toHaveBeenCalledTimes(1);
  finish?.(4);
  await vi.waitFor(() => expect(render().saved).toBe(true));
  expect(ctl.mutations.updateNote).toHaveBeenCalledTimes(1);
});

it("keeps a newer body editable when a deferred save of the previous body succeeds", async () => {
  const { ctl, render } = setup({ selectedId: "note" });
  let finish: ((revision: number) => void) | undefined;
  ctl.mutations.updateNote.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  render().setEditing(true);
  render().setBody("Body A submitted");
  render().save();
  // The request is in flight and the field stays editable.
  render().setBody("Body B typed while saving");

  finish?.(2);
  await vi.waitFor(() => expect(render().saved).toBe(true));

  // The reader must not present the newer, unsaved body as the stored note.
  expect(render()).toMatchObject({
    editing: true,
    body: "Body B typed while saving",
    dirty: true,
  });

  // The retained draft can still be saved, based on the revision just written.
  render().save();
  await vi.waitFor(() => expect(ctl.mutations.updateNote).toHaveBeenCalledTimes(2));
  expect(ctl.mutations.updateNote).toHaveBeenLastCalledWith(
    expect.objectContaining({ revision: 2, body: "Body B typed while saving" }),
  );
  await vi.waitFor(() => expect(render()).toMatchObject({ editing: false, dirty: false }));
});

it("keeps a newer title and property edit editable after a deferred save", async () => {
  const { ctl, render } = setup({ selectedId: "note" });
  let finish: ((revision: number) => void) | undefined;
  ctl.mutations.updateNote.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  render().setEditing(true);
  render().setTitle("Submitted title");
  render().setFolderId("folder-1");
  render().setTagIds(["tag-1"]);
  render().save();

  render().setTitle("Newer title");
  render().setFolderId("folder-2");
  render().setTagIds(["tag-2"]);

  finish?.(2);
  await vi.waitFor(() => expect(render().saved).toBe(true));

  expect(render()).toMatchObject({
    editing: true,
    title: "Newer title",
    folderId: "folder-2",
    tagIds: ["tag-2"],
    dirty: true,
  });
});

it("does not rebase a note the person switched to while a save was finishing", async () => {
  const { ctl, render } = setup({ selectedId: "note" });
  let finish: ((revision: number) => void) | undefined;
  ctl.mutations.updateNote.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  render().setEditing(true);
  render().setBody("Edited on the first note");
  render().save();

  ctl.selectedId = "other";
  ctl.detail = {
    id: "other",
    revision: 9,
    title: "Other",
    body: "Other body",
    folderId: null,
    tagIds: [],
  };
  expect(render()).toMatchObject({ title: "Other", body: "Other body", editing: false });

  finish?.(4);
  // Let the save's continuation run before checking it left the new note alone.
  await Promise.resolve();
  await Promise.resolve();
  expect(render()).toMatchObject({
    title: "Other",
    body: "Other body",
    editing: false,
    saved: false,
    dirty: false,
  });
  expect(ctl.setError).not.toHaveBeenCalled();
});

it("hides the save action while reading and restores it when editing", () => {
  const { ctl, render } = setup({ selectedId: "note" });
  ctl.permissions = { edit: true, remove: true };
  const ids = (editable: boolean) =>
    editorActions(ctl as unknown as NotesController, render(), editable).map((action) => action.id);
  expect(ids(false)).toEqual(["history", "archive", "delete"]);
  expect(ids(true)).toEqual(["save", "history", "archive", "delete"]);
});

function confirmDiscard(): void {
  const actions = hooks.alert.mock.calls[0]?.[2] as
    | Array<{ text: string; onPress?: () => void }>
    | undefined;
  actions?.find((action) => action.text === "Discard changes")?.onPress?.();
}

it("drops a discarded draft so reopening the same note shows the saved text", () => {
  const { ctl, render } = setup();
  if (ctl.detail === undefined) throw new Error("expected a loaded note");
  const saved = { ...ctl.detail };
  render().setBody("Unsaved body");
  render().backToList();
  confirmDiscard();
  expect(ctl.backToList).toHaveBeenCalledTimes(1);

  // The retained editor hook outlives the editor screen. While the list shows,
  // the detail query is skipped, then reopening the same revision loads it.
  ctl.detail = undefined;
  render();
  ctl.detail = saved;
  expect(render()).toMatchObject({ body: "Original", title: "Plan", dirty: false });
});

it("drops a discarded draft before opening history, so Back from history is clean", () => {
  const { ctl, render } = setup();
  if (ctl.detail === undefined) throw new Error("expected a loaded note");
  const saved = { ...ctl.detail };
  render().setBody("Unsaved body");
  render().openHistory("note");
  confirmDiscard();
  expect(ctl.openHistory).toHaveBeenCalledWith("note");

  // History -> Back returns to the retained editor without a new detail fetch.
  ctl.detail = saved;
  expect(render()).toMatchObject({ body: "Original", dirty: false });
});
