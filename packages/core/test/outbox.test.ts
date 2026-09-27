import { describe, expect, it, vi } from "vitest";
import { isConnectivityError, Outbox } from "../src/index.js";

describe("Outbox", () => {
  it("queues items in order and reports pending count", async () => {
    const outbox = new Outbox({ createId: ids("a", "b") });
    await outbox.enqueue({ channelId: "c1", text: "first" }, 1);
    await outbox.enqueue({ channelId: "c1", text: "second" }, 2);

    const queued = await outbox.list();
    expect(queued.map((item) => item.text)).toEqual(["first", "second"]);
    expect(queued[0]?.attempts).toBe(0);
    expect(await outbox.pendingCount()).toBe(2);
  });

  it("flushes due items and deletes the ones that succeed", async () => {
    const outbox = new Outbox({ createId: ids("a") });
    await outbox.enqueue({ channelId: "c1", text: "hello" }, 1);
    const send = vi.fn(async () => {});

    const result = await outbox.flush(send, { now: () => 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.sent).toEqual(["a"]);
    expect(await outbox.list()).toHaveLength(0);
  });

  it("backs off a failure with exponential delay and retries later", async () => {
    const outbox = new Outbox({ createId: ids("a") });
    await outbox.enqueue({ channelId: "c1", text: "retry me" }, 1);
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });

    const first = await outbox.flush(failing, {
      now: () => 1_000,
      baseDelayMs: 500,
    });
    expect(first.retried).toEqual(["a"]);
    const afterFailure = (await outbox.list())[0];
    expect(afterFailure?.attempts).toBe(1);
    expect(afterFailure?.nextAttemptAt).toBe(1_500);

    // Not due yet.
    const early = await outbox.flush(failing, { now: () => 1_400 });
    expect(early.sent).toHaveLength(0);
    expect(failing).toHaveBeenCalledTimes(1);

    // Due: succeeds now.
    const send = vi.fn(async () => {});
    const second = await outbox.flush(send, { now: () => 1_600 });
    expect(second.sent).toEqual(["a"]);
    expect(await outbox.list()).toHaveLength(0);
  });

  it("marks an item failed after maxAttempts", async () => {
    const outbox = new Outbox({ createId: ids("a") });
    await outbox.enqueue({ channelId: "c1", text: "doomed" }, 0);
    const send = async () => {
      throw new Error("nope");
    };

    let now = 0;
    let result = await outbox.flush(send, { now: () => now, maxAttempts: 2, baseDelayMs: 1 });
    expect(result.retried).toEqual(["a"]);
    now = 10_000;
    result = await outbox.flush(send, { now: () => now, maxAttempts: 2, baseDelayMs: 1 });
    expect(result.failed).toEqual(["a"]);
    expect((await outbox.list())[0]?.status).toBe("failed");

    // Failed items are not retried and do not count as pending.
    result = await outbox.flush(send, { now: () => now + 10_000 });
    expect(result.sent).toHaveLength(0);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it("preserves attachment descriptors on the queued item", async () => {
    const outbox = new Outbox({ createId: ids("a") });
    const attachment = {
      fileId: "file-1",
      key: "a2V5",
      iv: "aXY=",
      mime: "image/png",
      name: "x.png",
      size: 10,
    };
    await outbox.enqueue(
      { channelId: "c1", text: "", attachments: [attachment], mentionUserIds: ["u2"] },
      1,
    );
    const item = (await outbox.list())[0];
    expect(item?.attachments).toEqual([attachment]);
    expect(item?.mentionUserIds).toEqual(["u2"]);
  });

  it("preserves replyToId on the queued item", async () => {
    const outbox = new Outbox({ createId: ids("a") });
    await outbox.enqueue({ channelId: "c1", text: "reply", replyToId: "message-1" }, 1);
    const item = (await outbox.list())[0];
    expect(item?.replyToId).toBe("message-1");
  });

  it("does not run two flushes concurrently", async () => {
    const outbox = new Outbox({ createId: ids("a") });
    await outbox.enqueue({ channelId: "c1", text: "once" }, 1);
    let release: () => void = () => {};
    let started: () => void = () => {};
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const send = vi.fn(() => {
      started();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    const active = outbox.flush(send, { now: () => 1 });
    await startedPromise;
    const concurrent = await outbox.flush(send, { now: () => 1 });
    expect(concurrent.sent).toHaveLength(0);
    release();
    await active;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries a failed item back to pending, then sends it", async () => {
    const outbox = new Outbox({ createId: ids("a") });
    await outbox.enqueue({ channelId: "c1", text: "recoverable" }, 0);
    const failing = async () => {
      throw new Error("network error");
    };

    // Exhaust the attempts so the item is parked as failed.
    let now = 0;
    await outbox.flush(failing, { now: () => now, maxAttempts: 1 });
    const failedItem = (await outbox.list())[0];
    expect(failedItem?.status).toBe("failed");
    expect(await outbox.pendingCount()).toBe(0);

    // `retry` clears the attempt budget and makes it due again.
    const retried = await outbox.retry("a", 500);
    expect(retried?.status).toBe("pending");
    expect(retried?.attempts).toBe(0);
    expect(retried?.nextAttemptAt).toBe(500);

    // Failed items are not auto-flushed; after an explicit retry they are.
    now = 500;
    const send = vi.fn(async () => {});
    const result = await outbox.flush(send, { now: () => now });
    expect(result.sent).toEqual(["a"]);
    expect(await outbox.list()).toHaveLength(0);
  });

  it("retry returns undefined for an unknown id", async () => {
    const outbox = new Outbox({ createId: ids("a") });
    expect(await outbox.retry("missing")).toBeUndefined();
  });

  it("classifies connectivity failures, not server rejections", () => {
    expect(isConnectivityError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isConnectivityError(new Error("NetworkError when attempting to fetch resource"))).toBe(
      true,
    );
    expect(isConnectivityError(new Error("WebSocket closed"))).toBe(true);
    expect(isConnectivityError(new Error("Chat is not ready"))).toBe(true);
    expect(isConnectivityError(new Error("offline"))).toBe(true);

    expect(isConnectivityError(new Error("You do not have permission to post here"))).toBe(false);
    expect(isConnectivityError(new Error("Message is too long"))).toBe(false);
    expect(isConnectivityError(new Error("Rate limit exceeded"))).toBe(false);
    expect(isConnectivityError(undefined)).toBe(false);
  });
});

function ids(...values: string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index] ?? `id-${index}`;
    index += 1;
    return value;
  };
}
