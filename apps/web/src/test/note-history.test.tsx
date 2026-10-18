import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NoteHistory } from "../components/notes/NoteHistory";
import { domId, formatGroupTime, formatTimeRange } from "../components/notes/note-history-helpers";
import type { NoteRevision } from "../components/notes/types";
import type { NotesController } from "../components/notes/use-notes";

const MINUTE = 60_000;
const BASE = new Date(2026, 9, 18, 14, 0, 0).getTime();

type SnapshotPatch = Partial<{
  title: string;
  body: string;
  folderId: string | null;
  tagIds: string[];
}>;

function snapshot(patch: SnapshotPatch) {
  return {
    title: "Note",
    body: "one\ntwo",
    folderId: null,
    tagIds: [] as string[],
    ...patch,
  };
}

type RevisionPatch = Partial<Omit<NoteRevision, "id">> & { id: string };

function revision(patch: RevisionPatch): NoteRevision {
  return {
    noteId: "note-1",
    actorId: "alex",
    action: "updated",
    before: snapshot({}),
    after: snapshot({}),
    at: BASE,
    ...patch,
  } as NoteRevision;
}

function controller(revisions: NoteRevision[]): NotesController {
  return {
    history: revisions,
    members: [
      { userId: "alex", displayName: "Alex" },
      { userId: "sam", displayName: "Sam" },
    ],
    folders: [
      { id: "folder-work", name: "Work", parentId: null, position: 0 },
      { id: "folder-home", name: "Home", parentId: null, position: 1 },
    ],
    tags: [
      { id: "tag-bug", name: "Bug", color: "#3e63dd" },
      { id: "tag-ship", name: "Ship", color: "#8fd19e" },
    ],
  } as unknown as NotesController;
}

const emptyController = (): NotesController =>
  ({ history: undefined, folders: [], tags: [], members: [] }) as unknown as NotesController;

const rowButtons = () => screen.queryAllByRole("button", { name: /edited this note|renamed:/ });

describe("NoteHistory", () => {
  it("shows the loading and empty states", () => {
    const { rerender } = render(<NoteHistory ctl={emptyController()} />);
    expect(screen.getByLabelText("Loading note history")).toBeInTheDocument();
    rerender(<NoteHistory ctl={controller([])} />);
    expect(screen.getByText("No history yet.")).toBeInTheDocument();
  });

  it("collapses every revision by default and never renders its diff", () => {
    const revisions = [
      revision({
        id: "rev-1",
        before: snapshot({ body: "line one" }),
        after: snapshot({ body: "line two" }),
      }),
    ];
    render(<NoteHistory ctl={controller(revisions)} />);
    const row = screen.getByRole("button", { name: /edited this note/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/line one/)).not.toBeInTheDocument();
    expect(screen.queryByText(/line two/)).not.toBeInTheDocument();
  });

  it("expands a row to reveal the diff and its +/- stats, wired for a11y", async () => {
    const user = userEvent.setup();
    const revisions = [
      revision({
        id: "rev-1",
        before: snapshot({ body: "line one" }),
        after: snapshot({ body: "line two" }),
      }),
    ];
    render(<NoteHistory ctl={controller(revisions)} />);
    const toggle = screen.getByRole("button", { name: /edited this note/ });
    const panelId = toggle.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId as string)).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(panelId as string)).not.toBeNull();
    expect(screen.getByText(/line one/)).toBeInTheDocument();
    expect(screen.getByText(/line two/)).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/line one/)).not.toBeInTheDocument();
  });

  it("toggles on Enter and Space, since each row header is a button", async () => {
    const user = userEvent.setup();
    render(
      <NoteHistory
        ctl={controller([
          revision({
            id: "rev-1",
            before: snapshot({ body: "a" }),
            after: snapshot({ body: "b" }),
          }),
        ])}
      />,
    );
    const toggle = screen.getByRole("button", { name: /edited this note/ });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("summarises renames, moves and tag changes with looked-up names", () => {
    render(
      <NoteHistory
        ctl={controller([
          revision({
            id: "renamed",
            action: "renamed",
            before: snapshot({ title: "Old" }),
            after: snapshot({ title: "New" }),
          }),
          revision({
            id: "moved",
            action: "moved",
            before: snapshot({ folderId: null }),
            after: snapshot({ folderId: "folder-work" }),
          }),
          revision({
            id: "tagged",
            action: "tagged",
            before: snapshot({ tagIds: ["tag-ship"] }),
            after: snapshot({ tagIds: ["tag-bug"] }),
          }),
          revision({ id: "archived", action: "archived" }),
        ])}
      />,
    );
    expect(screen.getByText(/renamed: "Old" → "New"/)).toBeInTheDocument();
    expect(screen.getByText(/moved to Work/)).toBeInTheDocument();
    expect(screen.getByText(/added tag Bug, removed tag Ship/)).toBeInTheDocument();
    expect(screen.getByText(/archived this note/)).toBeInTheDocument();
  });

  it("folds a run of edits by one actor into one expandable group", async () => {
    const user = userEvent.setup();
    const revisions = [
      revision({
        id: "edit-2",
        at: BASE,
        before: snapshot({ body: "one" }),
        after: snapshot({ body: "one\ntwo" }),
      }),
      revision({
        id: "edit-1",
        at: BASE - 2 * MINUTE,
        before: snapshot({ body: "one\ntwo" }),
        after: snapshot({ body: "one\ntwo\nthree" }),
      }),
    ];
    render(<NoteHistory ctl={controller(revisions)} />);
    const group = screen.getByRole("button", { name: /2 edits by Alex/ });
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(group).toHaveAccessibleName(/\+2/);
    // The individual revisions stay hidden until the group opens.
    expect(rowButtons()).toHaveLength(0);

    await user.click(group);
    const rows = rowButtons();
    expect(rows).toHaveLength(2);
    // Each nested revision is itself collapsible and starts closed.
    expect(rows.every((row) => row.getAttribute("aria-expanded") === "false")).toBe(true);
  });

  it("keeps a lone edit ungrouped, and separates different actors", () => {
    render(
      <NoteHistory
        ctl={controller([
          revision({
            id: "a",
            at: BASE,
            before: snapshot({ body: "p" }),
            after: snapshot({ body: "q" }),
          }),
          revision({
            id: "b",
            at: BASE - MINUTE,
            actorId: "sam",
            before: snapshot({ body: "r" }),
            after: snapshot({ body: "s" }),
          }),
        ])}
      />,
    );
    expect(screen.queryByRole("button", { name: /edits by/ })).not.toBeInTheDocument();
    expect(rowButtons()).toHaveLength(2);
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.getByText(/Sam/)).toBeInTheDocument();
  });

  it("expands and collapses every row from the header control", async () => {
    const user = userEvent.setup();
    render(
      <NoteHistory
        ctl={controller([
          revision({
            id: "renamed",
            action: "renamed",
            before: snapshot({ title: "A" }),
            after: snapshot({ title: "B" }),
          }),
          revision({
            id: "edit-1",
            actorId: "sam",
            at: BASE - MINUTE,
            before: snapshot({ body: "one" }),
            after: snapshot({ body: "two" }),
          }),
        ])}
      />,
    );
    expect(rowButtons().every((row) => row.getAttribute("aria-expanded") === "false")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(rowButtons().every((row) => row.getAttribute("aria-expanded") === "true")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(rowButtons().every((row) => row.getAttribute("aria-expanded") === "false")).toBe(true);
  });

  it("keeps the newest revision first", () => {
    render(
      <NoteHistory
        ctl={controller([
          revision({
            id: "newer",
            at: BASE,
            before: snapshot({ body: "x" }),
            after: snapshot({ body: "y" }),
          }),
          revision({
            id: "older",
            at: BASE - 5 * MINUTE,
            actorId: "sam",
            before: snapshot({ body: "p" }),
            after: snapshot({ body: "q" }),
          }),
        ])}
      />,
    );
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const [first, second] = items.map((item) => within(item));
    expect(first?.getByText(/Alex/)).toBeInTheDocument();
    expect(second?.getByText(/Sam/)).toBeInTheDocument();
  });
});

describe("note history time helpers", () => {
  it("collapses a same-period span to one period suffix", () => {
    const from = new Date(2026, 9, 18, 14, 10).getTime();
    const to = new Date(2026, 9, 18, 14, 24).getTime();
    expect(formatTimeRange(from, to)).toMatch(/^2:10[–-]2:24 PM$/);
  });

  it("falls back to two full spans across a period boundary", () => {
    const from = new Date(2026, 9, 18, 11, 50).getTime();
    const to = new Date(2026, 9, 18, 12, 5).getTime();
    expect(formatTimeRange(from, to)).toMatch(/^11:50 AM[–-]12:05 PM$/);
  });

  it("prefixes the day for a span that did not happen today", () => {
    const now = new Date(2026, 9, 18, 14, 0).getTime();
    const from = new Date(2026, 9, 17, 14, 10).getTime();
    const to = new Date(2026, 9, 17, 14, 24).getTime();
    expect(formatGroupTime(from, to, now)).toContain("·");
    // A span from earlier today keeps just the clock range.
    const todayFrom = new Date(2026, 9, 18, 9, 0).getTime();
    const todayTo = new Date(2026, 9, 18, 9, 5).getTime();
    expect(formatGroupTime(todayFrom, todayTo, now)).not.toContain("·");
  });

  it("builds a stable aria-controls id", () => {
    expect(domId("note-revision", "abc:123")).toBe("note-revision-abc-123");
  });
});
