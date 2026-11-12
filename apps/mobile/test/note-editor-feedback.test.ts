import { beforeEach, expect, it, vi } from "vitest";
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
    mutations: { updateNote: vi.fn(async () => 3) },
    setError: vi.fn(),
    backToList: vi.fn(),
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
