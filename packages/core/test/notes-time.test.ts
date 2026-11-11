import { describe, expect, it } from "vitest";
import { revisionSummaryOptions } from "../src/notes/summary";
import { collapseTimeRange, formatGroupTime, formatTimeRange } from "../src/notes/time";

describe("collapseTimeRange", () => {
  it("shares the period when both ends agree", () => {
    expect(collapseTimeRange("2:10 PM", "2:24 PM")).toBe("2:10–2:24 PM");
    expect(collapseTimeRange("9:05 AM", "9:30 AM")).toBe("9:05–9:30 AM");
  });

  it("keeps both times across a period boundary", () => {
    expect(collapseTimeRange("11:50 AM", "12:05 PM")).toBe("11:50 AM–12:05 PM");
  });

  it("falls back to a plain join when the locale has no period", () => {
    expect(collapseTimeRange("14:10", "14:24")).toBe("14:10–14:24");
  });
});

describe("formatTimeRange and formatGroupTime", () => {
  const from = new Date(2026, 9, 18, 14, 10).getTime();
  const to = new Date(2026, 9, 18, 14, 24).getTime();

  it("collapses a same-period span", () => {
    expect(formatTimeRange(from, to)).toMatch(/^2:10[–-]2:24 PM$/);
  });

  it("prefixes the day when the group was not today", () => {
    const later = new Date(2026, 9, 20, 9, 0).getTime();
    expect(formatGroupTime(from, to, later)).toContain("·");
  });

  it("omits the day when the group was today", () => {
    const sameDay = new Date(2026, 9, 18, 18, 0).getTime();
    expect(formatGroupTime(from, to, sameDay)).not.toContain("·");
  });
});

describe("revisionSummaryOptions", () => {
  const options = revisionSummaryOptions(
    [{ id: "folder-work", name: "Work", parentId: null, position: 0 }],
    [{ id: "tag-bug", name: "Bug", color: "#3e63dd" }],
  );

  it("resolves folder and tag names", () => {
    expect(options.folderName?.("folder-work")).toBe("Work");
    expect(options.tagName?.("tag-bug")).toBe("Bug");
  });

  it("calls a null folder unfiled and leaves unknown ids unresolved", () => {
    expect(options.folderName?.(null)).toBe("Unfiled");
    expect(options.folderName?.("missing")).toBeUndefined();
    expect(options.tagName?.("missing")).toBeUndefined();
  });
});
