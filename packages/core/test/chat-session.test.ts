import { describe, expect, it } from "vitest";
import { ChatSession, type ChatSubscriptions, decodeMlsBytes } from "../src/chat/index.js";
import { createMemoryMlsEngine, createMockPort, type MockPort } from "../src/chat/testing.js";

function silentSubscriptions(port: MockPort): ChatSubscriptions {
  return port;
}

function makeSession(port: MockPort, secret: string, displayName = "Alice"): ChatSession {
  return ChatSession.create({
    port,
    subscriptions: silentSubscriptions(port),
    engine: createMemoryMlsEngine(secret),
    user: { id: `user-${secret}`, displayName },
    identityKey: `pub-${secret}`,
  });
}

async function waitFor(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function channelFor(id: string, mlsGroupId: string | null = null) {
  return {
    id,
    kind: "text" as const,
    categoryId: null,
    nameCiphertext: null,
    topicCiphertext: null,
    mlsGroupId,
    archived: false,
    currentEpoch: null,
  };
}

describe("ChatSession sign-in", () => {
  it("registers the device and publishes unused KeyPackages", async () => {
    const port = createMockPort();
    const session = makeSession(port, "alice");
    await session.start();

    expect(session.id).toBe("device-1");
    expect(port.state.calls.filter((call) => call.method === "upsertDevice")).toHaveLength(1);
    expect(port.state.calls.filter((call) => call.method === "publishKeyPackage")).toHaveLength(3);
  });

  it("is idempotent across concurrent start calls", async () => {
    const port = createMockPort();
    const session = makeSession(port, "alice");
    await Promise.all([session.start(), session.start()]);
    expect(port.state.calls.filter((call) => call.method === "upsertDevice")).toHaveLength(1);
  });
});

describe("ChatSession channel bootstrap", () => {
  it("creates the group as the first joiner, persists the id and appends a commit", async () => {
    const port = createMockPort();
    const session = makeSession(port, "alice");
    await session.start();
    const result = await session.openChannel(channelFor("c1"));

    expect(result.role).toBe("creator");
    expect(result.epoch).toBe(0);
    expect(port.state.channels.get("c1")?.mlsGroupId).toBeTruthy();
    const commits = port.state.commits.get("c1") ?? [];
    expect(commits).toHaveLength(1);
    expect(commits[0]?.epoch).toBe(0);
  });

  it("encrypts and decrypts a round-trip on the creator device", async () => {
    const port = createMockPort();
    const session = makeSession(port, "alice");
    await session.start();
    await session.openChannel(channelFor("c1"));

    await session.sendMessage("c1", "hello world");
    const messages = [...port.state.messages.values()];
    expect(messages).toHaveLength(1);
    const stored = messages[0];
    expect(stored?.ciphertext).not.toContain("hello world");

    await session.receiveMessages(messages);
    expect(session.decryptedText(stored?.id ?? "")).toBe("hello world");
  });
});

describe("ChatSession two-device flow", () => {
  it("rejects ciphertext from a group this device is not part of", async () => {
    const port = createMockPort();
    const alice = makeSession(port, "alice");
    await alice.start();
    await alice.openChannel(channelFor("c1"));
    await alice.sendMessage("c1", "for alice only");

    const ciphertext = [...port.state.messages.values()][0]?.ciphertext ?? "";
    const outsider = createMemoryMlsEngine("mallory");
    await outsider.createGroup(
      new TextEncoder().encode("aulora:channel:c1"),
      await outsider.generateKeyPackage(),
    );
    await expect(outsider.decrypt(decodeMlsBytes(ciphertext))).rejects.toBeInstanceOf(Error);
  });

  it("auto-approves a join intent with an add commit and welcome", async () => {
    const port = createMockPort();
    const alice = makeSession(port, "alice");
    await alice.start();
    await alice.openChannel(channelFor("c1"));

    // Simulate B's KeyPackage published as a join intent for another device.
    const bobKeyPackage = await createMemoryMlsEngine("bob").generateKeyPackage();
    const intentId = await port.publishJoinIntent({
      channelId: "c1",
      deviceId: "device-2",
      keyPackage: encodeForAssert(bobKeyPackage),
    });
    expect(intentId).toBeTruthy();

    // The intents subscription fires asynchronously after the write.
    await waitFor(() =>
      (port.state.commits.get("c1") ?? []).some((commit) => commit.welcomeCiphertext !== null),
    );

    const remaining = (port.state.joinIntents.get("c1") ?? []).map((intent) => intent.deviceId);
    expect(remaining).not.toContain("device-2");
  });

  it("advances the epoch on add and reflects removes", async () => {
    const port = createMockPort();
    const alice = makeSession(port, "alice");
    await alice.start();
    await alice.openChannel(channelFor("c1"));
    expect(await alice.epoch("c1")).toBe(0);

    const bobKeyPackage = await createMemoryMlsEngine("bob").generateKeyPackage();
    await port.publishJoinIntent({
      channelId: "c1",
      deviceId: "device-2",
      keyPackage: encodeForAssert(bobKeyPackage),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await alice.epoch("c1")).toBe(1);
  });

  it("edits, deletes and reacts through the port", async () => {
    const port = createMockPort();
    const alice = makeSession(port, "alice");
    await alice.start();
    await alice.openChannel(channelFor("c1"));
    const messageId = await alice.sendMessage("c1", "first");

    await alice.editMessage("c1", messageId, "second");
    expect(port.state.messages.get(messageId)?.editedAt).not.toBeNull();
    await alice.receiveMessages([...port.state.messages.values()]);
    expect(alice.decryptedText(messageId)).toBe("second");

    await alice.toggleReaction("c1", messageId, "thumbs-up");
    const reactions: unknown[] = [];
    alice.onReactions(messageId, (value) => reactions.push(value));
    await alice.toggleReaction("c1", messageId, "thumbs-up");
    expect(reactions.length).toBeGreaterThan(0);

    await alice.deleteMessage("c1", messageId);
    expect(port.state.messages.get(messageId)?.deletedAt).not.toBeNull();
    expect(alice.decryptedText(messageId)).toBeUndefined();
  });
});

function encodeForAssert(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
