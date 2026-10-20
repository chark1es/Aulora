import { describe, expect, it } from "vitest";
import {
  formatEditCount,
  formatLineStats,
  groupHistory,
  type HistoryRevision,
  lineDelta,
  summarizeRevision,
} from "../src/notes/index";

function snapshot(
  patch: Partial<{ title: string; body: string; folderId: string | null; tagIds: string[] }> = {},
) {
  return {
    title: "Note",
    body: "one\ntwo",
    folderId: null,
    tagIds: [] as string[],
    ...patch,
  };
}

function revision(patch: Partial<HistoryRevision> = {}): HistoryRevision {
  return {
    id: "rev-1",
    actorId: "alex",
    action: "updated",
    before: snapshot(),
    after: snapshot(),
    at: 1_000,
    ...patch,
  };
}

const folders = new Map([
  ["folder-work", "Work"],
  ["folder-home", "Home"],
]);
const tags = new Map([
  ["tag-bug", "Bug"],
  ["tag-ship", "Ship"],
]);
const options = {
  folderName: (id: string | null) => (id === null ? "Unfiled" : folders.get(id)),
  tagName: (id: string) => tags.get(id),
};

describe("lineDelta", () => {
  it("matches the exact aligned diff for ordinary notes", () => {
    expect(lineDelta("a\nb", "a\nb")).toEqual({ added: 0, removed: 0 });
    expect(lineDelta("a\nb\nc", "a\nB\nc\nd")).toEqual({ added: 2, removed: 1 });
    expect(lineDelta("a\nb\nc", "a\nb\nc\nd")).toEqual({ added: 1, removed: 0 });
    expect(lineDelta("", "first\nsecond")).toEqual({ added: 2, removed: 0 });
    expect(lineDelta("first\nsecond", "")).toEqual({ added: 0, removed: 2 });
  });

  it("stays linear on very large notes", () => {
    const before = Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n");
    const after = `${before}\nextra`;
    expect(lineDelta(before, after)).toEqual({ added: 1, removed: 0 });
  });
});

describe("formatLineStats / formatEditCount", () => {
  it("renders stats and edit counts", () => {
    expect(formatLineStats({ added: 12, removed: 3 })).toBe("+12 −3");
    expect(formatLineStats({ added: 4, removed: 0 })).toBe("+4");
    expect(formatLineStats({ added: 0, removed: 2 })).toBe("−2");
    expect(formatLineStats({ added: 0, removed: 0 })).toBe("No changes");
    expect(formatEditCount(1)).toBe("1 edit");
    expect(formatEditCount(5)).toBe("5 edits");
  });
});

describe("summarizeRevision", () => {
  it("names the terminal actions without a diff", () => {
    expect(summarizeRevision(revision({ action: "created", before: null }))).toEqual({
      headline: "created this note",
      details: [],
    });
    expect(summarizeRevision(revision({ action: "deleted", after: null })).headline).toBe(
      "deleted this note",
    );
    expect(summarizeRevision(revision({ action: "archived" })).headline).toBe("archived this note");
    expect(summarizeRevision(revision({ action: "restored" })).headline).toBe("restored this note");
  });

  it("summarises a rename with old and new titles", () => {
    const summary = summarizeRevision(
      revision({
        action: "renamed",
        before: snapshot({ title: "Old" }),
        after: snapshot({ title: "New" }),
      }),
    );
    expect(summary.headline).toBe('renamed: "Old" → "New"');
  });

  it("summarises a move with the looked-up folder name", () => {
    const summary = summarizeRevision(
      revision({
        action: "moved",
        before: snapshot(),
        after: snapshot({ folderId: "folder-work" }),
      }),
      options,
    );
    expect(summary.headline).toBe("moved to Work");
  });

  it("falls back to another folder when the lookup misses", () => {
    const summary = summarizeRevision(
      revision({ action: "moved", before: snapshot(), after: snapshot({ folderId: "gone" }) }),
      { folderName: () => undefined },
    );
    expect(summary.headline).toBe("moved to another folder");
  });

  it("summarises added and removed tags", () => {
    const summary = summarizeRevision(
      revision({
        action: "tagged",
        before: snapshot({ tagIds: ["tag-ship"] }),
        after: snapshot({ tagIds: ["tag-bug"] }),
      }),
      options,
    );
    expect(summary.headline).toBe("added tag Bug, removed tag Ship");
  });

  it("combines several changes and caps the collapsed headline", () => {
    const summary = summarizeRevision(
      revision({
        before: snapshot({ title: "Old", body: "one\ntwo", tagIds: ["tag-ship"] }),
        after: snapshot({
          title: "New",
          body: "one\nthree",
          folderId: "folder-home",
          tagIds: ["tag-bug"],
        }),
      }),
      options,
    );
    expect(summary.headline).toBe(
      'edited this note · renamed: "Old" → "New", +1 −1 lines · +3 more',
    );
    expect(summary.details).toHaveLength(5);
    expect(summary.details.map((detail) => detail.kind)).toEqual([
      "title",
      "body",
      "folder",
      "tag",
      "tag",
    ]);
    expect(summary.details.map((detail) => detail.text)).toContain("moved to Home");
  });

  it("keeps a two-part body-only edit uncapped", () => {
    const summary = summarizeRevision(
      revision({ before: snapshot({ body: "one\ntwo" }), after: snapshot({ body: "one\nthree" }) }),
    );
    expect(summary.headline).toBe("edited this note · +1 −1 lines");
    expect(summary.details).toEqual([{ kind: "body", text: "+1 −1 lines" }]);
  });

  it("never throws when a side is missing", () => {
    expect(summarizeRevision(revision({ action: "updated", before: null })).headline).toBe(
      "changed the note",
    );
  });
});

describe("groupHistory", () => {
  const at = (minutes: number) => minutes * 60_000;

  it("collapses consecutive edits by one actor inside the window", () => {
    const revisions = [
      revision({ id: "edit-5", at: at(24) }),
      revision({ id: "edit-4", at: at(20) }),
      revision({ id: "edit-3", at: at(16) }),
      revision({ id: "edit-2", at: at(12) }),
      revision({ id: "edit-1", at: at(10) }),
    ];
    const groups = groupHistory(revisions);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("edits");
    expect(groups[0]?.revisions.map((entry) => entry.id)).toEqual([
      "edit-5",
      "edit-4",
      "edit-3",
      "edit-2",
      "edit-1",
    ]);
    expect(groups[0]?.from).toBe(at(10));
    expect(groups[0]?.to).toBe(at(24));
  });

  it("breaks a run on a long gap, a different actor, or another action", () => {
    const revisions = [
      revision({ id: "a", at: at(40) }),
      revision({ id: "b", at: at(20) }),
      revision({ id: "c", at: at(19), actorId: "sam" }),
      revision({ id: "d", at: at(18) }),
      revision({ id: "e", at: at(17), action: "renamed" }),
    ];
    const groups = groupHistory(revisions);
    expect(groups.map((group) => group.kind)).toEqual([
      "single",
      "single",
      "single",
      "single",
      "single",
    ]);
    expect(groups.map((group) => group.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps a lone edit ungrouped and preserves newest-first order", () => {
    const revisions = [
      revision({ id: "renamed-1", action: "renamed", at: at(30) }),
      revision({ id: "edit-1", at: at(20) }),
      revision({ id: "archived-1", action: "archived", at: at(10) }),
    ];
    const groups = groupHistory(revisions);
    expect(groups.map((group) => group.id)).toEqual(["renamed-1", "edit-1", "archived-1"]);
    expect(groups.map((group) => group.kind)).toEqual(["single", "single", "single"]);
  });

  it("sums the line stats of a collapsed run", () => {
    const revisions = [
      revision({
        id: "edit-2",
        at: at(12),
        before: snapshot({ body: "one" }),
        after: snapshot({ body: "one\ntwo" }),
      }),
      revision({
        id: "edit-1",
        at: at(10),
        before: snapshot({ body: "one\ntwo" }),
        after: snapshot({ body: "one\ntwo\nthree" }),
      }),
    ];
    const groups = groupHistory(revisions);
    expect(groups[0]?.stats).toEqual({ added: 2, removed: 0 });
  });
});
