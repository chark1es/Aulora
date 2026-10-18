import { Permission } from "@aulora/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../../packages/convex/convex/_generated/dataModel";
import { AddonsSettings } from "../components/admin/AddonsSettings";
import { NotesView } from "../components/notes/NotesView";
import { childFolders, folderPath } from "../components/notes/types";

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ url: "https://chat.example.com" }),
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : state.values.get(getFunctionName(reference)),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (!state.mutations.has(name)) state.mutations.set(name, vi.fn().mockResolvedValue(undefined));
    return state.mutations.get(name);
  },
  useAction: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (!state.mutations.has(name)) state.mutations.set(name, vi.fn().mockResolvedValue(undefined));
    return state.mutations.get(name);
  },
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));

const members = [{ userId: "alice", displayName: "Alice" }];

const overview = {
  folders: [{ id: "folder-1" as Id<"noteFolders">, name: "Ideas", parentId: null, position: 0 }],
  notes: [
    {
      id: "note-1" as Id<"notePages">,
      folderId: null,
      title: "Roadmap",
      tagIds: ["tag-1"],
      creatorId: "alice",
      lastEditorId: "alice",
      createdAt: 1,
      updatedAt: 10,
      revision: 1,
      archived: false,
    },
    {
      id: "note-2" as Id<"notePages">,
      folderId: "folder-1" as Id<"noteFolders">,
      title: "Meeting",
      tagIds: [],
      creatorId: "alice",
      lastEditorId: "alice",
      createdAt: 2,
      updatedAt: 20,
      revision: 0,
      archived: false,
    },
  ],
  tags: [{ id: "tag-1" as Id<"noteTags">, name: "Ideas", color: "#8fd19e" }],
};

const detail = {
  ...overview.notes[0],
  body: "# Roadmap\nHello **world**",
};

const revisions = [
  {
    id: "rev-1" as Id<"noteRevisions">,
    noteId: "note-1" as Id<"notePages">,
    actorId: "alice",
    action: "updated" as const,
    before: { title: "Roadmap", body: "line one", folderId: null, tagIds: [] },
    after: { title: "Roadmap", body: "line two", folderId: null, tagIds: [] },
    at: 5,
  },
];

beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.values.set("workspaceNotes:overview", overview);
  state.values.set("workspaceNotes:get", detail);
  state.values.set("workspaceNotes:history", revisions);
  state.values.set("workspaceNotes:search", []);
  state.values.set("server:settings", { settings: {} });
});

describe("Notes UI", () => {
  it("lets readers browse but hides create and edit controls", () => {
    render(
      <NotesView
        ownUserId="alice"
        permissions={Permission.ViewNotes}
        members={members}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Open note Roadmap" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Note body" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bold" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("starts on the full-width list and opens a note only when clicked", async () => {
    const user = userEvent.setup();
    render(
      <NotesView
        ownUserId="alice"
        permissions={Permission.ViewNotes}
        members={members}
        onBack={vi.fn()}
      />,
    );
    // Nothing is selected until the viewer picks a note, so the list starts full width.
    expect(screen.queryByRole("textbox", { name: "Note body" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to list" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open note Roadmap" }));
    expect(screen.getByRole("button", { name: "Back to list" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to list" }));
    expect(screen.queryByRole("button", { name: "Back to list" })).not.toBeInTheDocument();
  });

  it("filters the loaded list instantly by title and tag", async () => {
    const user = userEvent.setup();
    render(
      <NotesView
        ownUserId="alice"
        permissions={Permission.ViewNotes}
        members={members}
        onBack={vi.fn()}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: "Search notes" }), "meet");
    expect(screen.queryByRole("button", { name: "Open note Roadmap" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open note Meeting" })).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Search notes" }));
    await user.click(screen.getByTestId("note-tag-tag-1"));
    expect(screen.getByRole("button", { name: "Open note Roadmap" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open note Meeting" })).not.toBeInTheDocument();
  });

  it("searches note bodies through the server and highlights the match", async () => {
    const user = userEvent.setup();
    state.values.set("workspaceNotes:search", [
      {
        id: "note-2",
        title: "Meeting",
        snippet: "…we discussed the budget spreadsheet…",
        score: 3,
        updatedAt: 20,
      },
    ]);
    render(
      <NotesView
        ownUserId="alice"
        permissions={Permission.ViewNotes}
        members={members}
        onBack={vi.fn()}
      />,
    );
    // One character is enough to start the server search.
    await user.type(screen.getByRole("textbox", { name: "Search notes" }), "b");
    expect(await screen.findByRole("button", { name: "Open note Meeting" })).toBeInTheDocument();
    // The matched term in the snippet is highlighted.
    expect(document.querySelector("mark")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open note Roadmap" })).not.toBeInTheDocument();
  });

  it("drills into folders and offers new-folder actions beside New note", async () => {
    const user = userEvent.setup();
    render(
      <NotesView
        ownUserId="alice"
        permissions={
          Permission.ViewNotes |
          Permission.CreateNotes |
          Permission.EditNotes |
          Permission.DeleteNotes
        }
        members={members}
        onBack={vi.fn()}
      />,
    );
    // Home shows the top-level folder row, not its contents.
    const folderRow = screen.getByRole("button", { name: "Open folder Ideas" });
    expect(screen.queryByRole("button", { name: "Open note Meeting" })).not.toBeInTheDocument();
    await user.click(folderRow);
    expect(screen.getByRole("button", { name: "Open note Meeting" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open note Roadmap" })).not.toBeInTheDocument();
    // The split button offers note and folder creation.
    await user.click(screen.getByRole("button", { name: "New note options" }));
    expect(screen.getByRole("menuitem", { name: "New folder" })).toBeInTheDocument();
    // Inside a folder, a subfolder can be created here.
    expect(screen.getByRole("menuitem", { name: "New subfolder" })).toBeInTheDocument();
  });

  it("offers rename and delete on a folder row's actions menu", async () => {
    const user = userEvent.setup();
    render(
      <NotesView
        ownUserId="alice"
        permissions={
          Permission.ViewNotes |
          Permission.CreateNotes |
          Permission.EditNotes |
          Permission.DeleteNotes
        }
        members={members}
        onBack={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Ideas actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(await screen.findByRole("dialog", { name: "Rename folder" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Ideas actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByRole("dialog", { name: "Delete folder?" })).toBeInTheDocument();
  });

  it("reaches tag management from the labeled Add tag and Manage controls", async () => {
    const user = userEvent.setup();
    render(
      <NotesView
        ownUserId="alice"
        permissions={Permission.ViewNotes | Permission.CreateNotes | Permission.EditNotes}
        members={members}
        onBack={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add tag" }));
    expect(await screen.findByRole("dialog", { name: "New tag" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("button", { name: /New tag/ })).toBeInTheDocument();
  });

  it("closes the create menu with Escape and moves between its items with arrows", async () => {
    const user = userEvent.setup();
    render(
      <NotesView
        ownUserId="alice"
        permissions={Permission.ViewNotes | Permission.CreateNotes}
        members={members}
        onBack={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "New note options" }));
    const menu = screen.getByRole("menu");
    await user.keyboard("{ArrowDown}");
    expect(menu.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("saves edits with the loaded revision and confirms deletes", async () => {
    const user = userEvent.setup();
    render(
      <NotesView
        ownUserId="alice"
        permissions={
          Permission.ViewNotes |
          Permission.CreateNotes |
          Permission.EditNotes |
          Permission.DeleteNotes
        }
        members={members}
        onBack={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open note Roadmap" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const title = screen.getByRole("textbox", { name: "Note title" });
    await user.clear(title);
    await user.type(title, "Plan");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(state.mutations.get("workspaceNotes:updateNote")).toHaveBeenCalledWith(
        expect.objectContaining({ noteId: "note-1", revision: 1, title: "Plan" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Permanently delete note?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete note" }));
    await waitFor(() =>
      expect(state.mutations.get("workspaceNotes:deleteNote")).toHaveBeenCalledWith({
        noteId: "note-1",
      }),
    );
  });

  it("shows revision history with a line diff", async () => {
    const user = userEvent.setup();
    render(
      <NotesView
        ownUserId="alice"
        permissions={Permission.ViewNotes}
        members={members}
        onBack={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open note Roadmap" }));
    await user.click(screen.getByText("History"));
    expect(await screen.findByText(/edited this note/)).toBeInTheDocument();
    // Revisions are collapsed until opened, so expand the row to see its diff.
    await user.click(screen.getByRole("button", { name: /edited this note/ }));
    expect(screen.getByText(/line one/)).toBeInTheDocument();
    expect(screen.getByText(/line two/)).toBeInTheDocument();
  });

  it("toggles the Notes addon from workspace settings", async () => {
    const user = userEvent.setup();
    render(<AddonsSettings canManageWorkspace />);
    const toggle = screen.getByRole("switch", { name: "Notes" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(state.mutations.get("workspaceNotes:setEnabled")).toHaveBeenCalledWith({
      enabled: true,
    });
  });
});

describe("folder helpers", () => {
  const folders = [
    { id: "work" as Id<"noteFolders">, name: "Work", parentId: null, position: 1 },
    { id: "home" as Id<"noteFolders">, name: "Home", parentId: null, position: 0 },
    {
      id: "web" as Id<"noteFolders">,
      name: "Web",
      parentId: "work" as Id<"noteFolders">,
      position: 1,
    },
    {
      id: "api" as Id<"noteFolders">,
      name: "Api",
      parentId: "work" as Id<"noteFolders">,
      position: 0,
    },
  ];

  it("lists a folder's direct children in display order", () => {
    expect(childFolders(folders, null).map((folder) => folder.id)).toEqual(["home", "work"]);
    expect(childFolders(folders, "work").map((folder) => folder.id)).toEqual(["api", "web"]);
  });

  it("builds a breadcrumb path and stops at the root", () => {
    expect(folderPath(folders, "api").map((folder) => folder.id)).toEqual(["work", "api"]);
    expect(folderPath(folders, "__root__")).toEqual([]);
    expect(folderPath(folders, "__unfiled__")).toEqual([]);
  });
});
