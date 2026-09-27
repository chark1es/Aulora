import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

async function setup() {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
  const channelId = await seedChannel(t);
  const asUser1 = t.withIdentity({ subject: "user-1" });
  const send = (mentionUserIds: string[] = []) =>
    asUser1.mutation(api.messages.send, {
      channelId,
      body: "bXNn",
      mentionUserIds,
    });
  return { t, channelId, asUser1, send };
}

describe("readStates.set", () => {
  it("counts mentions strictly after the cursor", async () => {
    const { channelId, asUser1, send } = await setup();
    const m1 = await send();
    await send(["user-1"]);
    await send();
    const m4 = await send(["user-1"]);

    const atStart = await asUser1.mutation(api.readStates.set, {
      channelId,
      lastReadMessageId: m1,
    });
    expect(atStart.mentionCount).toBe(2);

    const atEnd = await asUser1.mutation(api.readStates.set, {
      channelId,
      lastReadMessageId: m4,
    });
    expect(atEnd.mentionCount).toBe(0);
  });

  it("ignores deleted messages when counting mentions", async () => {
    const { channelId, asUser1, send } = await setup();
    const m1 = await send();
    const m2 = await send(["user-1"]);
    await asUser1.mutation(api.messages.remove, { messageId: m2 });

    const result = await asUser1.mutation(api.readStates.set, {
      channelId,
      lastReadMessageId: m1,
    });
    expect(result.mentionCount).toBe(0);
  });

  it("does not count mentions for other users", async () => {
    const { channelId, asUser1, send } = await setup();
    const m1 = await send();
    await send(["user-2"]);

    const result = await asUser1.mutation(api.readStates.set, {
      channelId,
      lastReadMessageId: m1,
    });
    expect(result.mentionCount).toBe(0);
  });

  it("returns null before a cursor is set and the state afterwards", async () => {
    const { channelId, asUser1, send } = await setup();
    expect(await asUser1.query(api.readStates.get, { channelId })).toBeNull();
    const m1 = await send(["user-1"]);
    await asUser1.mutation(api.readStates.set, { channelId, lastReadMessageId: m1 });
    expect(await asUser1.query(api.readStates.get, { channelId })).toEqual({
      channelId,
      lastReadMessageId: m1,
      mentionCount: 0,
    });
  });

  it("requires ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await expect(asUser1.mutation(api.readStates.set, { channelId })).rejects.toThrow(
      "Missing permission",
    );
  });
});

describe("readStates.set cursor", () => {
  it("never moves the read cursor backwards", async () => {
    const { channelId, asUser1, send } = await setup();
    const m1 = await send();
    const m2 = await send();

    await asUser1.mutation(api.readStates.set, { channelId, lastReadMessageId: m2 });
    const result = await asUser1.mutation(api.readStates.set, {
      channelId,
      lastReadMessageId: m1,
    });
    expect(result.lastReadMessageId).toBe(m2);
    const state = await asUser1.query(api.readStates.get, { channelId });
    expect(state?.lastReadMessageId).toBe(m2);
  });
});

describe("readStates.summary", () => {
  it("reports unread messages and live mention counts from other people", async () => {
    const { t, channelId, send } = await setup();
    const asUser2 = t.withIdentity({ subject: "user-2" });

    let [row] = await asUser2.query(api.readStates.summary, { channelIds: [channelId] });
    expect(row).toMatchObject({ unread: false, mentionCount: 0, lastActivityAt: null });

    const first = await send();
    await send(["user-2"]);
    await send(["user-2"]);
    [row] = await asUser2.query(api.readStates.summary, { channelIds: [channelId] });
    expect(row).toMatchObject({ unread: true, mentionCount: 2, lastAuthorId: "user-1" });
    expect(row?.lastActivityAt).toEqual(expect.any(Number));

    // Reading past the first message leaves both mentions unread.
    await asUser2.mutation(api.readStates.set, { channelId, lastReadMessageId: first });
    [row] = await asUser2.query(api.readStates.summary, { channelIds: [channelId] });
    expect(row).toMatchObject({ unread: true, mentionCount: 2 });

    // A mention that arrives after the cursor moved still counts, live.
    const last = await send(["user-2"]);
    [row] = await asUser2.query(api.readStates.summary, { channelIds: [channelId] });
    expect(row?.mentionCount).toBe(3);

    await asUser2.mutation(api.readStates.set, { channelId, lastReadMessageId: last });
    [row] = await asUser2.query(api.readStates.summary, { channelIds: [channelId] });
    expect(row).toMatchObject({ unread: false, mentionCount: 0 });
  });

  it("does not count the caller's own messages as unread", async () => {
    const { channelId, asUser1, send } = await setup();
    await send(["user-1"]);
    const [row] = await asUser1.query(api.readStates.summary, { channelIds: [channelId] });
    expect(row).toMatchObject({ unread: false, mentionCount: 0, lastAuthorId: "user-1" });
  });

  it("ignores deleted messages and thread replies", async () => {
    const { t, channelId, asUser1, send } = await setup();
    const asUser2 = t.withIdentity({ subject: "user-2" });
    const root = await send();
    await asUser2.mutation(api.readStates.set, { channelId, lastReadMessageId: root });
    await asUser1.mutation(api.messages.send, {
      channelId,
      body: "cmVwbHk=",
      threadRootId: root,
      mentionUserIds: ["user-2"],
    });
    const deleted = await send(["user-2"]);
    await asUser1.mutation(api.messages.remove, { messageId: deleted });

    const [row] = await asUser2.query(api.readStates.summary, { channelIds: [channelId] });
    expect(row).toMatchObject({ unread: false, mentionCount: 0 });
  });

  it("omits channels the caller cannot view instead of failing", async () => {
    const { t, channelId } = await setup();
    const hidden = await seedChannel(t, {
      overrides: [
        { targetId: "user-2", targetType: "member", allow: 0n, deny: Permission.ViewChannel },
      ],
    });
    const asUser2 = t.withIdentity({ subject: "user-2" });
    const rows = await asUser2.query(api.readStates.summary, { channelIds: [hidden, channelId] });
    expect(rows.map((row) => row.channelId)).toEqual([channelId]);
  });
});
