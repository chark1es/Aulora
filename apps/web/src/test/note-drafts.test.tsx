import { Permission } from "@aulora/core";
import { act, render, renderHook, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";
import { NoteEditor } from "../components/notes/NoteEditor";
import { useNotes } from "../components/notes/use-notes";
import { useBeforeUnload } from "../lib/use-before-unload";

const store = vi.hoisted(() => ({
  notes: [
    {
      id: "A",
      revision: 1,
      title: "A",
      body: "A body",
      folderId: null,
      tagIds: [],
      archived: false,
    },
    {
      id: "B",
      revision: 1,
      title: "B",
      body: "B body",
      folderId: null,
      tagIds: [],
      archived: false,
    },
  ],
  create: vi.fn().mockResolvedValue("C"),
  update: vi.fn().mockResolvedValue(2),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: { noteId?: string } | "skip") => {
    if (args === "skip") return undefined;
    switch (getFunctionName(ref)) {
      case "workspaceNotes:overview":
        return { notes: store.notes, folders: [], tags: [] };
      case "workspaceNotes:get":
        return store.notes.find((note) => note.id === args.noteId);
      default:
        return undefined;
    }
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "workspaceNotes:updateNote"
      ? store.update
      : getFunctionName(ref) === "workspaceNotes:createNote"
        ? store.create
        : vi.fn(),
}));

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a seeded note");
  return value;
}

beforeEach(() => {
  store.notes[0] = { ...required(store.notes[0]), revision: 1, title: "A", body: "A body" };
  store.update.mockClear();
});

function setup() {
  const hook = renderHook(() =>
    useNotes({
      ownUserId: "me",
      permissions: Permission.ViewNotes | Permission.EditNotes | Permission.CreateNotes,
      members: [],
      onBack: vi.fn(),
    }),
  );
  act(() => hook.result.current.openNote("A" as never));
  act(() => {
    hook.result.current.setEditing(true);
    hook.result.current.setDraft({ ...required(hook.result.current.draft), title: "A draft" });
  });
  return hook;
}

it("guards A to B navigation and seeds B without leaking A's draft into its save", async () => {
  const { result } = setup();
  act(() => result.current.openNote("B" as never));
  expect(result.current.noteId).toBe("A");
  expect(result.current.navigation.pending).not.toBeNull();
  act(() => result.current.navigation.cancel());
  expect(result.current.draft?.title).toBe("A draft");
  act(() => result.current.openNote("B" as never));
  act(() => result.current.navigation.discard());
  expect(result.current.draft).toMatchObject({ title: "B", body: "B body" });
  act(() => result.current.setDraft({ ...required(result.current.draft), title: "B draft" }));
  await act(() => result.current.saveNote());
  expect(store.update).toHaveBeenCalledWith(
    expect.objectContaining({
      noteId: "B",
      title: "B draft",
      body: "B body",
    }),
  );
});

type NotesHook = ReturnType<typeof setup>["result"]["current"];
const guardedNavigations: readonly (readonly [string, (notes: NotesHook) => void])[] = [
  [
    "closeNote",
    (notes) => {
      notes.closeNote();
    },
  ],
  ["openFolder", (notes) => notes.openFolder(undefined)],
  ["onBack", (notes) => notes.onBack()],
];

it.each(guardedNavigations)("guards dirty %s navigation", (_name, navigate) => {
  const { result } = setup();
  act(() => {
    navigate(result.current);
  });
  expect(result.current.navigation.pending).not.toBeNull();
  expect(result.current.noteId).toBe("A");
});

it("saves against the seed revision and explicitly rebases without changing local fields", async () => {
  const { result, rerender } = setup();
  store.notes[0] = { ...required(store.notes[0]), revision: 2, title: "Remote title" };
  rerender();
  expect(result.current.draft?.title).toBe("A draft");
  expect(result.current.conflict).toBe(true);
  store.update.mockRejectedValueOnce(new Error("The note changed"));
  await act(() => result.current.saveNote());
  expect(store.update).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1 }));
  act(() => result.current.overwriteWithMyVersion());
  expect(result.current.conflict).toBe(false);
  expect(result.current.replacingNewerVersion).toBe(true);
  expect(result.current.draft?.title).toBe("A draft");
  store.update.mockRejectedValueOnce(new Error("Offline"));
  await act(() => result.current.saveNote());
  expect(result.current.replacingNewerVersion).toBe(true);
  await act(() => result.current.saveNote());
  expect(store.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ revision: 2, title: "A draft" }),
  );
  expect(result.current.dirty).toBe(false);
  expect(result.current.replacingNewerVersion).toBe(false);
});

it("reloads the latest remote content and clears dirty state", () => {
  const { result, rerender } = setup();
  store.notes[0] = { ...required(store.notes[0]), revision: 2, title: "Remote title" };
  rerender();
  act(() => result.current.reloadLatest());
  expect(result.current.draft?.title).toBe("A draft");
  expect(result.current.navigation.pending).not.toBeNull();
  act(() => result.current.navigation.cancel());
  expect(result.current.draft?.title).toBe("A draft");
  act(() => result.current.reloadLatest());
  act(() => result.current.navigation.discard());
  expect(result.current.draft?.title).toBe("Remote title");
  expect(result.current.dirty).toBe(false);
});

it("registers beforeunload only while dirty and removes it on unmount", () => {
  const { rerender, unmount } = renderHook(({ dirty }) => useBeforeUnload(dirty), {
    initialProps: { dirty: false },
  });
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(unload()).toBe(false);
  rerender({ dirty: true });
  expect(unload()).toBe(true);
  rerender({ dirty: false });
  expect(unload()).toBe(false);
  rerender({ dirty: true });
  unmount();
  expect(unload()).toBe(false);
});

it("preserves typing that happens while an earlier save is pending", async () => {
  const { result } = setup();
  let finish: (revision: number) => void = () => undefined;
  store.update.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  let saving: Promise<void> | undefined;
  act(() => {
    saving = result.current.saveNote();
  });
  act(() =>
    result.current.setDraft({ ...required(result.current.draft), body: "Typed during save" }),
  );
  await act(async () => {
    finish(2);
    await saving;
  });
  expect(result.current.draft?.body).toBe("Typed during save");
  expect(result.current.dirty).toBe(true);
  expect(result.current.editing).toBe(true);
});

it("renders the saved draft before its server subscription catches up", async () => {
  const { result } = setup();
  await act(() => result.current.saveNote());
  expect(result.current.editing).toBe(false);
  expect(result.current.detail?.title).toBe("A");
  render(<NoteEditor ctl={result.current} />);
  expect(screen.getByRole("heading", { name: "A draft" })).toBeInTheDocument();
});

it.each(["openNote", "closeNote", "openFolder", "createNote"] as const)(
  "clears the replacement hint after Keep my version then %s and reopening",
  async (action) => {
    const { result, rerender } = setup();
    store.notes[0] = { ...required(store.notes[0]), revision: 2, title: "Remote title" };
    rerender();
    act(() => result.current.overwriteWithMyVersion());
    expect(result.current.replacingNewerVersion).toBe(true);
    act(() => {
      if (action === "openNote") result.current.openNote("B" as never);
      else if (action === "openFolder") result.current.openFolder(undefined);
      else result.current[action]();
    });
    await act(async () => {
      result.current.navigation.discard();
      await Promise.resolve();
    });
    act(() => result.current.openNote("A" as never));
    expect(result.current.replacingNewerVersion).toBe(false);
  },
);
