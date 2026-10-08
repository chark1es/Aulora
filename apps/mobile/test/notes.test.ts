import { type NoteFolder, type NoteSummary, type NoteTag, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import {
  archiveActionLabel,
  bodyPreview,
  buildFolderTree,
  diffSummary,
  filterCount,
  filterNotes,
  flattenFolders,
  folderChildren,
  folderPath,
  groupNotes,
  hasNoteContent,
  NO_NOTE_FILTERS,
  noteCountLabel,
  notePermissions,
  noteTitle,
  revisionActionLabel,
  selectNotes,
  sortNotes,
  tagsForIds,
} from "../src/lib/notes";

function folder(id: string, patch: Partial<NoteFolder> = {}): NoteFolder {
  return { id, name: id, parentId: null, position: 0, ...patch };
}

function note(id: string, patch: Partial<NoteSummary> = {}): NoteSummary {
  return {
    id,
    folderId: null,
    title: id,
    tagIds: [],
    creatorId: "alice",
    lastEditorId: "alice",
    createdAt: 0,
    updatedAt: 0,
    revision: 0,
    archived: false,
    ...patch,
  };
}

const tag = (id: string, patch: Partial<NoteTag> = {}): NoteTag => ({
  id,
  name: id,
  color: "#3e63dd",
  ...patch,
});

describe("filters", () => {
  const notes = [
    note("login", { title: "Fix login", folderId: "eng", tagIds: ["bug"], updatedAt: 3 }),
    note("docs", { title: "Explain login flow", tagIds: ["docs"], updatedAt: 2 }),
    note("ship", { title: "Ship it", folderId: "eng", tagIds: ["bug", "release"], updatedAt: 1 }),
    note("old", { title: "Old plan", archived: true, updatedAt: 0 }),
  ];
  const ids = (patch: Partial<typeof NO_NOTE_FILTERS>) =>
    filterNotes(notes, { ...NO_NOTE_FILTERS, ...patch }).map((entry) => entry.id);

  it("matches the query against titles, ignoring case and padding", () => {
    expect(ids({ query: " LOGIN " })).toEqual(["login", "docs"]);
    expect(ids({ query: "nope" })).toEqual([]);
  });
  it("narrows by folder, with null meaning unfiled", () => {
    expect(ids({ folderId: "eng" })).toEqual(["login", "ship"]);
    expect(ids({ folderId: null })).toEqual(["docs"]);
    expect(ids({})).toEqual(["login", "docs", "ship"]);
  });
  it("keeps notes carrying any chosen tag", () => {
    expect(ids({ tagIds: ["docs"] })).toEqual(["docs"]);
    expect(ids({ tagIds: ["bug", "docs"] })).toEqual(["login", "docs", "ship"]);
  });
  it("separates active and archived notes", () => {
    expect(ids({ archived: true })).toEqual(["old"]);
  });
  it("counts each choice and the search once, not the archived toggle alone", () => {
    expect(filterCount(NO_NOTE_FILTERS)).toBe(0);
    expect(filterCount({ query: "x", folderId: "eng", tagIds: ["a", "b"], archived: false })).toBe(
      4,
    );
    expect(filterCount({ ...NO_NOTE_FILTERS, archived: true })).toBe(1);
  });
});

describe("ordering", () => {
  const notes = [
    note("b", { title: "Beta", createdAt: 1, updatedAt: 9 }),
    note("a", { title: "Alpha", createdAt: 5, updatedAt: 2 }),
    note("c", { title: "Gamma", createdAt: 3, updatedAt: 5 }),
  ];
  it("sorts by most recently updated by default", () => {
    expect(sortNotes(notes, "updated").map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });
  it("can sort by creation or title", () => {
    expect(sortNotes(notes, "created").map((entry) => entry.id)).toEqual(["a", "c", "b"]);
    expect(sortNotes(notes, "title").map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
  it("filters then sorts in one step", () => {
    const selected = selectNotes(notes, { ...NO_NOTE_FILTERS, query: "a" }, "title");
    expect(selected.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
});

describe("folder tree", () => {
  const folders = [
    folder("work", { position: 0 }),
    folder("home", { position: 1 }),
    folder("web", { parentId: "work", position: 0 }),
    folder("api", { parentId: "work", position: 1 }),
    folder("orphan", { parentId: "missing", position: 0 }),
  ];

  it("nests children under their parents and promotes orphans", () => {
    const tree = buildFolderTree(folders);
    expect(tree.map((node) => node.folder.id)).toEqual(["orphan", "work", "home"]);
    const work = tree.find((node) => node.folder.id === "work");
    expect(work?.children.map((node) => node.folder.id)).toEqual(["web", "api"]);
    expect(work?.children.at(0)?.depth).toBe(1);
  });

  it("flattens to display order with depths", () => {
    expect(flattenFolders(folders).map((entry) => [entry.folder.id, entry.depth])).toEqual([
      ["orphan", 0],
      ["work", 0],
      ["web", 1],
      ["api", 1],
      ["home", 0],
    ]);
  });

  it("lists direct children and builds a breadcrumb", () => {
    expect(folderChildren(folders, "work").map((entry) => entry.id)).toEqual(["web", "api"]);
    expect(folderPath(folders, "web")).toBe("work / web");
    expect(folderPath(folders, "work")).toBe("work");
  });
});

describe("grouping", () => {
  const now = new Date(2026, 9, 7, 12).getTime();
  const at = (daysAgo: number) => new Date(2026, 9, 7 - daysAgo, 9).getTime();
  const notes = [
    note("today", { updatedAt: at(0) }),
    note("yesterday", { updatedAt: at(1) }),
    note("week", { updatedAt: at(4) }),
    note("month", { updatedAt: at(20) }),
  ];
  it("buckets notes by how recently they were updated", () => {
    const groups = groupNotes(notes, now);
    expect(groups.map((group) => group.key)).toEqual(["today", "yesterday", "week", "month"]);
    expect(groups.at(0)?.notes.map((entry) => entry.id)).toEqual(["today"]);
    expect(groups.at(3)?.label).toBe("Previous 30 days");
  });
  it("drops empty buckets", () => {
    expect(groupNotes([note("later", { updatedAt: at(40) })], now).map((g) => g.key)).toEqual([
      "earlier",
    ]);
  });
});

describe("previews and labels", () => {
  it("falls back for a blank title", () => {
    expect(noteTitle({ title: "  " })).toBe("Untitled note");
    expect(noteTitle({ title: " Plans " })).toBe("Plans");
  });
  it("collapses Markdown into one preview line", () => {
    const body = "# Heading\n\nSome **bold** text\n\n- one\n- two";
    expect(bodyPreview(body)).toBe("Heading Some bold text one two");
    expect(bodyPreview(body, 10)).toBe("Heading S…");
  });
  it("knows when a draft has content", () => {
    expect(hasNoteContent("  ", "\n")).toBe(false);
    expect(hasNoteContent("", "hi")).toBe(true);
  });
  it("names revisions and archive states", () => {
    expect(revisionActionLabel("renamed")).toBe("Renamed");
    expect(revisionActionLabel("mystery")).toBe("Changed");
    expect(archiveActionLabel(true)).toBe("Restore note");
    expect(archiveActionLabel(false)).toBe("Archive note");
  });
  it("summarises a diff", () => {
    expect(diffSummary({ added: 0, removed: 0 })).toBe("No changes");
    expect(diffSummary({ added: 3, removed: 1 })).toBe("+3 -1");
  });
  it("counts notes for the list caption", () => {
    expect(noteCountLabel(2, 2, { archived: false, filtering: false })).toBe("2 notes");
    expect(noteCountLabel(1, 1, { archived: false, filtering: false })).toBe("1 note");
    expect(noteCountLabel(1, 4, { archived: false, filtering: true })).toBe("1 of 4 notes");
    expect(noteCountLabel(1, 1, { archived: true, filtering: false })).toBe("1 archived");
  });
});

describe("tags and permissions", () => {
  it("resolves tags in the order requested", () => {
    expect(tagsForIds([tag("b"), tag("a")], ["a", "b", "gone"]).map((entry) => entry.id)).toEqual([
      "a",
      "b",
    ]);
  });
  it("reads each notes permission bit", () => {
    const flags = notePermissions(
      Permission.ViewNotes | Permission.CreateNotes | Permission.EditNotes,
    );
    expect(flags).toEqual({
      view: true,
      create: true,
      edit: true,
      remove: false,
      manage: false,
    });
    expect(notePermissions(Permission.Administrator).manage).toBe(true);
  });
});
