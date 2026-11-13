import type { DebugLogEntry } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";

// The presentational list runs for real; only native edges become string tags.
vi.mock("react-native", () => ({
  ScrollView: "ScrollView",
  View: "View",
  Platform: { OS: "ios" },
}));
vi.mock("@aulora/ui-native", () => ({
  Text: "Text",
  Button: "Button",
  TextField: "TextField",
}));
vi.mock("expo-application", () => ({ nativeApplicationVersion: "1.5.0" }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

import { DebugLogEntries } from "../src/components/chat/DebugLogsSection";

interface Node {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

/** Expands function components and returns every host element in the tree. */
function elements(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(elements);
  }
  const element = node as Node;
  if (typeof element.type === "function") {
    return elements((element.type as (props: Record<string, unknown>) => unknown)(element.props));
  }
  return [element, ...elements(element.props.children)];
}

function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }
  if (node !== null && typeof node === "object") {
    return textOf((node as Node).props.children);
  }
  return "";
}

function labels(entries: readonly DebugLogEntry[]): string[] {
  return elements(DebugLogEntries({ entries }))
    .filter((node) => node.type === "Text")
    .map((node) => textOf(node.props.children));
}

function entry(index: number): DebugLogEntry {
  return {
    timestamp: new Date(Date.UTC(2026, 0, 1, 10, 0, index)).toISOString(),
    source: `source ${index}`,
    detail: `detail ${index}`,
  };
}

describe("DebugLogEntries", () => {
  it("says when nothing has been recorded yet", () => {
    expect(labels([])).toEqual(["No errors or warnings have been recorded yet."]);
  });

  it("shows recorded errors and warnings newest first without a test-error action", () => {
    const shown = labels([entry(0), entry(1), entry(2)]);
    expect(shown).toContain("Newest first.");
    expect(shown.indexOf("source 2")).toBeLessThan(shown.indexOf("source 1"));
    expect(shown.indexOf("source 1")).toBeLessThan(shown.indexOf("source 0"));
    expect(shown).toContain("detail 2");
    expect(shown.join(" ")).not.toContain("Generate test error");
  });

  it("caps the visible list at the newest entries", () => {
    const shown = labels(Array.from({ length: 55 }, (_, index) => entry(index)));
    expect(shown).toContain("Showing the newest 50 of 55 entries.");
    expect(shown).toContain("source 54");
    expect(shown).not.toContain("source 0");
  });
});
