import { describe, expect, it } from "vitest";
import { inlineToPlainText, mentionsViewer, parseInline, parseRichText } from "../src/index";

describe("parseRichText blocks", () => {
  it("returns one paragraph for plain text", () => {
    expect(parseRichText("hello world")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "hello world" }] },
    ]);
  });

  it("returns nothing for empty or whitespace-only newlines", () => {
    expect(parseRichText("")).toEqual([]);
    expect(parseRichText("\n\n")).toEqual([]);
  });

  it("splits fenced code blocks and keeps the language hint", () => {
    const blocks = parseRichText("before\n```ts\nconst a = 1;\n```\nafter");
    expect(blocks).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "before" }] },
      { type: "code_block", language: "ts", text: "const a = 1;" },
      { type: "paragraph", children: [{ type: "text", text: "after" }] },
    ]);
  });

  it("does not format inside code blocks", () => {
    const [block] = parseRichText("```\n**not bold** @here\n```");
    expect(block).toEqual({ type: "code_block", language: null, text: "**not bold** @here" });
  });

  it("leaves an unterminated fence as text", () => {
    const [block] = parseRichText("```oops");
    expect(block).toEqual({ type: "paragraph", children: [{ type: "text", text: "```oops" }] });
  });
});

describe("parseInline", () => {
  it("parses inline code without formatting its contents", () => {
    expect(parseInline("run `**x**` now")).toEqual([
      { type: "text", text: "run " },
      { type: "code", text: "**x**" },
      { type: "text", text: " now" },
    ]);
  });

  it("parses bold and italic, including nesting", () => {
    expect(parseInline("**bold _and italic_** plain")).toEqual([
      {
        type: "bold",
        children: [
          { type: "text", text: "bold " },
          { type: "italic", children: [{ type: "text", text: "and italic" }] },
        ],
      },
      { type: "text", text: " plain" },
    ]);
  });

  it("does not treat snake_case or arithmetic as italics", () => {
    expect(parseInline("my_var_name and 2 * 3 * 4")).toEqual([
      { type: "text", text: "my_var_name and 2 * 3 * 4" },
    ]);
  });

  it("links http(s) URLs and drops trailing punctuation", () => {
    expect(parseInline("see https://aulora.app/docs.")).toEqual([
      { type: "text", text: "see " },
      { type: "link", href: "https://aulora.app/docs", text: "https://aulora.app/docs" },
      { type: "text", text: "." },
    ]);
  });

  it("never links other schemes", () => {
    expect(parseInline("javascript:alert(1)")).toEqual([
      { type: "text", text: "javascript:alert(1)" },
    ]);
  });
});

describe("mentions", () => {
  const options = { mentionNames: ["Ada", "Ada Lovelace", "design-team"] };

  it("matches the longest known name, including names with spaces", () => {
    const [block] = parseRichText("hi @Ada Lovelace!", options);
    expect(block).toEqual({
      type: "paragraph",
      children: [
        { type: "text", text: "hi " },
        { type: "mention", name: "Ada Lovelace", broadcast: false },
        { type: "text", text: "!" },
      ],
    });
  });

  it("recognises broadcasts and ignores unknown names and emails", () => {
    const [block] = parseRichText("@here ping @nobody and ada@example.com", options);
    expect(block?.type === "paragraph" ? block.children : []).toEqual([
      { type: "mention", name: "here", broadcast: true },
      { type: "text", text: " ping @nobody and ada@example.com" },
    ]);
  });

  it("detects when the viewer is mentioned", () => {
    expect(mentionsViewer(parseRichText("hey @Ada", options), "ada")).toBe(true);
    expect(mentionsViewer(parseRichText("**@everyone** look", options), "Bob")).toBe(true);
    expect(mentionsViewer(parseRichText("hey @design-team", options), "Ada")).toBe(false);
  });
});

describe("inlineToPlainText", () => {
  it("strips formatting markers", () => {
    const [block] = parseRichText("**hi** _there_ `x` @here", { mentionNames: [] });
    expect(block?.type === "paragraph" ? inlineToPlainText(block.children) : "").toBe(
      "hi there x @here",
    );
  });
});
