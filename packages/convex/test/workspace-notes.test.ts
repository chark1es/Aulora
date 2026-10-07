import { diffLines, Permission } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { isSealed } from "../convex/lib/sse";
import { newTest, seedWorkspace, type Test } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FULL =
  Permission.ViewNotes | Permission.CreateNotes | Permission.EditNotes | Permission.DeleteNotes;

async function setup(permissions = FULL) {
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: permissions,
    members: [{ userId: "alice" }, { userId: "bob" }],
  });
  const owner = t.withIdentity({ subject: "owner-1" });
  await owner.mutation(api.workspaceNotes.setEnabled, { enabled: true });
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  return { t, owner, alice, bob };
}

async function enable(t: Test, userId = "owner-1") {
  await t
    .withIdentity({ subject: userId })
    .mutation(api.workspaceNotes.setEnabled, { enabled: true });
}

describe("Notes authorization", () => {
  it("is off by default and only workspace managers may enable it", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: FULL,
      members: [{ userId: "alice" }],
    });
    expect((await t.query(api.server.publicConfig)).addons.notes).toBe(false);
    const alice = t.withIdentity({ subject: "alice" });
    await expect(alice.query(api.workspaceNotes.overview)).rejects.toThrow("disabled");
    await expect(alice.mutation(api.workspaceNotes.setEnabled, { enabled: true })).rejects.toThrow(
      "Missing permission",
    );
    await enable(t);
    expect((await t.query(api.server.publicConfig)).addons.notes).toBe(true);
    await expect(alice.query(api.workspaceNotes.overview)).resolves.toEqual({
      folders: [],
      notes: [],
      tags: [],
    });
    await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.workspaceNotes.setEnabled, { enabled: false });
    expect((await t.query(api.server.publicConfig)).addons.notes).toBe(false);
  });

  it("rejects anonymous users, non-members and banned members", async () => {
    const { t, alice } = await setup();
    await expect(t.query(api.workspaceNotes.overview)).rejects.toThrow("Not authenticated");
    await expect(
      t.withIdentity({ subject: "outsider" }).query(api.workspaceNotes.overview),
    ).rejects.toThrow("Not a member");
    await t.run(async (ctx) => {
      await ctx.db.insert("bans", { userId: "alice", actorId: "owner-1", at: Date.now() });
    });
    await expect(alice.query(api.workspaceNotes.overview)).rejects.toThrow("banned");
    await expect(
      alice.mutation(api.workspaceNotes.createNote, { title: "No", body: "" }),
    ).rejects.toThrow("banned");
  });

  it("maps create, edit and delete permissions to the right operations", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewNotes,
      extraRoles: [
        { key: "creator", permissions: Permission.CreateNotes },
        { key: "editor", permissions: Permission.EditNotes },
        { key: "deleter", permissions: Permission.DeleteNotes },
      ],
      members: [
        { userId: "viewer" },
        { userId: "creator", roleIds: ["creator"] },
        { userId: "editor", roleIds: ["editor"] },
        { userId: "deleter", roleIds: ["deleter"] },
      ],
    });
    await enable(t);
    const viewer = t.withIdentity({ subject: "viewer" });
    const creator = t.withIdentity({ subject: "creator" });
    const editor = t.withIdentity({ subject: "editor" });
    const deleter = t.withIdentity({ subject: "deleter" });

    await expect(viewer.query(api.workspaceNotes.overview)).resolves.toBeTruthy();
    await expect(
      viewer.mutation(api.workspaceNotes.createNote, { title: "No", body: "" }),
    ).rejects.toThrow("Missing Notes permission");
    await expect(viewer.mutation(api.workspaceNotes.createFolder, { name: "No" })).rejects.toThrow(
      "Missing Notes permission",
    );

    const noteId = await creator.mutation(api.workspaceNotes.createNote, {
      title: "Draft",
      body: "hello",
    });
    await expect(
      creator.mutation(api.workspaceNotes.updateNote, {
        noteId,
        revision: 0,
        title: "Draft",
        body: "hello",
        tagIds: [],
      }),
    ).rejects.toThrow("Missing Notes permission");
    await expect(creator.mutation(api.workspaceNotes.deleteNote, { noteId })).rejects.toThrow(
      "Missing Notes permission",
    );

    await editor.mutation(api.workspaceNotes.updateNote, {
      noteId,
      revision: 0,
      title: "Draft 2",
      body: "hello",
      tagIds: [],
    });
    await expect(
      deleter.mutation(api.workspaceNotes.updateNote, {
        noteId,
        revision: 1,
        title: "Draft 2",
        body: "hello",
        tagIds: [],
      }),
    ).rejects.toThrow("Missing Notes permission");
    await expect(deleter.mutation(api.workspaceNotes.deleteNote, { noteId })).resolves.toBeNull();
    await expect(t.run(async (ctx) => await ctx.db.get(noteId))).resolves.toBeNull();
  });

  it("writes audit rows for enable and destructive actions", async () => {
    const { t, alice } = await setup();
    const folderId = await alice.mutation(api.workspaceNotes.createFolder, { name: "F" });
    const tagId = await alice.mutation(api.workspaceNotes.createTag, {
      name: "T",
      color: "#123456",
    });
    const noteId = await alice.mutation(api.workspaceNotes.createNote, {
      title: "N",
      body: "",
    });
    await alice.mutation(api.workspaceNotes.deleteNote, { noteId });
    await alice.mutation(api.workspaceNotes.deleteFolder, { folderId });
    await alice.mutation(api.workspaceNotes.deleteTag, { tagId });
    const actions = await t.run(async (ctx) =>
      (await ctx.db.query("auditLog").collect()).map((row) => row.action),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "workspaceNotes.setEnabled",
        "workspaceNotes.deleteNote",
        "workspaceNotes.deleteFolder",
        "workspaceNotes.deleteTag",
      ]),
    );
  });
});

describe("Notes storage and CRUD", () => {
  it("seals all content at rest and never stores plaintext", async () => {
    const { t, alice } = await setup();
    const folderId = await alice.mutation(api.workspaceNotes.createFolder, {
      name: "CANARY-FOLDER",
    });
    const tagId = await alice.mutation(api.workspaceNotes.createTag, {
      name: "CANARY-TAG",
      color: "#aabbcc",
    });
    const noteId = await alice.mutation(api.workspaceNotes.createNote, {
      folderId,
      title: "CANARY-TITLE",
      body: "CANARY-BODY",
      tagIds: [tagId],
    });
    const stored = await t.run(async (ctx) => ({
      folder: await ctx.db.get(folderId),
      tag: await ctx.db.get(tagId),
      note: await ctx.db.get(noteId),
      revisions: (await ctx.db.query("noteRevisions").collect()).filter(
        (row) => row.noteId === noteId,
      ),
    }));
    expect(isSealed(stored.note?.titleCiphertext ?? "")).toBe(true);
    expect(isSealed(stored.note?.bodyCiphertext ?? "")).toBe(true);
    expect(stored.note?.titleCiphertext).not.toContain("CANARY");
    expect(stored.note?.bodyCiphertext).not.toContain("CANARY");
    expect(isSealed(stored.folder?.nameCiphertext ?? "")).toBe(true);
    expect(stored.folder?.nameCiphertext).not.toContain("CANARY");
    expect(isSealed(stored.tag?.nameCiphertext ?? "")).toBe(true);
    expect(stored.tag?.nameCiphertext).not.toContain("CANARY");
    expect(stored.revisions).toHaveLength(1);
    expect(isSealed(stored.revisions[0]?.afterCiphertext ?? "")).toBe(true);
    expect(stored.revisions[0]?.afterCiphertext).not.toContain("CANARY");
  });

  it("round-trips notes and records sealed before/after revisions", async () => {
    const { t, alice } = await setup();
    const noteId = await alice.mutation(api.workspaceNotes.createNote, {
      title: "Plan",
      body: "one",
    });
    const detail = await alice.query(api.workspaceNotes.get, { noteId });
    expect(detail).toMatchObject({
      id: noteId,
      title: "Plan",
      body: "one",
      folderId: null,
      revision: 0,
      archived: false,
    });
    const revision = await alice.mutation(api.workspaceNotes.updateNote, {
      noteId,
      revision: 0,
      title: "Plan",
      body: "one\ntwo",
      tagIds: [],
    });
    expect(revision).toBe(1);
    const history = await alice.query(api.workspaceNotes.history, { noteId });
    expect(history.map((row) => row.action)).toEqual(["updated", "created"]);
    const latest = history[0];
    expect(latest?.before?.body).toBe("one");
    expect(latest?.after?.body).toBe("one\ntwo");
    const lines = diffLines(latest?.before?.body ?? "", latest?.after?.body ?? "");
    expect(lines.some((line) => line.type === "add" && line.text === "two")).toBe(true);
    await expect(
      alice.mutation(api.workspaceNotes.updateNote, {
        noteId,
        revision: 0,
        title: "Plan",
        body: "stale",
        tagIds: [],
      }),
    ).rejects.toThrow("The note changed");
    const raw = await t.run(async (ctx) =>
      (await ctx.db.query("noteRevisions").collect()).filter((row) => row.noteId === noteId),
    );
    expect(raw.every((row) => isSealed(row.beforeCiphertext ?? row.afterCiphertext ?? ""))).toBe(
      true,
    );
  });

  it("classifies rename, move, tag, content and archive revisions", async () => {
    const { alice } = await setup();
    const noteId = await alice.mutation(api.workspaceNotes.createNote, { title: "A", body: "b" });
    const folderId = await alice.mutation(api.workspaceNotes.createFolder, { name: "F" });
    const tagId = await alice.mutation(api.workspaceNotes.createTag, {
      name: "T",
      color: "#112233",
    });
    await alice.mutation(api.workspaceNotes.updateNote, {
      noteId,
      revision: 0,
      title: "A2",
      body: "b",
      tagIds: [],
    });
    await alice.mutation(api.workspaceNotes.updateNote, {
      noteId,
      revision: 1,
      title: "A2",
      body: "b",
      folderId,
      tagIds: [],
    });
    await alice.mutation(api.workspaceNotes.updateNote, {
      noteId,
      revision: 2,
      title: "A2",
      body: "b",
      folderId,
      tagIds: [tagId],
    });
    await alice.mutation(api.workspaceNotes.updateNote, {
      noteId,
      revision: 3,
      title: "A2",
      body: "b2",
      folderId,
      tagIds: [tagId],
    });
    await alice.mutation(api.workspaceNotes.archiveNote, { noteId, archived: true });
    const history = await alice.query(api.workspaceNotes.history, { noteId });
    expect(history.map((row) => row.action)).toEqual([
      "archived",
      "updated",
      "tagged",
      "moved",
      "renamed",
      "created",
    ]);
    const overview = await alice.query(api.workspaceNotes.overview);
    expect(overview.notes.find((note) => note.id === noteId)?.archived).toBe(true);
    await alice.mutation(api.workspaceNotes.archiveNote, { noteId, archived: false });
    expect((await alice.query(api.workspaceNotes.get, { noteId })).archived).toBe(false);
  });

  it("enforces folder and tag references and text limits", async () => {
    const { alice } = await setup();
    const folderId = await alice.mutation(api.workspaceNotes.createFolder, { name: "F" });
    await alice.mutation(api.workspaceNotes.deleteFolder, { folderId });
    await expect(
      alice.mutation(api.workspaceNotes.createNote, { folderId, title: "Bad", body: "" }),
    ).rejects.toThrow("Folder not found");
    const tagId = await alice.mutation(api.workspaceNotes.createTag, {
      name: "T",
      color: "#123456",
    });
    await alice.mutation(api.workspaceNotes.deleteTag, { tagId });
    await expect(
      alice.mutation(api.workspaceNotes.createNote, { title: "Bad", body: "", tagIds: [tagId] }),
    ).rejects.toThrow("Tag not found");
    await expect(
      alice.mutation(api.workspaceNotes.createNote, { title: "", body: "" }),
    ).rejects.toThrow("Title");
    await expect(alice.mutation(api.workspaceNotes.createFolder, { name: "" })).rejects.toThrow(
      "Folder name",
    );
    await expect(
      alice.mutation(api.workspaceNotes.createTag, { name: "T", color: "blue" }),
    ).rejects.toThrow("hex colors");
  });
});

describe("Notes folders and tags", () => {
  it("nests folders, rejects cycles, and only deletes empty folders", async () => {
    const { alice } = await setup();
    const root = await alice.mutation(api.workspaceNotes.createFolder, { name: "Root" });
    const child = await alice.mutation(api.workspaceNotes.createFolder, {
      name: "Child",
      parentId: root,
    });
    const grandchild = await alice.mutation(api.workspaceNotes.createFolder, {
      name: "Grandchild",
      parentId: child,
    });
    await expect(
      alice.mutation(api.workspaceNotes.moveFolder, { folderId: root, parentId: grandchild }),
    ).rejects.toThrow("inside itself");
    await expect(
      alice.mutation(api.workspaceNotes.deleteFolder, { folderId: root }),
    ).rejects.toThrow("child folders");
    const noteId = await alice.mutation(api.workspaceNotes.createNote, {
      folderId: grandchild,
      title: "N",
      body: "",
    });
    await expect(
      alice.mutation(api.workspaceNotes.deleteFolder, { folderId: grandchild }),
    ).rejects.toThrow("notes in this folder");
    await alice.mutation(api.workspaceNotes.deleteNote, { noteId });
    await alice.mutation(api.workspaceNotes.moveFolder, { folderId: grandchild });
    await alice.mutation(api.workspaceNotes.deleteFolder, { folderId: grandchild });
    await alice.mutation(api.workspaceNotes.deleteFolder, { folderId: child });
    await alice.mutation(api.workspaceNotes.deleteFolder, { folderId: root });
    expect((await alice.query(api.workspaceNotes.overview)).folders).toHaveLength(0);
  });

  it("creates, updates and deletes tags, stripping them from notes", async () => {
    const { alice } = await setup();
    const tagId = await alice.mutation(api.workspaceNotes.createTag, {
      name: "Bug",
      color: "#FF0000",
    });
    await alice.mutation(api.workspaceNotes.updateTag, {
      tagId,
      name: "Defect",
      color: "#00ff00",
    });
    const noteId = await alice.mutation(api.workspaceNotes.createNote, {
      title: "Tagged",
      body: "",
      tagIds: [tagId],
    });
    expect((await alice.query(api.workspaceNotes.overview)).tags[0]).toMatchObject({
      name: "Defect",
      color: "#00ff00",
    });
    expect((await alice.query(api.workspaceNotes.get, { noteId })).tagIds).toEqual([tagId]);
    await alice.mutation(api.workspaceNotes.deleteTag, { tagId });
    expect((await alice.query(api.workspaceNotes.get, { noteId })).tagIds).toEqual([]);
    expect((await alice.query(api.workspaceNotes.overview)).tags).toHaveLength(0);
  });
});

describe("Notes search", () => {
  it("finds by title and body, honours the limit and the flag", async () => {
    const { t, alice } = await setup();
    const first = await alice.mutation(api.workspaceNotes.createNote, {
      title: "Roadmap",
      body: "quarterly planning",
    });
    await alice.mutation(api.workspaceNotes.createNote, {
      title: "Groceries",
      body: "roadmap the milk",
    });
    const byTitle = await alice.query(api.workspaceNotes.search, { query: "roadma" });
    expect(byTitle[0]?.title).toBe("Roadmap");
    expect(byTitle[0]?.id).toBe(first);
    const byBody = await alice.query(api.workspaceNotes.search, { query: "milk" });
    expect(byBody.map((hit) => hit.title)).toEqual(["Groceries"]);
    expect(byBody[0]?.snippet).toContain("milk");
    expect(
      (await alice.query(api.workspaceNotes.search, { query: "roadmap", limit: 1 })).length,
    ).toBe(1);
    expect(await alice.query(api.workspaceNotes.search, { query: "   " })).toEqual([]);
    await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.workspaceNotes.setEnabled, { enabled: false });
    await expect(alice.query(api.workspaceNotes.search, { query: "roadmap" })).rejects.toThrow(
      "disabled",
    );
  });
});
