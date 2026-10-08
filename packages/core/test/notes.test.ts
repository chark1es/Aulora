import { describe, expect, it } from "vitest";
import {
  diffLines,
  diffStats,
  NoteSearchIndex,
  noteBlocksToPlainText,
  notePlainText,
  parseNoteMarkdown,
} from "../src/notes/index";

describe("parseNoteMarkdown", () => {
  it("parses headings, lists, quotes, rules and paragraphs", () => {
    const blocks = parseNoteMarkdown(
      [
        "# Title",
        "",
        "A paragraph with **bold** and `code`.",
        "",
        "- one",
        "- two",
        "",
        "> quoted",
        "",
        "---",
        "",
        "1. first",
        "2. second",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "blockquote",
      "divider",
      "list",
    ]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    if (blocks[2]?.type === "list") expect(blocks[2].items).toHaveLength(2);
    expect(blocks[5]).toMatchObject({ type: "list", ordered: true });
  });

  it("extracts fenced code with an optional language", () => {
    const blocks = parseNoteMarkdown("before\n```ts\nconst a = 1;\n```\nafter");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "code_block", "paragraph"]);
    expect(blocks[1]).toMatchObject({ type: "code_block", language: "ts", text: "const a = 1;" });
  });

  it("never emits raw markup and round-trips to plain text", () => {
    const blocks = parseNoteMarkdown("<script>alert(1)</script>");
    expect(noteBlocksToPlainText(blocks)).toBe("<script>alert(1)</script>");
    expect(blocks[0]?.type).toBe("paragraph");
  });
});

describe("diffLines", () => {
  it("returns context only for equal text", () => {
    const lines = diffLines("a\nb", "a\nb");
    expect(lines.every((line) => line.type === "context")).toBe(true);
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0 });
  });

  it("marks changed, added and removed lines", () => {
    const lines = diffLines("a\nb\nc", "a\nB\nc\nd");
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
    expect(lines.map((line) => line.type)).toEqual(["context", "del", "add", "context", "add"]);
  });

  it.each([
    ["", "first\nsecond"],
    ["first\nsecond", ""],
    ["a\nb\na\n", "b\na\nb\n"],
    ["one\ntwo\nthree", "three\ntwo\none"],
    ["before", "after"],
  ])("reconstructs both versions from the diff of %j and %j", (before, after) => {
    const lines = diffLines(before, after);
    expect(
      lines
        .filter((line) => line.type !== "add")
        .map((line) => line.text)
        .join("\n"),
    ).toBe(before);
    expect(
      lines
        .filter((line) => line.type !== "del")
        .map((line) => line.text)
        .join("\n"),
    ).toBe(after);
  });

  it("falls back to a coarse diff on very large inputs", () => {
    const before = Array.from({ length: 700 }, (_, i) => `line ${i}`).join("\n");
    const after = `${before}\nextra`;
    const lines = diffLines(before, after);
    expect(lines.at(-1)).toEqual({ type: "add", text: "extra" });
  });

  it("keeps the common prefix and suffix in a large replacement", () => {
    const middle = Array.from({ length: 700 }, (_, i) => `line ${i}`).join("\n");
    const before = `start\n${middle}\nend`;
    const after = `start\nreplacement\n${middle}\nend`;
    const lines = diffLines(before, after);
    expect(lines.at(0)).toEqual({ type: "context", text: "start" });
    expect(lines.at(1)).toEqual({ type: "add", text: "replacement" });
    expect(lines.at(-1)).toEqual({ type: "context", text: "end" });
    expect(diffStats(lines)).toEqual({ added: 1, removed: 0 });
  });
});

describe("NoteSearchIndex", () => {
  it("finds exact and prefix matches and ranks titles higher", () => {
    const index = new NoteSearchIndex();
    index.upsert({ id: "a", title: "Release checklist", body: "ship the release", updatedAt: 1 });
    index.upsert({ id: "b", title: "Random", body: "release notes mention", updatedAt: 2 });
    const hits = index.query("rele");
    expect(hits.map((hit) => hit.id)).toEqual(["a", "b"]);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it("removes and replaces documents", () => {
    const index = new NoteSearchIndex();
    index.upsert({ id: "a", title: "Alpha", body: "", updatedAt: 1 });
    expect(index.query("alpha")).toHaveLength(1);
    index.upsert({ id: "a", title: "Beta", body: "", updatedAt: 2 });
    expect(index.query("alpha")).toHaveLength(0);
    expect(index.query("beta")).toHaveLength(1);
    index.remove("a");
    expect(index.size).toBe(0);
    expect(index.query("beta")).toHaveLength(0);
  });

  it("returns an empty result for blank queries", () => {
    const index = new NoteSearchIndex();
    index.upsert({ id: "a", title: "Alpha", body: "", updatedAt: 1 });
    expect(index.query("   ")).toEqual([]);
  });
});

describe("notePlainText", () => {
  it("joins title and body for indexing", () => {
    expect(notePlainText("Title", "Body")).toBe("Title\nBody");
  });
});
