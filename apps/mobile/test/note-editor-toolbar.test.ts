import { describe, expect, it } from "vitest";
import {
  NOTE_FORMATS,
  runNoteFormat,
  runNoteHeading,
} from "../src/components/notes/editor-toolbar";

describe("NOTE_FORMATS", () => {
  it("lists a labelled, iconic button per action", () => {
    expect(NOTE_FORMATS.map((spec) => spec.id)).toEqual([
      "bold",
      "italic",
      "heading",
      "bulletList",
      "orderedList",
      "code",
    ]);
    for (const spec of NOTE_FORMATS) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("runNoteFormat", () => {
  it("wraps the selection and unwraps it on a second tap", () => {
    const first = runNoteFormat("bold", "hello world", 0, 5);
    expect(first.text).toBe("**hello** world");
    const second = runNoteFormat("bold", first.text, first.start, first.end);
    expect(second.text).toBe("hello world");
  });

  it("uses a selected placeholder when there is no selection", () => {
    const first = runNoteFormat("italic", "hi", 2, 2);
    expect(first.text).toBe("hi*italic*");
    const second = runNoteFormat("italic", first.text, first.start, first.end);
    expect(second.text).toBe("hi");
  });

  it("converts between bullet and numbered lists", () => {
    expect(runNoteFormat("bulletList", "a\nb", 0, 3).text).toBe("- a\n- b");
    expect(runNoteFormat("orderedList", "- a\n- b", 0, 7).text).toBe("1. a\n2. b");
    expect(runNoteFormat("bulletList", "1. a\n2. b", 0, 10).text).toBe("- a\n- b");
  });

  it("cycles headings off after ###", () => {
    const one = runNoteFormat("heading", "Title", 0, 5);
    const two = runNoteFormat("heading", one.text, 0, one.text.length);
    const three = runNoteFormat("heading", two.text, 0, two.text.length);
    const off = runNoteFormat("heading", three.text, 0, three.text.length);
    expect([one.text, two.text, three.text, off.text]).toEqual([
      "# Title",
      "## Title",
      "### Title",
      "Title",
    ]);
  });
});

describe("runNoteHeading", () => {
  it("applies an exact level", () => {
    expect(runNoteHeading("Title", 0, 5, 2).text).toBe("## Title");
  });
});
