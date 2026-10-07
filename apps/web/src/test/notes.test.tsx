import { Permission } from "@aulora/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../../packages/convex/convex/_generated/dataModel";
import { AddonsSettings } from "../components/admin/AddonsSettings";
import { NotesView } from "../components/notes/NotesView";

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
  it("lets readers browse but hides create, edit and delete controls", async () => {
    const user = userEvent.setup();
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
    expect(screen.getByRole("textbox", { name: "Note body" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
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
    await user.click(screen.getByText("History"));
    expect(await screen.findByText(/edited this note/)).toBeInTheDocument();
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
