import { Permission } from "@aulora/core";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

const PAGE = { numItems: 10, cursor: null } as const;

afterEach(() => {
  delete process.env.SEND_RATE_LIMIT;
});

describe("messages.send and list", () => {
  it("stores ciphertext and paginates the channel timeline", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    for (let i = 0; i < 3; i += 1) {
      await asUser.mutation(api.messages.send, {
        channelId,
        ciphertext: `Y2lwaGVyLXRleHQt${i}`,
        epoch: 0,
      });
    }

    const first = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page).toHaveLength(2);
    expect(first.page[0]?.ciphertext).toBe("Y2lwaGVyLXRleHQt0");
    expect(first.isDone).toBe(false);

    const second = await asUser.query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
  });

  it("excludes thread replies from the main list and returns them from listThread", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    const rootId = await asUser.mutation(api.messages.send, {
      channelId,
      ciphertext: "cm9vdA==",
      epoch: 0,
    });
    await asUser.mutation(api.messages.send, {
      channelId,
      ciphertext: "cmVwbHk=",
      epoch: 0,
      threadRootId: rootId,
    });

    const main = await asUser.query(api.messages.list, { channelId, paginationOpts: PAGE });
    expect(main.page.map((m) => m.ciphertext)).toEqual(["cm9vdA=="]);

    const thread = await asUser.query(api.messages.listThread, {
      threadRootId: rootId,
      paginationOpts: PAGE,
    });
    expect(thread.page.map((m) => m.ciphertext)).toEqual(["cmVwbHk="]);
  });

  it("requires SendMessages to send", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ViewChannel | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(
      asUser.mutation(api.messages.send, { channelId, ciphertext: "eA==", epoch: 0 }),
    ).rejects.toThrow("Missing permission");
  });

  it("requires SendInThreads to reply in a thread", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions:
        Permission.ViewChannel | Permission.SendMessages | Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });
    const rootId = await asUser.mutation(api.messages.send, {
      channelId,
      ciphertext: "cm9vdA==",
      epoch: 0,
    });
    await expect(
      asUser.mutation(api.messages.send, {
        channelId,
        ciphertext: "cmVwbHk=",
        epoch: 0,
        threadRootId: rootId,
      }),
    ).rejects.toThrow("Missing permission");
  });

  it("enforces the per-user send rate limit", async () => {
    process.env.SEND_RATE_LIMIT = "2";
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser = t.withIdentity({ subject: "user-1" });

    await asUser.mutation(api.messages.send, { channelId, ciphertext: "MQ==", epoch: 0 });
    await asUser.mutation(api.messages.send, { channelId, ciphertext: "Mg==", epoch: 0 });
    await expect(
      asUser.mutation(api.messages.send, { channelId, ciphertext: "Mw==", epoch: 0 }),
    ).rejects.toThrow("Rate limit exceeded");
  });
});

describe("messages.edit and delete", () => {
  async function sendAsUser1(t: ReturnType<typeof newTest>) {
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const messageId = await asUser1.mutation(api.messages.send, {
      channelId,
      ciphertext: "b3JpZ2luYWw=",
      epoch: 0,
    });
    return { channelId, messageId, asUser1 };
  }

  it("lets the author edit and sets editedAt", async () => {
    const t = newTest();
    const { messageId, asUser1 } = await sendAsUser1(t);
    await asUser1.mutation(api.messages.edit, { messageId, ciphertext: "ZWRpdGVk" });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(message?.ciphertext).toBe("ZWRpdGVk");
    expect(message?.editedAt).toBeTypeOf("number");
  });

  it("refuses an edit by a non-author without ManageMessages", async () => {
    const t = newTest();
    const { messageId } = await sendAsUser1(t);
    const asUser2 = t.withIdentity({ subject: "user-2" });
    await expect(
      asUser2.mutation(api.messages.edit, { messageId, ciphertext: "aGFjaw==" }),
    ).rejects.toThrow("Missing permission");
  });

  it("lets a moderator with ManageMessages edit", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      extraRoles: [{ key: "mod", permissions: Permission.ViewChannel | Permission.ManageMessages }],
      members: [{ userId: "user-1" }, { userId: "user-2", roleIds: ["mod"] }],
    });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const messageId = await asUser1.mutation(api.messages.send, {
      channelId,
      ciphertext: "b3JpZ2luYWw=",
      epoch: 0,
    });
    const asMod = t.withIdentity({ subject: "user-2" });
    await asMod.mutation(api.messages.edit, { messageId, ciphertext: "bW9kLWVkaXQ=" });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(message?.ciphertext).toBe("bW9kLWVkaXQ=");
  });

  it("soft-deletes as the author and writes an audit row", async () => {
    const t = newTest();
    const { messageId, asUser1 } = await sendAsUser1(t);
    await asUser1.mutation(api.messages.remove, { messageId });
    const message = await t.run(async (ctx) => await ctx.db.get(messageId));
    expect(message?.deletedAt).toBeTypeOf("number");
    expect(message?.ciphertext).toBe("b3JpZ2luYWw=");
    const audit = await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
    expect(audit.some((row) => row.action === "message.delete")).toBe(true);
  });

  it("refuses a delete by a non-author without ManageMessages", async () => {
    const t = newTest();
    const { messageId } = await sendAsUser1(t);
    const asUser2 = t.withIdentity({ subject: "user-2" });
    await expect(asUser2.mutation(api.messages.remove, { messageId })).rejects.toThrow(
      "Missing permission",
    );
  });
});

describe("messages pins", () => {
  async function setup() {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions:
        Permission.ViewChannel | Permission.SendMessages | Permission.ReadHistory,
      extraRoles: [{ key: "pinner", permissions: Permission.ViewChannel | Permission.PinMessages }],
      members: [{ userId: "user-1" }, { userId: "pinner-user", roleIds: ["pinner"] }],
    });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const messageId = await asUser1.mutation(api.messages.send, {
      channelId,
      ciphertext: "cGluLW1l",
      epoch: 0,
    });
    return { t, channelId, messageId };
  }

  it("pins and unpins with PinMessages and lists pins", async () => {
    const { t, channelId, messageId } = await setup();
    const asPinner = t.withIdentity({ subject: "pinner-user" });
    await asPinner.mutation(api.messages.pin, { messageId });

    const pins = await asPinner.query(api.messages.listPins, {
      channelId,
      paginationOpts: PAGE,
    });
    expect(pins.page.map((m) => m.id)).toContain(messageId);

    await asPinner.mutation(api.messages.unpin, { messageId });
    const after = await asPinner.query(api.messages.listPins, {
      channelId,
      paginationOpts: PAGE,
    });
    expect(after.page).toHaveLength(0);
  });

  it("refuses pin without PinMessages", async () => {
    const { t, messageId } = await setup();
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await expect(asUser1.mutation(api.messages.pin, { messageId })).rejects.toThrow(
      "Missing permission",
    );
  });
});
