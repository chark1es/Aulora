import { ChatSession, isConnectivityError, Outbox } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { createMockPort } from "../../../packages/core/src/chat/testing";
import { sendOutboxItem } from "../src/lib/outbox-send";
import { mobileOutboxStore } from "../src/lib/outbox-store";

function storage() {
  const values = new Map<string, string>();
  return {
    async getItem(key: string) {
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("mobile outbox", () => {
  it("survives reopening and cannot mix servers or accounts", async () => {
    const disk = storage();
    const queue = new Outbox({ store: mobileOutboxStore(disk, "https://one.example", "alice") });
    const item = await queue.enqueue({ channelId: "general", text: "Keep this draft" }, 100);
    const reopened = new Outbox({ store: mobileOutboxStore(disk, "https://one.example", "alice") });
    expect(await reopened.list()).toEqual([item]);
    expect(await mobileOutboxStore(disk, "https://two.example", "alice").readAll()).toEqual([]);
    expect(await mobileOutboxStore(disk, "https://one.example", "bob").readAll()).toEqual([]);
  });

  it("keeps concurrent queued sends and retries the original reply and mentions", async () => {
    const queue = new Outbox({
      store: mobileOutboxStore(storage(), "https://one.example", "alice"),
    });
    const [reply] = await Promise.all([
      queue.enqueue(
        {
          channelId: "general",
          text: "Reply",
          replyToId: "original",
          threadRootId: "root",
          mentionUserIds: ["bob"],
          mentionChannelIds: ["other"],
        },
        100,
      ),
      queue.enqueue({ channelId: "general", text: "Second" }, 101),
    ]);
    expect(await queue.list()).toHaveLength(2);
    const port = createMockPort();
    const session = ChatSession.create({ port, subscriptions: port });
    await sendOutboxItem(session, reply);
    expect(port.state.calls.find((call) => call.method === "sendMessage")?.args).toMatchObject({
      body: "Reply",
      replyToId: "original",
      threadRootId: "root",
      mentionUserIds: ["bob"],
      mentionChannelIds: ["other"],
    });
    session.dispose();
  });

  it("does not turn a permission rejection into a queued send", () => {
    expect(isConnectivityError(new Error("Missing permission"))).toBe(false);
    expect(isConnectivityError(new Error("Network request failed"))).toBe(true);
  });
});
