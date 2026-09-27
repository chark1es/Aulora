import { describe, expect, it } from "vitest";
import type { ChannelSummary, ChatSubscriptions, MessagePayload } from "../src/chat/index.js";
import { ChatSession } from "../src/chat/index.js";
import { createMockPort, type MockPort } from "../src/chat/testing.js";

function makeSession(port: MockPort): ChatSession {
  return ChatSession.create({ port, subscriptions: port });
}

function channelFor(id: string, name: string | null = null): ChannelSummary {
  return { id, kind: "text", categoryId: null, name, topic: null, archived: false };
}

function incoming(
  overrides: Partial<MessagePayload> & { id: string; channelId: string },
): MessagePayload {
  return {
    authorId: "user-other",
    body: "",
    threadRootId: null,
    attachmentIds: [],
    mentionUserIds: [],
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: 1,
    ...overrides,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ChatSession start", () => {
  it("operates without any crypto engine or device setup", async () => {
    const port = createMockPort();
    const session = makeSession(port);
    await session.start();
    await session.start();

    expect(port.state.calls.some((call) => call.method === "upsertDevice")).toBe(false);
    expect(port.state.calls.some((call) => call.method.includes("KeyPackage"))).toBe(false);
  });

  it("hydrates channel names from the channel subscription", async () => {
    const port = createMockPort();
    const channelId = await port.createChannel({ kind: "text", name: "general" });
    const session = makeSession(port);
    await session.start();

    expect(session.channelNameFor(channelId, null)).toBe("general");
  });
});

describe("ChatSession plaintext messages", () => {
  it("sends the plaintext body through the port and caches it", async () => {
    const port = createMockPort();
    const session = makeSession(port);
    await session.start();
    await session.openChannel(channelFor("c1"));

    const messageId = await session.sendMessage("c1", "hello world");
    const stored = port.state.messages.get(messageId);
    expect(stored?.body).toBe("hello world");
    expect(session.decryptedText(messageId)).toBe("hello world");

    const sendCall = port.state.calls.find((call) => call.method === "sendMessage");
    expect(sendCall?.args).toMatchObject({ channelId: "c1", body: "hello world" });
  });

  it("forwards replyToId through the port and caches it in the body", async () => {
    const port = createMockPort();
    const session = makeSession(port);
    await session.start();
    await session.openChannel(channelFor("c1"));

    const original = await session.sendMessage("c1", "original");
    const reply = await session.sendMessage("c1", "reply", { replyToId: original });

    const sendCall = port.state.calls
      .filter((call) => call.method === "sendMessage")
      .find((call) => (call.args as { body?: string }).body === "reply");
    expect(sendCall?.args).toMatchObject({ channelId: "c1", body: "reply", replyToId: original });
    expect(port.state.messages.get(reply)?.replyToId).toBe(original);
    expect(session.decryptedBody(reply)?.replyToId).toBe(original);
  });

  it("ingests received plaintext and notifies onDecrypted", async () => {
    const port = createMockPort();
    const session = makeSession(port);
    await session.start();
    await session.openChannel(channelFor("c1"));

    const seen: string[] = [];
    session.onDecrypted((messages) => {
      for (const message of messages) {
        seen.push(message.id);
      }
    });

    const result = session.receiveMessages([
      incoming({ id: "m1", channelId: "c1", body: "hi alice" }),
    ]);
    expect(typeof result.then).toBe("function");
    await result;

    expect(session.decryptedText("m1")).toBe("hi alice");
    expect(session.decryptedBody("m1")?.t).toBe("hi alice");
    expect(seen).toContain("m1");
  });

  it("ignores deleted messages", async () => {
    const port = createMockPort();
    const session = makeSession(port);
    await session.start();
    await session.openChannel(channelFor("c1"));

    await session.receiveMessages([
      incoming({ id: "m1", channelId: "c1", body: "gone", deletedAt: 123 }),
    ]);
    expect(session.decryptedText("m1")).toBe("");
    expect(session.decryptedBody("m1")).toBeUndefined();
  });

  it("ingests the live tail when a channel is opened", async () => {
    const port = createMockPort();
    const messageId = await port.sendMessage({ channelId: "c1", body: "existing" });
    const session = makeSession(port);
    await session.start();
    await session.openChannel(channelFor("c1"));
    await tick();

    expect(session.decryptedText(messageId)).toBe("existing");
  });

  it("edits, deletes and reacts through the port", async () => {
    const port = createMockPort();
    const session = makeSession(port);
    await session.start();
    await session.openChannel(channelFor("c1"));
    const messageId = await session.sendMessage("c1", "first");

    await session.editMessage("c1", messageId, "second");
    expect(port.state.messages.get(messageId)?.body).toBe("second");
    expect(session.decryptedText(messageId)).toBe("second");

    await session.toggleReaction("c1", messageId, "thumbs-up");
    expect(port.state.reactions.get(messageId)?.[0]?.emoji).toBe("thumbs-up");
    const resolved = await session.loadReactions(
      "c1",
      messageId,
      port.state.reactions.get(messageId) ?? [],
    );
    expect(resolved[0]?.emoji).toBe("thumbs-up");

    const reactionEvents: number[] = [];
    session.onReactions(messageId, (rows) => reactionEvents.push(rows.length));
    expect(reactionEvents.length).toBeGreaterThan(0);

    await session.deleteMessage("c1", messageId);
    expect(port.state.messages.get(messageId)?.deletedAt).not.toBeNull();
    expect(session.decryptedText(messageId)).toBe("");
  });
});

describe("ChatSession attachments", () => {
  it("resolves descriptors from the message's attachment ids", async () => {
    const port = createMockPort();
    const session = makeSession(port);
    await session.start();
    await session.openChannel(channelFor("c1"));

    const fileId = await port.uploadFile({
      name: "secret.png",
      mime: "image/png",
      bytes: new Uint8Array([1, 2, 3, 4]),
      dimensions: { width: 64, height: 32 },
    });
    const messageId = await session.sendMessage("c1", "", { attachmentIds: [fileId] });

    expect(port.state.messages.get(messageId)?.attachmentIds).toEqual([fileId]);
    expect(session.decryptedBody(messageId)?.attachments?.length).toBe(1);
    expect(session.attachmentsFor(messageId)[0]?.name).toBe("secret.png");
    expect(session.attachmentsFor(messageId)[0]?.dimensions).toEqual({ width: 64, height: 32 });
  });

  it("resolves attachments for received messages", async () => {
    const port = createMockPort();
    const session = makeSession(port);
    await session.start();
    await session.openChannel(channelFor("c1"));

    const fileId = await port.uploadFile({
      name: "report.pdf",
      mime: "application/pdf",
      bytes: new Uint8Array([9, 8, 7]),
    });
    await session.receiveMessages([
      incoming({ id: "m1", channelId: "c1", body: "see file", attachmentIds: [fileId] }),
    ]);

    expect(session.attachmentsFor("m1")[0]?.name).toBe("report.pdf");
  });
});

describe("ChatSession channel names", () => {
  it("falls back to a placeholder when the name is unknown", () => {
    const port = createMockPort();
    const session = makeSession(port);
    expect(session.channelNameFor("c1", null)).toBe("channel");
  });

  it("renames a channel with its plaintext name", async () => {
    const port = createMockPort();
    const session = makeSession(port);
    await session.start();
    await session.openChannel(channelFor("c1", "general"));

    await session.setChannelName("c1", "renamed");
    const renameCall = port.state.calls.find((call) => call.method === "renameChannel");
    expect(renameCall?.args).toMatchObject({ channelId: "c1", name: "renamed" });
    expect(session.channelNameFor("c1", null)).toBe("renamed");
  });

  it("caches names from hydrateChannelNames", () => {
    const port = createMockPort();
    const session = makeSession(port);
    session.hydrateChannelNames([channelFor("c3", "three")]);
    expect(session.channelNameFor("c3", null)).toBe("three");
  });
});

describe("mock port message window", () => {
  it("returns the newest `limit` roots, oldest first, and keeps the tail live", async () => {
    const port = createMockPort();
    for (let index = 0; index < 5; index += 1) {
      await port.sendMessage({ channelId: "c1", body: `m${index}` });
    }
    const seen: string[][] = [];
    const off = port.watchMessages(
      "c1",
      (messages) => seen.push(messages.map((message) => message.body)),
      { limit: 2 },
    );
    expect(seen.at(-1)).toEqual(["m3", "m4"]);
    await port.sendMessage({ channelId: "c1", body: "m5" });
    expect(seen.at(-1)).toEqual(["m4", "m5"]);
    off();
  });

  it("bumps the reply count on a thread root", async () => {
    const port = createMockPort();
    const root = await port.sendMessage({ channelId: "c1", body: "root" });
    await port.sendMessage({ channelId: "c1", body: "reply", threadRootId: root });
    expect(port.state.messages.get(root)?.replyCount).toBe(1);
  });
});

describe("ChatSubscriptions passthrough", () => {
  it("is directly usable as the session's subscriptions", () => {
    const port = createMockPort();
    const subscriptions: ChatSubscriptions = port;
    expect(typeof subscriptions.watchChannels).toBe("function");
  });
});
