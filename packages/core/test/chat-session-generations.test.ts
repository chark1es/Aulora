import { describe, expect, it, vi } from "vitest";
import { ChatSession, type MessagePayload } from "../src/chat/index.js";
import { createMockPort } from "../src/chat/testing.js";

function row(id: string, overrides: Partial<MessagePayload> = {}): MessagePayload {
  return {
    id,
    channelId: "channel",
    authorId: "user",
    body: id,
    threadRootId: null,
    attachmentIds: [],
    mentionUserIds: [],
    createdAt: 1,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

async function setup() {
  const port = createMockPort();
  const fileId = await port.uploadFile({
    name: "report.pdf",
    mime: "application/pdf",
    bytes: new Uint8Array([1]),
  });
  const files = await port.getFiles({ fileIds: [fileId] });
  let release!: (rows: typeof files) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<typeof files>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  const fetch = vi.spyOn(port, "getFiles").mockReturnValue(pending);
  const session = ChatSession.create({ port, subscriptions: port });
  return { session, port, fileId, files, release, reject, fetch };
}

function generations(session: ChatSession) {
  return session as unknown as {
    messageGenerations: Map<string, number>;
    scopeGenerations: Map<string, number>;
    pendingFiles: Map<string, Promise<void>>;
    fileDescriptors: Map<string, unknown>;
  };
}

describe("snapshot generations", () => {
  it("waits for shared attachment metadata before committing an edit", async () => {
    const { session, fileId, files, release, fetch } = await setup();
    const original = row("message", { attachmentIds: [fileId] });
    const seen: string[][] = [];
    session.onDecrypted((rows) => seen.push(rows.map((message) => message.body)));
    const first = session.receiveMessages([original], "thread:root");
    const second = session.receiveMessages(
      [{ ...original, body: "edited", editedAt: 2 }],
      "thread:root",
    );
    await Promise.resolve();
    expect(seen).toEqual([[]]);
    release(files);
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.decryptedText("message")).toBe("edited");
    expect(session.attachmentsFor("message").map((file) => file.fileId)).toEqual([fileId]);
    expect(session.decryptedBody("message")?.attachments).toEqual(
      session.attachmentsFor("message"),
    );
    expect(seen).toEqual([[], ["edited"]]);
  });

  it.each([false, true])(
    "does not restore a message omitted by a newer scope snapshot (empty=%s)",
    async (empty) => {
      const { session, fileId, files, release } = await setup();
      const seen = vi.fn();
      session.onDecrypted(seen);
      const old = session.receiveMessages(
        [row("secret", { body: "OLD secret text" }), row("other", { attachmentIds: [fileId] })],
        "thread:root",
      );
      const latest = empty ? [] : [row("other")];
      await session.receiveMessages(latest, "thread:root");
      release(files);
      await old;
      expect(session.decryptedText("secret")).toBe("");
      expect(session.decryptedBody("secret")).toBeUndefined();
      expect(seen.mock.calls).toEqual([[[]], [latest]]);
      expect(generations(session).messageGenerations.size).toBe(0);
      expect(generations(session).scopeGenerations.size).toBe(0);
    },
  );

  it("merges overlapping scopes into full, replayable listener payloads", async () => {
    const { session, fileId, files, release } = await setup();
    const messages: MessagePayload[][] = [];
    const decrypted: MessagePayload[][] = [];
    session.onMessages((rows) => messages.push([...rows]));
    session.onDecrypted((rows) => decrypted.push([...rows]));
    const unique = row("unique", { attachmentIds: [fileId] });
    const old = session.receiveMessages([row("shared"), unique], "channel:tail");
    const edited = row("shared", { body: "edited", threadRootId: "root" });
    await session.receiveMessages([edited], "thread:root");
    release(files);
    await old;
    expect(messages).toEqual([[], [edited], [edited, unique]]);
    expect(decrypted).toEqual(messages);
    const replay = vi.fn();
    session.onDecrypted(replay);
    expect(replay).toHaveBeenLastCalledWith([edited, unique]);
    expect(session.decryptedText("shared")).toBe("edited");
    expect(session.attachmentsFor("unique")[0]?.fileId).toBe(fileId);
  });

  it("keeps attachments on a thread edit overlapping pending channel hydration", async () => {
    const { session, fileId, files, release, fetch } = await setup();
    const shared = row("shared", { threadRootId: "root", attachmentIds: [fileId] });
    const channel = session.receiveMessages([shared, row("channel-only")], "channel:tail");
    const thread = session.receiveMessages(
      [{ ...shared, body: "thread edit", editedAt: 2 }],
      "thread:root",
    );
    release(files);
    await Promise.all([channel, thread]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.decryptedText("shared")).toBe("thread edit");
    expect(session.attachmentsFor("shared")[0]?.fileId).toBe(fileId);
    expect(session.decryptedText("channel-only")).toBe("channel-only");
  });

  it("hydrates two thread scopes independently with shared pending metadata", async () => {
    const { session, fileId, files, release, fetch } = await setup();
    const first = session.receiveMessages(
      [row("a", { threadRootId: "a-root", attachmentIds: [fileId] })],
      "thread:a-root",
    );
    const second = session.receiveMessages(
      [row("b", { threadRootId: "b-root", attachmentIds: [fileId] })],
      "thread:b-root",
    );
    release(files);
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.decryptedText("a")).toBe("a");
    expect(session.decryptedText("b")).toBe("b");
    expect(session.attachmentsFor("a")[0]?.fileId).toBe(fileId);
    expect(session.attachmentsFor("b")[0]?.fileId).toBe(fileId);
  });

  it("an empty snapshot invalidates only its own pending scope", async () => {
    const { session, fileId, files, release } = await setup();
    const first = session.receiveMessages([row("a", { attachmentIds: [fileId] })], "thread:a-root");
    const second = session.receiveMessages(
      [row("b", { attachmentIds: [fileId] })],
      "thread:b-root",
    );
    await session.receiveMessages([], "thread:a-root");
    release(files);
    await Promise.all([first, second]);
    expect(session.decryptedBody("a")).toBeUndefined();
    expect(session.decryptedText("b")).toBe("b");
    expect(session.attachmentsFor("b")[0]?.fileId).toBe(fileId);
    const replay = vi.fn();
    session.onMessages(replay);
    expect(replay.mock.lastCall?.[0].map((message: MessagePayload) => message.id)).toEqual(["b"]);
  });

  it("cleans generations after thousands of tombstones and failed hydration", async () => {
    const { session, fileId, reject } = await setup();
    for (let page = 0; page < 50; page++) {
      await session.receiveMessages(
        Array.from({ length: 100 }, (_, i) =>
          row(`m${page * 100 + i}`, { body: "", deletedAt: 2 }),
        ),
        "channel:tail",
      );
    }
    expect(generations(session).messageGenerations.size).toBe(0);
    const failed = session.receiveMessages(
      [row("failed", { attachmentIds: [fileId] })],
      "test:stream",
    );
    reject(new Error("metadata unavailable"));
    await expect(failed).rejects.toThrow("metadata unavailable");
    expect(generations(session).messageGenerations.size).toBe(0);
    expect(generations(session).scopeGenerations.size).toBe(0);
    expect(generations(session).pendingFiles.size).toBe(0);
  });

  it("invalidates pending hydration when disposed", async () => {
    const { session, fileId, files, release } = await setup();
    const pending = session.receiveMessages(
      [row("message", { attachmentIds: [fileId] })],
      "test:stream",
    );
    session.dispose();
    release(files);
    await pending;
    expect(generations(session).messageGenerations.size).toBe(0);
    expect(generations(session).scopeGenerations.size).toBe(0);
    expect(generations(session).pendingFiles.size).toBe(0);
    expect(generations(session).fileDescriptors.size).toBe(0);
    expect(session.decryptedText("message")).toBe("");
    await session.receiveMessages([row("after-dispose")], "test:stream");
    expect(session.decryptedText("after-dispose")).toBe("");
  });

  it("invalidates an in-flight message when deleteMessage succeeds", async () => {
    const { session, fileId, files, release, port } = await setup();
    vi.spyOn(port, "deleteMessage").mockResolvedValue(null);
    const pending = session.receiveMessages(
      [row("message", { attachmentIds: [fileId] })],
      "test:stream",
    );
    await session.deleteMessage("channel", "message");
    expect(generations(session).messageGenerations.size).toBe(0);
    release(files);
    await pending;
    expect(session.decryptedBody("message")).toBeUndefined();
    expect(session.attachmentsFor("message")).toEqual([]);
  });
});
