/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NoteEditor } from "../components/notes/NoteEditor";
import type { NotesController } from "../components/notes/use-notes";

interface Draft {
  title: string;
  body: string;
  folderId: string | null;
  tagIds: string[];
}

const START: Draft = { title: "Roadmap", body: "", folderId: null, tagIds: [] };

/** A stub Notes controller shared by the editor tests, with no Convex involved. */
function makeController(
  draft: Draft,
  setDraft: (next: Draft) => void,
  overrides: Partial<NotesController>,
): NotesController {
  const base = {
    draft,
    detail: { id: "note-1", revision: 1, folderId: draft.folderId, title: draft.title, tagIds: [] },
    editing: true,
    canEdit: true,
    canCreate: true,
    canDelete: true,
    canManage: true,
    canView: true,
    dirty: true,
    busy: false,
    error: undefined,
    folders: [
      { id: "folder-1", name: "Ideas", parentId: null, position: 0 },
      { id: "folder-2", name: "Nested", parentId: "folder-1", position: 0 },
    ],
    tags: [],
    setDraft,
    setFolderDialog: vi.fn(),
    setTagDialog: vi.fn(),
    saveNote: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides } as unknown as NotesController;
}

/** Holds the draft in state so `setDraft` re-renders the editor, as in the app. */
function Harness({
  overrides = {},
  initial = START,
}: {
  overrides?: Partial<NotesController>;
  initial?: Draft;
}) {
  const [draft, setDraft] = useState(initial);
  const ctl = useMemo(() => makeController(draft, setDraft, overrides), [draft, overrides]);
  return <NoteEditor ctl={ctl} />;
}

/** The body textbox; read-only views have none, so only the editing view must find it. */
function noteBody(editing: boolean) {
  const found = screen.queryByRole("textbox", { name: "Note body" });
  if (found instanceof HTMLTextAreaElement) return found;
  if (editing) throw new Error("The note body textbox is missing");
  return document.createElement("textarea");
}

function renderEditor(options: { overrides?: Partial<NotesController>; initial?: Draft } = {}) {
  const view = render(<Harness {...options} />);
  const editing = options.overrides?.editing ?? true;
  const field = noteBody(editing);
  return { view, body: field, value: () => field.value };
}

function typeBody(body: HTMLTextAreaElement, value: string, caret = value.length) {
  fireEvent.change(body, { target: { value, selectionStart: caret, selectionEnd: caret } });
  return body;
}

function select(body: HTMLTextAreaElement, start: number, end: number) {
  body.focus();
  body.setSelectionRange(start, end);
  fireEvent.select(body);
}

describe("NoteEditor toolbar", () => {
  it("shows the platform shortcut in each toolbar tooltip", () => {
    renderEditor();
    for (const [name, shortcut] of [
      ["Bold", /^Bold \((⌘B|Ctrl\+B)\)$/],
      ["Italic", /^Italic \((⌘I|Ctrl\+I)\)$/],
      ["Link", /^Link \((⌘K|Ctrl\+K)\)$/],
      ["Code", /^Code \((⌘E|Ctrl\+E)\)$/],
      ["Undo", /^Undo \((⌘Z|Ctrl\+Z)\)$/],
      ["Redo", /^Redo \((⌘⇧Z|Ctrl\+Shift\+Z)\)$/],
    ] as const) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "title",
        expect.stringMatching(shortcut),
      );
    }
  });

  it("toggles bold on and off from the toolbar, keeping the selection", async () => {
    const user = userEvent.setup();
    const editor = renderEditor();
    typeBody(editor.body, "hello world");
    select(editor.body, 0, 5);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(editor.value()).toBe("**hello** world");
    expect(editor.body.selectionStart).toBe(2);
    expect(editor.body.selectionEnd).toBe(7);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(editor.value()).toBe("hello world");
    expect(editor.body.selectionStart).toBe(0);
    expect(editor.body.selectionEnd).toBe(5);
  });

  it("toggles bold with Cmd/Ctrl+B on an empty selection", () => {
    const editor = renderEditor();
    typeBody(editor.body, "hi", 2);
    fireEvent.keyDown(editor.body, { key: "b", code: "KeyB", metaKey: true });
    expect(editor.value()).toBe("hi**bold**");
    expect(editor.value().slice(editor.body.selectionStart, editor.body.selectionEnd)).toBe("bold");
    fireEvent.keyDown(editor.body, { key: "b", code: "KeyB", metaKey: true });
    expect(editor.value()).toBe("hi");
  });

  it("converts a bullet list to numbered instead of stacking", async () => {
    const user = userEvent.setup();
    const editor = renderEditor();
    typeBody(editor.body, "one\ntwo");
    select(editor.body, 0, 7);
    await user.click(screen.getByRole("button", { name: "Bullet list" }));
    expect(editor.value()).toBe("- one\n- two");
    await user.click(screen.getByRole("button", { name: "Numbered list" }));
    expect(editor.value()).toBe("1. one\n2. two");
    await user.click(screen.getByRole("button", { name: "Numbered list" }));
    expect(editor.value()).toBe("one\ntwo");
  });

  it("cycles a heading through #, ##, ### and off", async () => {
    const user = userEvent.setup();
    const editor = renderEditor();
    typeBody(editor.body, "Title");
    select(editor.body, 0, 5);
    const heading = screen.getByRole("button", { name: "Heading" });
    await user.click(heading);
    expect(editor.value()).toBe("# Title");
    await user.click(heading);
    expect(editor.value()).toBe("## Title");
    await user.click(heading);
    expect(editor.value()).toBe("### Title");
    await user.click(heading);
    expect(editor.value()).toBe("Title");
  });

  it("applies an exact heading with Cmd/Ctrl+Alt+2", () => {
    const editor = renderEditor();
    typeBody(editor.body, "Title", 0);
    fireEvent.keyDown(editor.body, { key: "2", code: "Digit2", altKey: true, ctrlKey: true });
    expect(editor.value()).toBe("## Title");
  });

  it("indents and outdents list lines with Tab", () => {
    const editor = renderEditor();
    typeBody(editor.body, "- one", 5);
    fireEvent.keyDown(editor.body, { key: "Tab" });
    expect(editor.value()).toBe("  - one");
    fireEvent.keyDown(editor.body, { key: "Tab", shiftKey: true });
    expect(editor.value()).toBe("- one");
  });

  it("continues a list on Enter and ends it on an empty item", () => {
    const editor = renderEditor();
    typeBody(editor.body, "- one", 5);
    fireEvent.keyDown(editor.body, { key: "Enter" });
    expect(editor.value()).toBe("- one\n- ");
    fireEvent.keyDown(editor.body, { key: "Enter" });
    expect(editor.value()).toBe("- one\n");
  });

  it("saves with Cmd/Ctrl+S when the note is dirty", () => {
    const saveNote = vi.fn().mockResolvedValue(undefined);
    const editor = renderEditor({ overrides: { saveNote } });
    typeBody(editor.body, "changed");
    fireEvent.keyDown(editor.body, { key: "s", code: "KeyS", ctrlKey: true });
    expect(saveNote).toHaveBeenCalled();
  });

  it("undoes and redoes toolbar actions and typing", async () => {
    const user = userEvent.setup();
    const editor = renderEditor();
    typeBody(editor.body, "hello");
    select(editor.body, 0, 5);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(editor.value()).toBe("**hello**");

    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();
    await user.click(undo);
    expect(editor.value()).toBe("hello");
    expect(redo).toBeEnabled();
    await user.click(redo);
    expect(editor.value()).toBe("**hello**");
  });

  it("coalesces rapid typing into one undo step", () => {
    const editor = renderEditor();
    typeBody(editor.body, "h", 1);
    typeBody(editor.body, "he", 2);
    typeBody(editor.body, "hel", 3);
    expect(editor.value()).toBe("hel");
    fireEvent.keyDown(editor.body, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(editor.value()).toBe("");
  });

  it("handles the native Edit menu's historyUndo/historyRedo", async () => {
    const user = userEvent.setup();
    const editor = renderEditor();
    typeBody(editor.body, "typed");
    select(editor.body, 0, 5);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(editor.value()).toBe("**typed**");
    fireEvent(
      editor.body,
      new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true }),
    );
    expect(editor.value()).toBe("typed");
    fireEvent(
      editor.body,
      new InputEvent("beforeinput", { inputType: "historyRedo", bubbles: true, cancelable: true }),
    );
    expect(editor.value()).toBe("**typed**");
  });

  it("disables the toolbar and body without edit permission", () => {
    const editor = renderEditor({ overrides: { canEdit: false } });
    expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
    expect(editor.body).toBeDisabled();
  });

  it("shows the folder tree indented and offers a New folder action", async () => {
    const user = userEvent.setup();
    const setFolderDialog = vi.fn();
    renderEditor({ overrides: { setFolderDialog } });
    await user.click(screen.getByRole("button", { name: "No folder" }));
    const nested = await screen.findByRole("option", { name: "Nested" });
    expect(nested).toHaveStyle({ paddingLeft: "20px" });
    expect(nested).toHaveAttribute("title", "Ideas / Nested");
    await user.click(screen.getByRole("option", { name: "New folder…" }));
    expect(setFolderDialog).toHaveBeenCalledWith({ mode: "new", parentId: null });
  });

  it("hides the New folder action without create permission", async () => {
    const user = userEvent.setup();
    renderEditor({ overrides: { canCreate: false } });
    await user.click(screen.getByRole("button", { name: "No folder" }));
    expect(screen.queryByRole("option", { name: "New folder…" })).not.toBeInTheDocument();
  });

  it("shows the title only in the input during Preview mode", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("textbox", { name: "Note title" })).toHaveValue("Roadmap");
    expect(screen.queryByRole("heading", { name: "Roadmap" })).not.toBeInTheDocument();
  });
});

describe("NoteEditor read-only preview", () => {
  it("prints the title exactly once", () => {
    renderEditor({ overrides: { editing: false } });
    expect(screen.getAllByRole("heading", { name: "Roadmap" })).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Note title" })).not.toBeInTheDocument();
  });

  it("falls back to Untitled note for a blank title", () => {
    renderEditor({
      overrides: { editing: false },
      initial: { title: "  ", body: "hello", folderId: null, tagIds: [] },
    });
    expect(screen.getAllByRole("heading", { name: "Untitled note" })).toHaveLength(1);
  });
});
