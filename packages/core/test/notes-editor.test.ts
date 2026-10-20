import { describe, expect, it } from "vitest";
import {
  applyHeading,
  continueList,
  cycleHeading,
  formatShortcut,
  indentLines,
  insertLink,
  NoteEditHistory,
  toggleList,
  toggleWrap,
  typedChangeKind,
} from "../src/notes/index";

/** Applies an edit and returns the resulting document plus the selected text. */
function run(
  edit: { text: string; start: number; end: number },
  check: { readonly text: string; readonly selected: string },
) {
  expect(edit.text).toBe(check.text);
  expect(edit.text.slice(edit.start, edit.end)).toBe(check.selected);
}

describe("toggleWrap with bold and italic together", () => {
  it("turns italic off again on text that is also bold", () => {
    const bold = toggleWrap("hello world", 0, 5, "bold");
    const both = toggleWrap(bold.text, bold.start, bold.end, "italic");
    run(both, { text: "***hello*** world", selected: "hello" });
    const italicOff = toggleWrap(both.text, both.start, both.end, "italic");
    run(italicOff, { text: "**hello** world", selected: "hello" });
    const boldOff = toggleWrap(italicOff.text, italicOff.start, italicOff.end, "bold");
    run(boldOff, { text: "hello world", selected: "hello" });
  });

  it("turns bold off while keeping italic on ***text***", () => {
    const edit = toggleWrap("***hello***", 3, 8, "bold");
    run(edit, { text: "*hello*", selected: "hello" });
  });
});

describe("toggleWrap", () => {
  it("wraps an empty selection and selects the placeholder", () => {
    const edit = toggleWrap("hello", 5, 5, "bold");
    run(edit, { text: "hello**bold**", selected: "bold" });
  });

  it("unwraps the placeholder when clicked twice at the caret", () => {
    const first = toggleWrap("hello", 5, 5, "bold");
    const second = toggleWrap(first.text, first.start, first.end, "bold");
    run(second, { text: "hello", selected: "" });
  });

  it("wraps and unwraps a selected word", () => {
    const first = toggleWrap("hello world", 6, 11, "italic");
    run(first, { text: "hello *world*", selected: "world" });
    const second = toggleWrap(first.text, first.start, first.end, "italic");
    run(second, { text: "hello world", selected: "world" });
  });

  it("removes markers when the selection already includes them", () => {
    const edit = toggleWrap("say **hi** now", 4, 10, "bold");
    run(edit, { text: "say hi now", selected: "hi" });
  });

  it("removes markers when the caret sits inside them", () => {
    const inside = toggleWrap("say **hi** now", 7, 7, "bold");
    run(inside, { text: "say hi now", selected: "" });
  });

  it("treats ** as bold, not two italic markers", () => {
    const edit = toggleWrap("**bold**", 2, 6, "italic");
    run(edit, { text: "***bold***", selected: "bold" });
  });

  it("unwraps a selection that itself carries the markers", () => {
    const edit = toggleWrap("a**bold**b", 1, 9, "bold");
    run(edit, { text: "aboldb", selected: "bold" });
  });

  it("wraps multiple lines in one pair", () => {
    const value = "one\ntwo";
    const edit = toggleWrap(value, 0, value.length, "code");
    run(edit, { text: "`one\ntwo`", selected: "one\ntwo" });
  });
});

describe("toggleList", () => {
  it("adds a bullet to a plain line and removes it again", () => {
    const first = toggleList("milk", 0, 4, false);
    run(first, { text: "- milk", selected: "- milk" });
    const second = toggleList(first.text, 0, first.text.length, false);
    run(second, { text: "milk", selected: "milk" });
  });

  it("numbers each line of a multi-line selection", () => {
    const value = "one\ntwo\nthree";
    const edit = toggleList(value, 0, value.length, true);
    run(edit, { text: "1. one\n2. two\n3. three", selected: "1. one\n2. two\n3. three" });
  });

  it("converts a bullet list to an ordered list rather than stacking", () => {
    const edit = toggleList("- one\n- two", 0, 12, true);
    run(edit, { text: "1. one\n2. two", selected: "1. one\n2. two" });
  });

  it("converts an ordered list back to bullets", () => {
    const edit = toggleList("1. one\n2. two", 0, 12, false);
    run(edit, { text: "- one\n- two", selected: "- one\n- two" });
  });

  it("keeps existing indentation and checkbox state when removing bullets", () => {
    const edit = toggleList("  - [ ] task", 0, "  - [ ] task".length, false);
    run(edit, { text: "  task", selected: "  task" });
  });
});

describe("applyHeading", () => {
  it("adds a heading at the requested level", () => {
    run(applyHeading("Title", 0, 5, 1), { text: "# Title", selected: "# Title" });
    run(applyHeading("Title", 0, 5, 3), { text: "### Title", selected: "### Title" });
  });

  it("replaces an existing heading level", () => {
    run(applyHeading("## Title", 0, 8, 3), { text: "### Title", selected: "### Title" });
  });

  it("removes the heading when the same level is applied twice", () => {
    run(applyHeading("# Title", 0, 7, 1), { text: "Title", selected: "Title" });
  });

  it("applies the level across every selected line", () => {
    const edit = applyHeading("one\ntwo", 0, 7, 2);
    run(edit, { text: "## one\n## two", selected: "## one\n## two" });
  });
});

describe("cycleHeading", () => {
  it("cycles none, #, ##, ### and back to none", () => {
    const once = cycleHeading("Title", 0, 5);
    run(once, { text: "# Title", selected: "# Title" });
    const twice = cycleHeading(once.text, 0, once.text.length);
    run(twice, { text: "## Title", selected: "## Title" });
    const thrice = cycleHeading(twice.text, 0, twice.text.length);
    run(thrice, { text: "### Title", selected: "### Title" });
    const off = cycleHeading(thrice.text, 0, thrice.text.length);
    run(off, { text: "Title", selected: "Title" });
  });
});

describe("indentLines", () => {
  it("indents every selected line by two spaces", () => {
    const value = "one\ntwo";
    const edit = indentLines(value, 0, value.length, 1);
    expect(edit.text).toBe("  one\n  two");
    expect(edit.text.slice(edit.start, edit.end)).toBe("one\n  two");
  });

  it("outdents a single level, never past the margin", () => {
    run(indentLines("  one", 0, 5, -1), { text: "one", selected: "one" });
    run(indentLines("one", 0, 3, -1), { text: "one", selected: "one" });
  });

  it("keeps the caret beside the same character it started next to", () => {
    const edit = indentLines("one\ntwo", 2, 2, 1);
    expect(edit.text).toBe("  one\ntwo");
    expect(edit.start).toBe(4);
    expect(edit.end).toBe(4);
  });
});

describe("continueList", () => {
  it("continues a bullet list with a new bullet", () => {
    const edit = continueList("- one", 5, 5);
    run(edit ?? { text: "- one", start: 5, end: 5 }, { text: "- one\n- ", selected: "" });
    expect(edit?.start).toBe(8);
  });

  it("increments an ordered list item", () => {
    const edit = continueList("3. three", "3. three".length, "3. three".length);
    expect(edit?.text).toBe("3. three\n4. ");
  });

  it("continues a checkbox item", () => {
    const edit = continueList("- [x] done", 10, 10);
    expect(edit?.text).toBe("- [x] done\n- [ ] ");
  });

  it("ends the list when Enter is pressed on an empty item", () => {
    const edit = continueList("- ", 2, 2);
    run(edit ?? { text: "- ", start: 2, end: 2 }, { text: "", selected: "" });
  });

  it("ignores non-list lines so the browser inserts the break", () => {
    expect(continueList("plain text", 10, 10)).toBeNull();
    expect(continueList("# heading", 9, 9)).toBeNull();
    expect(continueList("- one", 2, 5)).toBeNull();
  });
});

describe("insertLink", () => {
  it("wraps the selection and selects the url placeholder", () => {
    const edit = insertLink("see docs", 4, 8);
    run(edit, { text: "see [docs](url)", selected: "url" });
  });

  it("uses a text placeholder with no selection", () => {
    run(insertLink("", 0, 0), { text: "[text](url)", selected: "url" });
  });

  it("unwraps a link the caret sits inside", () => {
    const edit = insertLink("[docs](https://example.com)", 3, 3);
    run(edit, { text: "docs", selected: "docs" });
  });

  it("unwraps a link covered by the selection", () => {
    const edit = insertLink("[docs](https://example.com)", 0, 25);
    run(edit, { text: "docs", selected: "docs" });
  });
});

describe("typedChangeKind", () => {
  it("classifies a single character, whitespace and structural edits", () => {
    expect(typedChangeKind("ab", "abc")).toBe("type");
    expect(typedChangeKind("ab", "axb")).toBe("type");
    expect(typedChangeKind("ab", "ab ")).toBe("word");
    expect(typedChangeKind("ab", "a")).toBe("type");
    expect(typedChangeKind("", "hello")).toBe("word");
  });
});

describe("NoteEditHistory", () => {
  const snapshot = (text: string) => ({ text, start: text.length, end: text.length });

  it("reports whether there is anything to undo or redo", () => {
    const history = new NoteEditHistory();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    history.record(snapshot("a"), "action", 0);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it("steps back through typing, actions and paste", () => {
    const history = new NoteEditHistory();
    history.record(snapshot("a"), "type", 0);
    history.record(snapshot("ab"), "type", 1000);
    history.record(snapshot("abc"), "word", 2000);
    expect(history.undo(snapshot("abcd"))?.text).toBe("abc");
    expect(history.undo(snapshot("abc"))?.text).toBe("ab");
  });

  it("coalesces rapid typing but starts a new step after a pause", () => {
    const history = new NoteEditHistory({ coalesceMs: 500 });
    history.record(snapshot("a"), "type", 0);
    history.record(snapshot("ab"), "type", 100);
    history.record(snapshot("abc"), "type", 200);
    expect(history.undo(snapshot("abcd"))?.text).toBe("a");
    history.record(snapshot("abcd"), "type", 5000);
    expect(history.undo(snapshot("abcde"))?.text).toBe("abcd");
  });

  it("redoes what it undid", () => {
    const history = new NoteEditHistory();
    history.record(snapshot("a"), "action", 0);
    history.record(snapshot("ab"), "action", 10);
    expect(history.undo(snapshot("abc"))?.text).toBe("ab");
    const redone = history.redo(snapshot("ab"));
    expect(redone?.text).toBe("abc");
    expect(history.canRedo).toBe(false);
  });

  it("drops the redo stack once a new edit is recorded", () => {
    const history = new NoteEditHistory();
    history.record(snapshot("a"), "action", 0);
    history.undo(snapshot("ab"));
    expect(history.canRedo).toBe(true);
    history.record(snapshot("a"), "type", 1000);
    expect(history.canRedo).toBe(false);
  });

  it("caps the number of undo steps", () => {
    const history = new NoteEditHistory({ limit: 2 });
    history.record(snapshot("a"), "action", 0);
    history.record(snapshot("b"), "action", 1);
    history.record(snapshot("c"), "action", 2);
    expect(history.undo(snapshot("d"))?.text).toBe("c");
    expect(history.undo(snapshot("c"))?.text).toBe("b");
    expect(history.undo(snapshot("b"))).toBeUndefined();
  });

  it("forgets everything on reset, e.g. when switching notes", () => {
    const history = new NoteEditHistory();
    history.record(snapshot("a"), "action", 0);
    history.reset();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});

describe("formatShortcut", () => {
  it("uses mac symbols on macOS", () => {
    expect(formatShortcut(["Mod", "B"], true)).toBe("⌘B");
    expect(formatShortcut(["Mod", "Shift", "7"], true)).toBe("⌘⇧7");
  });

  it("spells out Ctrl and Shift elsewhere", () => {
    expect(formatShortcut(["Mod", "B"], false)).toBe("Ctrl+B");
    expect(formatShortcut(["Mod", "Alt", "1"], false)).toBe("Ctrl+Alt+1");
  });
});
