import { DEFAULT_KANBAN_COLUMNS, Permission } from "@aulora/core";
import { ContextMenuProvider } from "@aulora/ui-web";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../../packages/convex/convex/_generated/dataModel";
import { AddonsSettings } from "../components/admin/AddonsSettings";
import { CardDetail } from "../components/kanban/CardDetail";
import { KanbanView } from "../components/kanban/KanbanView";
import type { Board, Card } from "../components/kanban/types";

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
  usePaginatedQuery: () => ({
    results: state.values.get("comments") ?? [],
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
}));
afterEach(() => vi.unstubAllGlobals());
const board: Board = {
  id: "board-1" as Id<"kanbanBoards">,
  name: "Release",
  description: "Team work",
  columns: DEFAULT_KANBAN_COLUMNS,
  labels: [{ id: "bug", name: "Bug", color: "#ff0000" }],
  private: false,
  memberIds: [],
  archived: false,
  updatedAt: 100,
};
const card: Card = {
  _id: "card-1" as Id<"kanbanCards">,
  _creationTime: 100,
  boardId: board.id,
  title: "Fix login",
  notes: "Reproduce first",
  checklist: [],
  githubLinks: [],
  columnId: "todo",
  position: 0,
  labelIds: [],
  assigneeIds: [],
  priority: "none",
  fileIds: [],
  creatorId: "alice",
  archived: false,
  trackedMs: 0,
  updatedAt: 100,
  revision: 0,
};
const members = [
  { userId: "alice", displayName: "Alice" },
  { userId: "bob", displayName: "Bob" },
];
beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.values.set("kanban:listBoards", [board]);
  state.values.set("kanban:listCards", [card]);
  state.values.set("kanban:history", []);
  state.values.set("files:getMany", []);
  state.values.set("server:settings", { settings: {} });
});

describe("Kanban UI", () => {
  it("defaults the addon to off, requires workspace management and reports server errors", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AddonsSettings canManageWorkspace={false} />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    rerender(<AddonsSettings canManageWorkspace />);
    const toggle = screen.getByRole("switch", { name: "Kanban" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    state.mutations.get("kanban:setEnabled")?.mockRejectedValue(new Error("Missing permission"));
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Missing permission"));
    expect(state.mutations.get("kanban:setEnabled")).toHaveBeenCalledWith({ enabled: true });
  });
  it("lets readers open and filter cards while hiding edit and management controls", async () => {
    const user = userEvent.setup();
    render(
      <KanbanView
        ownUserId="alice"
        permissions={Permission.ViewKanban}
        members={members}
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "New board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Board settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add card" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search cards" }), "missing");
    expect(screen.queryByRole("button", { name: "Open card Fix login" })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Search cards" }));
    await user.click(screen.getByRole("button", { name: "Open card Fix login" }));
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comment" })).not.toBeInTheDocument();
  });
  it("saves task details explicitly with assignment, labels, estimates and a checklist", async () => {
    const user = userEvent.setup();
    render(
      <CardDetail
        card={card}
        board={board}
        members={members}
        permissions={Permission.ViewKanban | Permission.EditKanban}
        ownUserId="alice"
        now={1000}
        onClose={vi.fn()}
      />,
    );
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Fix authentication");
    // People and labels are picked from a checklist instead of listing everyone on the card.
    expect(screen.queryByRole("checkbox", { name: "Bob" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Assignees" }));
    await user.click(screen.getByRole("checkbox", { name: "Bob" }));
    await user.click(screen.getByRole("button", { name: "Labels" }));
    await user.click(screen.getByRole("checkbox", { name: "Bug" }));
    await user.type(screen.getByRole("spinbutton", { name: "Estimate in minutes" }), "45");
    await user.type(screen.getByRole("textbox", { name: "New checklist item" }), "Reproduce");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(state.mutations.get("kanban:updateCard")).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save card" }));
    await waitFor(() =>
      expect(state.mutations.get("kanban:updateCard")).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Fix authentication",
          assigneeIds: ["bob"],
          labelIds: ["bug"],
          estimateMinutes: 45,
          revision: 0,
          checklist: [expect.objectContaining({ text: "Reproduce", done: false })],
        }),
      ),
    );
  });
  it("blocks stale saves and lets the user reload concurrent changes", async () => {
    const user = userEvent.setup();
    const props = {
      board,
      members,
      permissions: Permission.ViewKanban | Permission.EditKanban,
      ownUserId: "alice",
      now: 1000,
      onClose: vi.fn(),
    };
    const { rerender } = render(<CardDetail card={card} {...props} />);
    // The dialog takes focus a frame after opening; typing before that would be interrupted.
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement),
    );
    await user.type(screen.getByRole("textbox", { name: "Notes" }), " local change");
    rerender(
      <CardDetail card={{ ...card, revision: 1, notes: "Someone else's change" }} {...props} />,
    );
    expect(screen.getByRole("button", { name: "Save card" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reload card" }));
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue(
      "Reproduce first local change",
    );
    const confirm = screen.getByRole("dialog", { name: "Replace unsaved card changes?" });
    await user.click(within(confirm).getByRole("button", { name: "Reload card" }));
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("Someone else's change");
  });
  it("lets managers edit existing comments without granting permission to post new comments", async () => {
    const user = userEvent.setup();
    state.values.set("comments", [
      { id: "comment-1", authorId: "bob", body: "Original comment", at: 100, updatedAt: 100 },
    ]);
    render(
      <CardDetail
        card={card}
        board={board}
        members={members}
        permissions={Permission.ViewKanban | Permission.ManageKanban}
        ownUserId="alice"
        now={1000}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox", { name: "New comment" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox", { name: "Edit comment" }));
    await user.type(screen.getByRole("textbox", { name: "Edit comment" }), "Moderated comment");
    await user.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() =>
      expect(state.mutations.get("kanban:comment")).toHaveBeenCalledWith({
        cardId: card._id,
        commentId: "comment-1",
        body: "Moderated comment",
      }),
    );
    expect(screen.queryByRole("textbox", { name: "New comment" })).not.toBeInTheDocument();
  });
  it("keeps a new card's title after a failed creation", async () => {
    const user = userEvent.setup();
    state.mutations.set(
      "kanban:createCard",
      vi.fn().mockRejectedValue(new Error("WIP limit reached")),
    );
    render(
      <KanbanView
        ownUserId="alice"
        permissions={Permission.ViewKanban | Permission.EditKanban}
        members={members}
        onBack={vi.fn()}
      />,
    );
    await user.click(screen.getAllByRole("button", { name: "Add card" })[0] as HTMLElement);
    const title = screen.getByRole("textbox", { name: "New card in Backlog" });
    await user.type(title, "Keep this draft");
    fireEvent.submit(title.closest("form") as HTMLFormElement);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("WIP limit reached"));
    expect(title).toHaveValue("Keep this draft");
  });
  it("filters with checklists that combine several choices", async () => {
    const user = userEvent.setup();
    state.values.set("kanban:listCards", [
      card,
      { ...card, _id: "card-2", title: "Write docs", priority: "high", assigneeIds: ["bob"] },
      { ...card, _id: "card-3", title: "Ship it", priority: "urgent", assigneeIds: ["alice"] },
    ]);
    render(
      <KanbanView
        ownUserId="alice"
        permissions={Permission.ViewKanban}
        members={members}
        onBack={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Filter by priority" }));
    await user.click(screen.getByRole("checkbox", { name: "High" }));
    await user.click(screen.getByRole("checkbox", { name: "Urgent" }));
    expect(screen.queryByRole("button", { name: "Open card Fix login" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open card Write docs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open card Ship it" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter by assignee" }));
    await user.click(screen.getByRole("checkbox", { name: "Bob" }));
    expect(screen.queryByRole("button", { name: "Open card Ship it" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: "Open card Fix login" })).toBeInTheDocument();
  });
  it("moves, assigns and archives a card from its right-click menu", async () => {
    const user = userEvent.setup();
    render(
      <ContextMenuProvider>
        <KanbanView
          ownUserId="alice"
          permissions={Permission.ViewKanban | Permission.EditKanban}
          members={members}
          onBack={vi.fn()}
        />
      </ContextMenuProvider>,
    );
    const tile = screen.getByRole("button", { name: "Open card Fix login" });
    fireEvent.contextMenu(tile);
    expect(screen.queryByRole("menuitem", { name: "Move to To do" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete card…" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Move to Done" }));
    expect(state.mutations.get("kanban:moveCard")).toHaveBeenCalledWith({
      cardId: card._id,
      columnId: "done",
    });
    fireEvent.contextMenu(tile);
    await user.click(screen.getByRole("menuitem", { name: "Assign to me" }));
    expect(state.mutations.get("kanban:updateCard")).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: card._id, revision: 0, assigneeIds: ["alice"] }),
    );
    await user.click(screen.getByRole("button", { name: "Actions for Fix login" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive card" }));
    expect(state.mutations.get("kanban:archiveCard")).toHaveBeenCalledWith({
      cardId: card._id,
      archived: true,
    });
  });
  it("shows where a dragged card will land and drops it there", async () => {
    render(
      <KanbanView
        ownUserId="alice"
        permissions={Permission.ViewKanban | Permission.EditKanban}
        members={members}
        onBack={vi.fn()}
      />,
    );
    const dataTransfer = { setData: vi.fn(), effectAllowed: "none", dropEffect: "none" };
    const slot = () => document.querySelector("[data-drop-slot]");
    fireEvent.dragStart(screen.getByRole("button", { name: "Open card Fix login" }), {
      dataTransfer,
    });
    const home = screen.getByRole("region", { name: "To do" });
    await waitFor(() => expect(home).toContainElement(slot() as HTMLElement));
    const done = screen.getByRole("region", { name: "Done" });
    fireEvent.dragOver(done, { dataTransfer });
    expect(done).toContainElement(slot() as HTMLElement);
    expect(within(done).queryByText("Drop a card here or add one")).not.toBeInTheDocument();
    fireEvent.drop(done, { dataTransfer });
    expect(state.mutations.get("kanban:moveCard")).toHaveBeenCalledWith({
      cardId: card._id,
      columnId: "done",
    });
    await waitFor(() => expect(slot()).not.toBeInTheDocument());
  });
  it("refuses a drop on a column that reached its limit", async () => {
    state.values.set("kanban:listBoards", [
      {
        ...board,
        columns: board.columns.map((c) => (c.id === "done" ? { ...c, wipLimit: 1 } : c)),
      },
    ]);
    state.values.set("kanban:listCards", [
      card,
      { ...card, _id: "card-2" as Id<"kanbanCards">, title: "Ship it", columnId: "done" },
    ]);
    render(
      <KanbanView
        ownUserId="alice"
        permissions={Permission.ViewKanban | Permission.EditKanban}
        members={members}
        onBack={vi.fn()}
      />,
    );
    const dataTransfer = { setData: vi.fn(), effectAllowed: "none", dropEffect: "none" };
    const slot = () => document.querySelector("[data-drop-slot]");
    fireEvent.dragStart(screen.getByRole("button", { name: "Open card Fix login" }), {
      dataTransfer,
    });
    await waitFor(() => expect(slot()).toBeInTheDocument());
    const done = screen.getByRole("region", { name: "Done" });
    fireEvent.dragOver(done, { dataTransfer });
    expect(within(done).getByRole("status")).toHaveTextContent("Column limit reached");
    expect(screen.getByRole("region", { name: "To do" })).toContainElement(slot() as HTMLElement);
    fireEvent.drop(done, { dataTransfer });
    expect(state.mutations.get("kanban:moveCard")).not.toHaveBeenCalled();
  });
  it("starts the timer without locking the card form", async () => {
    const user = userEvent.setup();
    // Never settles, so the form is checked while the request is still in flight.
    state.mutations.set("kanban:timer", vi.fn().mockReturnValue(new Promise(() => {})));
    render(
      <CardDetail
        card={card}
        board={board}
        members={members}
        permissions={Permission.ViewKanban | Permission.EditKanban}
        ownUserId="alice"
        now={1000}
        onClose={vi.fn()}
      />,
    );
    const start = screen.getByRole("button", { name: "Start timer" });
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement),
    );
    await user.click(start);
    expect(state.mutations.get("kanban:timer")).toHaveBeenCalledWith({
      cardId: card._id,
      running: true,
    });
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeEnabled();
    expect(start).toBeEnabled();
    expect(start).toHaveFocus();
    expect(screen.getByRole("dialog").querySelector("[aria-busy]")).not.toBeInTheDocument();
    await user.click(start);
    expect(state.mutations.get("kanban:timer")).toHaveBeenCalledTimes(1);
  });
  it("uploads through the public Docker backend and attaches the finalized file", async () => {
    const user = userEvent.setup();
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ storageId: "storage-1" }) });
    vi.stubGlobal("fetch", fetch);
    state.mutations.set(
      "files:generateUploadUrl",
      vi.fn().mockResolvedValue("http://localhost:3210/api/storage/upload?token=upload-test"),
    );
    state.mutations.set("files:finalize", vi.fn().mockResolvedValue("file-1"));
    render(
      <CardDetail
        card={card}
        board={board}
        members={members}
        permissions={Permission.ViewKanban | Permission.EditKanban | Permission.AttachFiles}
        ownUserId="alice"
        now={1000}
        onClose={vi.fn()}
      />,
    );
    const file = new File(["Attachment contents"], "plan.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("Add an attachment"), file);
    await waitFor(() =>
      expect(state.mutations.get("kanban:attachFile")).toHaveBeenCalledWith({
        cardId: card._id,
        fileId: "file-1",
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://chat.example.com/api/storage/upload?token=upload-test",
      { method: "POST", headers: { "Content-Type": "text/plain" }, body: file },
    );
    expect(state.mutations.get("files:finalize")).toHaveBeenCalledWith({
      storageId: "storage-1",
      name: "plan.txt",
      mime: "text/plain",
      kanbanBoardId: board.id,
    });
  });
});
