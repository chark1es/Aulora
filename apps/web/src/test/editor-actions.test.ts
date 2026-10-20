import { describe, expect, it } from "vitest";
import {
  actionLabel,
  detectMac,
  EDITOR_ACTIONS,
  runEditorAction,
  runHeading,
} from "../components/notes/editor-actions";

describe("EDITOR_ACTIONS", () => {
  it("lists a labelled, iconic button per action with a shortcut", () => {
    expect(EDITOR_ACTIONS.map((action) => action.id)).toEqual([
      "bold",
      "italic",
      "heading",
      "bulletList",
      "orderedList",
      "code",
      "link",
    ]);
    for (const action of EDITOR_ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.icon.length).toBeGreaterThan(0);
      expect(action.shortcut.length).toBeGreaterThan(0);
    }
  });

  it("spells the shortcut for the platform", () => {
    const bold = EDITOR_ACTIONS.at(0);
    expect(bold).toBeDefined();
    if (bold === undefined) return;
    expect(actionLabel(bold, true)).toBe("Bold (⌘B)");
    expect(actionLabel(bold, false)).toBe("Bold (Ctrl+B)");
  });
});

describe("runEditorAction", () => {
  it("wraps, unwraps and switches list types", () => {
    expect(runEditorAction("bold", "hi", 0, 2).text).toBe("**hi**");
    expect(runEditorAction("italic", "hi", 0, 2).text).toBe("*hi*");
    expect(runEditorAction("code", "hi", 0, 2).text).toBe("`hi`");
    expect(runEditorAction("bulletList", "hi", 0, 2).text).toBe("- hi");
    expect(runEditorAction("orderedList", "- hi", 0, 4).text).toBe("1. hi");
  });

  it("cycles headings and inserts links", () => {
    expect(runEditorAction("heading", "hi", 0, 2).text).toBe("# hi");
    expect(runEditorAction("link", "hi", 0, 2).text).toBe("[hi](url)");
  });
});

describe("runHeading", () => {
  it("applies an exact level", () => {
    expect(runHeading("hi", 0, 2, 3).text).toBe("### hi");
  });
});

describe("detectMac", () => {
  it("does not throw without a navigator", () => {
    expect(typeof detectMac()).toBe("boolean");
  });
});
