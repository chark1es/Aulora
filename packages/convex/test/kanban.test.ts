import { Permission } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { isSealed } from "../convex/lib/sse";
import { newTest, seedWorkspace, storeBlob } from "./helpers";

const MEMBER =
  Permission.ViewKanban | Permission.EditKanban | Permission.CommentKanban | Permission.AttachFiles;
async function setup(permissions = MEMBER) {
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: permissions,
    members: [{ userId: "alice" }, { userId: "bob" }],
  });
  const owner = t.withIdentity({ subject: "owner-1" });
  await owner.mutation(api.kanban.setEnabled, { enabled: true });
  const boardId = await owner.mutation(api.kanban.createBoard, {
    name: "Release",
    private: false,
    memberIds: [],
  });
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  return { t, owner, alice, bob, boardId };
}
async function cardArgs(
  alice: ReturnType<ReturnType<typeof newTest>["withIdentity"]>,
  boardId: Id<"kanbanBoards">,
  cardId: Id<"kanbanCards">,
) {
  const card = (await alice.query(api.kanban.listCards, { boardId })).find((c) => c._id === cardId);
  if (!card) throw new Error("Missing card");
  return {
    cardId,
    revision: card.revision,
    title: card.title,
    notes: card.notes,
    checklist: card.checklist,
    githubLinks: card.githubLinks,
    labelIds: card.labelIds,
    assigneeIds: card.assigneeIds,
    priority: card.priority,
    startAt: card.startAt ?? null,
    dueAt: card.dueAt ?? null,
    estimateMinutes: card.estimateMinutes ?? null,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Kanban authorization", () => {
  it("is disabled by default and only workspace managers may enable it", async () => {
    const t = newTest();
    await seedWorkspace(t, { everyonePermissions: MEMBER, members: [{ userId: "alice" }] });
    expect((await t.query(api.server.publicConfig)).addons.kanban).toBe(false);
    const alice = t.withIdentity({ subject: "alice" });
    await expect(alice.query(api.kanban.listBoards)).rejects.toThrow("disabled");
    await expect(alice.mutation(api.kanban.setEnabled, { enabled: true })).rejects.toThrow(
      "Missing permission",
    );
  });
  it("rejects anonymous users, non-members, and viewers attempting edits", async () => {
    const { t, boardId, alice } = await setup(Permission.ViewKanban);
    await expect(t.query(api.kanban.listBoards)).rejects.toThrow("Not authenticated");
    await expect(
      t.withIdentity({ subject: "outsider" }).query(api.kanban.listBoards),
    ).rejects.toThrow("Not a member");
    await expect(
      alice.mutation(api.kanban.createCard, { boardId, columnId: "todo", title: "No" }),
    ).rejects.toThrow("Missing Kanban permission");
    await expect(
      alice.mutation(api.kanban.createBoard, { name: "No", private: false, memberIds: [] }),
    ).rejects.toThrow("Missing Kanban permission");
  });
  it("hides private boards and protects all card reads and writes", async () => {
    const { owner, alice, bob } = await setup();
    const boardId = await owner.mutation(api.kanban.createBoard, {
      name: "Private",
      private: true,
      memberIds: ["alice"],
    });
    const cardId = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "Secret",
    });
    expect((await bob.query(api.kanban.listBoards)).map((b) => b.id)).not.toContain(boardId);
    for (const query of [api.kanban.comments, api.kanban.history]) {
      if (query === api.kanban.comments)
        await expect(
          bob.query(api.kanban.comments, {
            cardId,
            paginationOpts: { cursor: null, numItems: 20 },
          }),
        ).rejects.toThrow("access to this board");
      else
        await expect(bob.query(api.kanban.history, { cardId })).rejects.toThrow(
          "access to this board",
        );
    }
    await expect(bob.query(api.kanban.listCards, { boardId })).rejects.toThrow(
      "access to this board",
    );
    await expect(bob.mutation(api.kanban.moveCard, { cardId, columnId: "done" })).rejects.toThrow(
      "access to this board",
    );
    await expect(bob.mutation(api.kanban.comment, { cardId, body: "No" })).rejects.toThrow(
      "access to this board",
    );
    expect((await owner.query(api.kanban.listCards, { boardId }))[0]?.title).toBe("Secret");
  });
  it("rejects bans on reads and timeouts on writes", async () => {
    const { t, alice, boardId } = await setup();
    await t.run(async (ctx) => {
      const member = await ctx.db
        .query("members")
        .filter((q) => q.eq(q.field("userId"), "alice"))
        .unique();
      if (member) await ctx.db.patch(member._id, { timeoutUntil: Date.now() + 60000 });
    });
    await expect(alice.query(api.kanban.listBoards)).resolves.toHaveLength(1);
    await expect(
      alice.mutation(api.kanban.createCard, { boardId, columnId: "todo", title: "No" }),
    ).rejects.toThrow("timed out");
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", { userId: "alice", actorId: "owner-1", at: Date.now() });
    });
    await expect(alice.query(api.kanban.listBoards)).rejects.toThrow("banned");
  });
});
describe("Kanban collaboration", () => {
  it("round-trips encrypted content, assignment, dates, estimates, checklists and labels", async () => {
    const { t, owner, alice, boardId } = await setup();
    const board = (await owner.query(api.kanban.listBoards))[0];
    if (!board) throw new Error("Missing board");
    await owner.mutation(api.kanban.updateBoard, {
      boardId,
      expectedUpdatedAt: board.updatedAt,
      name: board.name,
      description: "Release planning",
      columns: board.columns,
      labels: [{ id: "bug", name: "Bug", color: "#ff0000" }],
      private: false,
      memberIds: [],
    });
    const cardId = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "Investigate regression",
    });
    const args = await cardArgs(alice, boardId, cardId);
    await alice.mutation(api.kanban.updateCard, {
      ...args,
      notes: "Private investigation notes",
      assigneeIds: ["bob"],
      labelIds: ["bug"],
      priority: "high",
      startAt: 100,
      dueAt: 200,
      estimateMinutes: 90,
      checklist: [{ id: "repro", text: "Reproduce", done: true }],
      githubLinks: ["https://github.com/acme/app/issues/1"],
    });
    const card = (await alice.query(api.kanban.listCards, { boardId }))[0];
    expect(card).toMatchObject({
      title: "Investigate regression",
      notes: "Private investigation notes",
      assigneeIds: ["bob"],
      priority: "high",
      labelIds: ["bug"],
      estimateMinutes: 90,
      startAt: 100,
      dueAt: 200,
      checklist: [{ id: "repro", done: true }],
    });
    const stored = await t.run(async (ctx) => ({
      card: await ctx.db.get(cardId),
      board: await ctx.db.get(boardId),
    }));
    expect(isSealed(stored.card?.contentCiphertext ?? "")).toBe(true);
    expect(stored.card?.contentCiphertext).not.toContain("investigation");
    expect(isSealed(stored.board?.contentCiphertext ?? "")).toBe(true);
    await expect(alice.mutation(api.kanban.updateCard, args)).rejects.toThrow("card changed");
  });
  it("enforces WIP limits, moves and orders cards, and archives/restores", async () => {
    const { owner, alice, boardId } = await setup();
    const board = (await owner.query(api.kanban.listBoards))[0];
    if (!board) throw new Error("Missing board");
    await owner.mutation(api.kanban.updateBoard, {
      boardId,
      expectedUpdatedAt: board.updatedAt,
      name: board.name,
      description: "",
      columns: board.columns.map((c) => (c.id === "progress" ? { ...c, wipLimit: 1 } : c)),
      labels: [],
      private: false,
      memberIds: [],
    });
    const first = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "First",
    });
    const second = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "Second",
    });
    await alice.mutation(api.kanban.moveCard, {
      cardId: second,
      columnId: "todo",
      beforeId: first,
    });
    const cards = await alice.query(api.kanban.listCards, { boardId });
    expect(cards.find((c) => c._id === second)?.position).toBe(0);
    await alice.mutation(api.kanban.moveCard, { cardId: first, columnId: "progress" });
    await expect(
      alice.mutation(api.kanban.moveCard, { cardId: second, columnId: "progress" }),
    ).rejects.toThrow("work-in-progress limit");
    await alice.mutation(api.kanban.archiveCard, { cardId: first, archived: true });
    await alice.mutation(api.kanban.moveCard, { cardId: second, columnId: "progress" });
    await expect(
      alice.mutation(api.kanban.archiveCard, { cardId: first, archived: false }),
    ).rejects.toThrow("work-in-progress limit");
    await alice.mutation(api.kanban.moveCard, { cardId: second, columnId: "done" });
    await alice.mutation(api.kanban.archiveCard, { cardId: first, archived: false });
    await owner.mutation(api.kanban.archiveBoard, { boardId, archived: true });
    await expect(alice.mutation(api.kanban.comment, { cardId: first, body: "No" })).rejects.toThrow(
      "Restore the board",
    );
    await owner.mutation(api.kanban.archiveBoard, { boardId, archived: false });
    expect((await alice.query(api.kanban.listBoards))[0]?.archived).toBe(false);
  });
  it("validates configuration, links, dates, and current assignment membership", async () => {
    const { owner, alice, boardId } = await setup();
    const cardId = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "First",
    });
    const args = await cardArgs(alice, boardId, cardId);
    await expect(
      alice.mutation(api.kanban.updateCard, { ...args, assigneeIds: ["outsider"] }),
    ).rejects.toThrow("Not a member");
    await expect(
      alice.mutation(api.kanban.updateCard, { ...args, dueAt: 1, startAt: 2 }),
    ).rejects.toThrow("Due date");
    await expect(
      alice.mutation(api.kanban.updateCard, { ...args, githubLinks: ["javascript:alert(1)"] }),
    ).rejects.toThrow("GitHub");
    const board = (await owner.query(api.kanban.listBoards))[0];
    if (!board) throw new Error("Missing board");
    await expect(
      owner.mutation(api.kanban.updateBoard, {
        boardId,
        expectedUpdatedAt: board.updatedAt,
        name: "Test",
        description: "",
        columns: board.columns.filter((c) => c.id !== "todo"),
        labels: [],
        private: false,
        memberIds: [],
      }),
    ).rejects.toThrow("Move cards out");
    await owner.mutation(api.kanban.updateBoard, {
      boardId,
      expectedUpdatedAt: board.updatedAt,
      name: "Test",
      description: "",
      columns: board.columns,
      labels: [],
      private: true,
      memberIds: ["alice"],
    });
    await expect(
      alice.mutation(api.kanban.updateCard, { ...args, assigneeIds: ["bob"] }),
    ).rejects.toThrow("members of this private board");
  });
  it("protects comments by authorship and keeps history encrypted", async () => {
    const { t, alice, bob, owner, boardId } = await setup();
    const cardId = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "First",
    });
    await alice.mutation(api.kanban.comment, { cardId, body: "Review notes" });
    const result = await alice.query(api.kanban.comments, {
      cardId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    const c = result.page[0];
    if (!c) throw new Error("Missing comment");
    await expect(
      bob.mutation(api.kanban.comment, { cardId, commentId: c.id, body: "Tampered" }),
    ).rejects.toThrow("own comments");
    await alice.mutation(api.kanban.comment, { cardId, commentId: c.id, body: "Updated notes" });
    expect(
      (
        await alice.query(api.kanban.comments, {
          cardId,
          paginationOpts: { numItems: 20, cursor: null },
        })
      ).page[0]?.body,
    ).toBe("Updated notes");
    const stored = await t.run(async (ctx) => await ctx.db.get(c.id));
    expect(isSealed(stored?.bodyCiphertext ?? "")).toBe(true);
    expect((await alice.query(api.kanban.history, { cardId })).length).toBeGreaterThan(1);
    await owner.mutation(api.kanban.comment, { cardId, commentId: c.id, body: "", remove: true });
    expect(
      (
        await bob.query(api.kanban.comments, {
          cardId,
          paginationOpts: { numItems: 20, cursor: null },
        })
      ).page,
    ).toHaveLength(0);
  });
  it("allows one timer per user, protects timer ownership, and stops on disable", async () => {
    const { t, alice, bob, owner, boardId } = await setup();
    const one = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "One",
    });
    const two = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "Two",
    });
    await alice.mutation(api.kanban.timer, { cardId: one, running: true });
    await expect(alice.mutation(api.kanban.timer, { cardId: two, running: true })).rejects.toThrow(
      "other timer",
    );
    await expect(bob.mutation(api.kanban.timer, { cardId: one, running: false })).rejects.toThrow(
      "timer owner",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(one, { timerStartedAt: Date.now() - 2000 });
    });
    await owner.mutation(api.kanban.setEnabled, { enabled: false });
    const row = await t.run(async (ctx) => await ctx.db.get(one));
    expect(row?.timerStartedAt).toBeUndefined();
    expect(row?.trackedMs).toBeGreaterThanOrEqual(2000);
    await expect(alice.query(api.kanban.listCards, { boardId })).rejects.toThrow("disabled");
    await owner.mutation(api.kanban.setEnabled, { enabled: true });
    expect(await alice.query(api.kanban.listCards, { boardId })).toHaveLength(2);
  });
});
describe("Kanban attachments and GitHub", () => {
  it("seals attachments and rechecks downloads after private membership is revoked", async () => {
    const { t, alice, bob, owner } = await setup();
    const boardId = await owner.mutation(api.kanban.createBoard, {
      name: "Private",
      private: true,
      memberIds: ["alice", "bob"],
    });
    const cardId = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "With file",
    });
    const storageId = await storeBlob(t, 8);
    const fileId = await alice.action(api.files.finalize, {
      storageId,
      name: "secret.txt",
      mime: "text/plain",
      kanbanBoardId: boardId,
    });
    await alice.mutation(api.kanban.attachFile, { cardId, fileId });
    const file = await bob.query(api.files.get, { fileId });
    if (!file) throw new Error("Missing file");
    const token = new URL(file.url, "http://localhost").searchParams.get("token");
    if (!token) throw new Error("Missing token");
    expect((await bob.action(api.files.download, { token })).bytes.byteLength).toBe(8);
    const board = (await owner.query(api.kanban.listBoards)).find((b) => b.id === boardId);
    if (!board) throw new Error("Missing board");
    await owner.mutation(api.kanban.updateBoard, {
      boardId,
      expectedUpdatedAt: board.updatedAt,
      name: board.name,
      description: "",
      columns: board.columns,
      labels: [],
      private: true,
      memberIds: ["alice"],
    });
    await expect(bob.query(api.files.get, { fileId })).rejects.toThrow("access to this file");
    await expect(bob.action(api.files.download, { token })).rejects.toThrow("access to this board");
    const otherId = await owner.mutation(api.kanban.createBoard, {
      name: "Other",
      private: false,
      memberIds: [],
    });
    const otherCard = await alice.mutation(api.kanban.createCard, {
      boardId: otherId,
      columnId: "todo",
      title: "Other",
    });
    await expect(
      alice.mutation(api.kanban.attachFile, { cardId: otherCard, fileId }),
    ).rejects.toThrow("belong to this board");
  });
  it("keeps credentials encrypted and per-user, and only browses the fixed GitHub host", async () => {
    const { t, alice, bob, owner } = await setup();
    const token = "github_pat_test_secret_123456789";
    await alice.mutation(api.kanbanGithub.connect, { token });
    expect(await alice.query(api.kanbanGithub.status)).toEqual({ connected: true });
    expect(await bob.query(api.kanbanGithub.status)).toEqual({ connected: false });
    const row = await t.run(async (ctx) => await ctx.db.query("kanbanGithub").first());
    expect(isSealed(row?.tokenCiphertext ?? "")).toBe(true);
    expect(row?.tokenCiphertext).not.toContain(token);
    await expect(bob.action(api.kanbanGithub.browse, {})).rejects.toThrow("Connect your GitHub");
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ full_name: "acme/app", private: true, description: "App" }]), {
        status: 200,
        headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' },
      }),
    );
    vi.stubGlobal("fetch", request);
    expect(await alice.action(api.kanbanGithub.browse, {})).toMatchObject({
      repositories: [{ name: "acme/app", private: true }],
      hasMore: true,
    });
    expect(request.mock.calls[0]?.[0]).toMatch(/^https:\/\/api\.github\.com\/user\/repos/);
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      headers: { Authorization: `Bearer ${token}` },
    });
    await expect(alice.action(api.kanbanGithub.browse, { repository: "../evil" })).rejects.toThrow(
      "owner/repository",
    );
    await owner.mutation(api.kanban.setEnabled, { enabled: false });
    await expect(alice.query(internal.kanbanGithub.credentials)).rejects.toThrow("disabled");
    await alice.mutation(api.kanbanGithub.disconnect, {});
    expect(await t.run(async (ctx) => await ctx.db.query("kanbanGithub").collect())).toHaveLength(
      0,
    );
  });
  it("separates pull requests from issues and handles revoked GitHub tokens", async () => {
    const { alice } = await setup();
    await alice.mutation(api.kanbanGithub.connect, { token: "github_pat_test_secret_123456789" });
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { number: 1, title: "Bug", state: "open", updated_at: "2026-10-01" },
          { number: 2, title: "Fix", pull_request: {}, state: "open", updated_at: "2026-10-01" },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", request);
    const result = await alice.action(api.kanbanGithub.browse, {
      repository: "acme/app",
      kind: "issues",
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.url).toBe("https://github.com/acme/app/issues/1");
    request.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(alice.action(api.kanbanGithub.browse, {})).rejects.toThrow("invalid or expired");
  });
});

describe("Kanban deletion and management", () => {
  it("allows managers to moderate and stop timers without edit/comment permissions", async () => {
    const { t, alice, bob, boardId } = await setup();
    const cardId = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "Task",
    });
    await alice.mutation(api.kanban.comment, { cardId, body: "Comment" });
    await alice.mutation(api.kanban.timer, { cardId, running: true });
    const c = (
      await alice.query(api.kanban.comments, {
        cardId,
        paginationOpts: { numItems: 1, cursor: null },
      })
    ).page[0];
    if (!c) throw new Error("Missing comment");
    await t.run(async (ctx) => {
      await ctx.db.insert("roles", {
        key: "board-manager",
        name: "Board manager",
        position: 1,
        permissions: Permission.ViewKanban | Permission.ManageKanban,
        hoisted: false,
        mentionable: false,
      });
      const member = await ctx.db
        .query("members")
        .filter((q) => q.eq(q.field("userId"), "bob"))
        .unique();
      if (member) await ctx.db.patch(member._id, { roleIds: ["board-manager"] });
      const baseline = await ctx.db
        .query("roles")
        .filter((q) => q.eq(q.field("key"), "@everyone"))
        .unique();
      if (baseline) await ctx.db.patch(baseline._id, { permissions: Permission.ViewKanban });
    });
    await bob.mutation(api.kanban.comment, { cardId, commentId: c.id, body: "", remove: true });
    await bob.mutation(api.kanban.timer, { cardId, running: false });
    expect((await bob.query(api.kanban.listCards, { boardId }))[0]?.timerStartedAt).toBeUndefined();
    await expect(
      bob.mutation(api.kanban.updateCard, await cardArgs(bob, boardId, cardId)),
    ).rejects.toThrow("Missing Kanban permission");
  });
  it("deletes cards and boards with their comments, activity and encrypted storage", async () => {
    const { t, owner, alice, boardId } = await setup();
    const cardId = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "Remove me",
    });
    await alice.mutation(api.kanban.comment, { cardId, body: "History" });
    const storageId = await storeBlob(t, 8);
    const fileId = await alice.action(api.files.finalize, {
      storageId,
      name: "remove.txt",
      mime: "text/plain",
      kanbanBoardId: boardId,
    });
    await alice.mutation(api.kanban.attachFile, { cardId, fileId });
    const file = await t.run(async (ctx) => await ctx.db.get(fileId));
    if (!file) throw new Error("Missing file");
    await expect(alice.mutation(api.kanban.deleteCard, { cardId })).rejects.toThrow(
      "Missing Kanban permission",
    );
    await owner.mutation(api.kanban.deleteCard, { cardId });
    expect(await alice.query(api.kanban.listCards, { boardId })).toHaveLength(0);
    await t.finishAllScheduledFunctions(() => {});
    expect(await t.run(async (ctx) => await ctx.db.query("kanbanComments").collect())).toHaveLength(
      0,
    );
    expect(await t.run(async (ctx) => await ctx.db.query("kanbanActivity").collect())).toHaveLength(
      0,
    );
    expect(await t.run(async (ctx) => await ctx.db.get(fileId))).toBeNull();
    expect(await t.run(async (ctx) => await ctx.storage.get(file.storageId))).toBeNull();
    const second = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "Board cleanup",
    });
    await alice.mutation(api.kanban.comment, { cardId: second, body: "Delete with board" });
    await expect(alice.mutation(api.kanban.deleteBoard, { boardId })).rejects.toThrow(
      "Missing Kanban permission",
    );
    await owner.mutation(api.kanban.deleteBoard, { boardId });
    expect(await alice.query(api.kanban.listBoards)).toHaveLength(0);
    await expect(alice.query(api.kanban.listCards, { boardId })).rejects.toThrow("Board not found");
    await t.finishAllScheduledFunctions(() => {});
    expect(await t.run(async (ctx) => await ctx.db.get(boardId))).toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.get(second))).toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.query("kanbanComments").collect())).toHaveLength(
      0,
    );
  });
});
