import { type NoteRevisionAction, summarizeRevision } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { collapseTimeRange } from "../src/components/notes/note-history-format";

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

describe("shared summary used by the mobile history", () => {
  it("still produces the mobile-facing headline", () => {
    const revision = {
      id: "rev-1",
      actorId: "alex",
      action: "updated" as NoteRevisionAction,
      before: { title: "Note", body: "one", folderId: null, tagIds: [] },
      after: { title: "Note", body: "one\ntwo", folderId: null, tagIds: [] },
      at: 1,
    };
    expect(summarizeRevision(revision).headline).toBe("edited this note · +1 lines");
  });
});
