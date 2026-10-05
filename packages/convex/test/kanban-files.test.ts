import { Permission } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { isSealed } from "../convex/lib/sse";
import { storeBlob } from "./helpers";
import { cardArgs, setup } from "./kanban-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
    await alice.mutation(api.kanbanComments.comment, { cardId, body: "Comment" });
    await alice.mutation(api.kanban.timer, { cardId, running: true });
    const c = (
      await alice.query(api.kanbanComments.comments, {
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
    await bob.mutation(api.kanbanComments.comment, {
      cardId,
      commentId: c.id,
      body: "",
      remove: true,
    });
    await bob.mutation(api.kanban.timer, { cardId, running: false });
    expect((await bob.query(api.kanban.listCards, { boardId }))[0]?.timerStartedAt).toBeUndefined();
    await expect(
      bob.mutation(api.kanban.updateCard, await cardArgs(bob, boardId, cardId)),
    ).rejects.toThrow("Missing Kanban permission");
  });
  it("deletes a card with its comments, activity and encrypted storage", async () => {
    const { t, owner, alice, boardId } = await setup();
    const cardId = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "Remove me",
    });
    await alice.mutation(api.kanbanComments.comment, { cardId, body: "History" });
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
  });
  it("deletes a board with its cards and comments", async () => {
    const { t, owner, alice, boardId } = await setup();
    const second = await alice.mutation(api.kanban.createCard, {
      boardId,
      columnId: "todo",
      title: "Board cleanup",
    });
    await alice.mutation(api.kanbanComments.comment, { cardId: second, body: "Delete with board" });
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
