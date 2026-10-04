import { describe, expect, it } from "vitest";
import { highlightParts, recentSearchKey } from "../src/lib/search-ui";

describe("highlightParts", () => {
  it("marks each query word wherever it appears, ignoring case", () => {
    expect(highlightParts("Coffee run at 3?", "coffee")).toEqual([
      { text: "Coffee", match: true },
      { text: " run at 3?", match: false },
    ]);
    expect(highlightParts("grab a coffee, then run", "run coffee")).toEqual([
      { text: "grab a ", match: false },
      { text: "coffee", match: true },
      { text: ", then ", match: false },
      { text: "run", match: true },
    ]);
  });

  it("treats pattern characters in the query as plain text", () => {
    expect(highlightParts("cost is (a+)+ today", "(a+)+")).toEqual([
      { text: "cost is ", match: false },
      { text: "(a+)+", match: true },
      { text: " today", match: false },
    ]);
  });

  it("leaves the text whole when nothing can match", () => {
    expect(highlightParts("hello", "")).toEqual([{ text: "hello", match: false }]);
    expect(highlightParts("hello", "x")).toEqual([{ text: "hello", match: false }]);
    expect(highlightParts("", "hello")).toEqual([]);
  });
});

describe("recentSearchKey", () => {
  it("separates servers and accounts", () => {
    expect(recentSearchKey("https://a.example", "u1")).not.toBe(
      recentSearchKey("https://b.example", "u1"),
    );
    expect(recentSearchKey("https://a.example", "u1")).not.toBe(
      recentSearchKey("https://a.example", "u2"),
    );
  });
});
