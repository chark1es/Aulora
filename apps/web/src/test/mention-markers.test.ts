import { messageMentionsUser } from "@aulora/core";
import { describe, expect, it, vi } from "vitest";
import { convexPort, convexSubscriptions } from "../lib/convex-chat";

describe("mention marker compatibility", () => {
  it("does not cache a failed capability query", async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue({ capabilities: { mentionMarkers: true } });
    const mutation = vi.fn().mockResolvedValue("m");
    const port = convexPort({ query, mutation } as never);
    const args = { channelId: "c", body: "@everyone", mentionEveryone: true };
    await port.sendMessage(args);
    await port.sendMessage(args);
    expect(mutation.mock.calls.at(-1)?.[1]).toMatchObject({ mentionEveryone: true });
  });
  it("waits for capability on cold start before sending", async () => {
    let resolve!: (value: unknown) => void;
    const query = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const mutation = vi.fn().mockResolvedValue("m");
    const port = convexPort({ query, mutation } as never);
    const pending = port.sendMessage({
      channelId: "c",
      body: "@everyone",
      mentionEveryone: true,
      mentionUserIds: ["explicit"],
    });
    await Promise.resolve();
    expect(mutation).not.toHaveBeenCalled();
    resolve({ capabilities: { mentionMarkers: true } });
    await pending;
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      mentionUserIds: ["explicit"],
      mentionEveryone: true,
    });
  });
  it("retries a rollback once without markers and expands the visible audience", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ capabilities: { mentionMarkers: true } })
      .mockResolvedValueOnce({ kind: "text" })
      .mockResolvedValueOnce(["visible"]);
    const mutation = vi
      .fn()
      .mockRejectedValueOnce(new Error("ArgumentValidationError: extra field `mentionEveryone`"))
      .mockResolvedValue("m");
    const port = convexPort({ query, mutation } as never);
    await port.sendMessage({
      channelId: "c",
      body: "@everyone",
      mentionEveryone: true,
      mentionUserIds: ["explicit"],
    });
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation.mock.calls[1]?.[1]).not.toHaveProperty("mentionEveryone");
    expect(mutation.mock.calls[1]?.[1].mentionUserIds).toEqual(["explicit", "visible"]);
  });
  it("does not retry a broadcast budget rejection", async () => {
    const query = vi.fn().mockResolvedValue({ capabilities: { mentionMarkers: true } });
    const mutation = vi
      .fn()
      .mockRejectedValue(new Error("You're mentioning everyone too often. Try again in a minute."));
    await expect(
      convexPort({ query, mutation } as never).sendMessage({
        channelId: "c",
        body: "@everyone",
        mentionEveryone: true,
      }),
    ).rejects.toThrow("too often");
    expect(mutation).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])(
    "normalizes messages for highlights and notification gating (marker %s)",
    (marker) => {
      const row = {
        id: "m",
        authorId: "author",
        mentionUserIds: [],
        ...(marker ? { mentionEveryone: true, mentionHere: true } : {}),
      };
      const client = {
        watchQuery: () => ({
          localQueryResult: () => ({ page: [row] }),
          onUpdate: () => () => undefined,
        }),
      };
      const receive = vi.fn();
      convexSubscriptions(client as never).watchMessages("c", receive);
      const message = receive.mock.calls[0]?.[0][0];
      expect(message.mentionEveryone).toBe(marker);
      expect(message.mentionHere).toBe(marker);
      expect(messageMentionsUser(message, "viewer")).toBe(marker);
      expect(messageMentionsUser(message, "viewer")).toBe(marker);
      expect(messageMentionsUser(message, "author")).toBe(false);
    },
  );
});

it("refreshes capability after reconnect and a new profile port", async () => {
  let connectionCount = 1;
  const query = vi.fn().mockResolvedValue({ capabilities: { mentionMarkers: true } });
  const mutation = vi.fn().mockResolvedValue("m");
  const client = { query, mutation, connectionState: () => ({ connectionCount }) };
  const port = convexPort(client as never);
  const args = { channelId: "c", body: "@everyone", mentionEveryone: true };
  await port.sendMessage(args);
  await port.sendMessage(args);
  expect(query).toHaveBeenCalledTimes(1);
  connectionCount++;
  await port.sendMessage(args);
  expect(query).toHaveBeenCalledTimes(2);
  await convexPort(client as never).sendMessage(args);
  expect(query).toHaveBeenCalledTimes(3);
});

it("degrades a timed-out cold-start probe without caching the failure", async () => {
  vi.useFakeTimers();
  try {
    const query = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ capabilities: { mentionMarkers: true } });
    const mutation = vi.fn().mockResolvedValue("m");
    const port = convexPort({ query, mutation } as never);
    const args = { channelId: "c", body: "@everyone", mentionEveryone: true };
    const send = port.sendMessage(args);
    await vi.advanceTimersByTimeAsync(2501);
    await send;
    expect(mutation.mock.calls[0]?.[1].mentionEveryone).toBe(true);
    await port.sendMessage(args);
    expect(mutation.mock.calls[1]?.[1].mentionEveryone).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it("does not expand legacy @here", async () => {
  const query = vi.fn().mockResolvedValue({ capabilities: { mentionMarkers: false } });
  const mutation = vi.fn().mockResolvedValue("m");
  await convexPort({ query, mutation } as never).sendMessage({
    channelId: "c",
    body: "@here standup",
    mentionHere: true,
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(mutation.mock.calls[0]?.[1]).not.toHaveProperty("mentionHere");
  expect(mutation.mock.calls[0]?.[1].mentionUserIds ?? []).toEqual([]);
});
it("does not retry unrelated argument validation errors", async () => {
  const query = vi.fn().mockResolvedValue({ capabilities: { mentionMarkers: true } });
  const mutation = vi.fn().mockRejectedValue(new Error("argument validation: invalid channel"));
  await expect(
    convexPort({ query, mutation } as never).sendMessage({
      channelId: "c",
      body: "@everyone",
      mentionEveryone: true,
    }),
  ).rejects.toThrow("invalid channel");
  expect(mutation).toHaveBeenCalledTimes(1);
});

it.each([true, false])("attempts @here markers after timeout (capable %s)", async (capable) => {
  vi.useFakeTimers();
  try {
    const query = vi.fn(() => new Promise(() => {}));
    const mutation = vi.fn().mockResolvedValue("m");
    if (!capable)
      mutation.mockRejectedValueOnce(
        Object.assign(new Error("old server"), { name: "ArgumentValidationError" }),
      );
    const send = convexPort({ query, mutation } as never).sendMessage({
      channelId: "c",
      body: "@here",
      mentionHere: true,
    });
    await vi.advanceTimersByTimeAsync(2501);
    await send;
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({ mentionHere: true });
    expect(mutation).toHaveBeenCalledTimes(capable ? 1 : 2);
    if (!capable) expect(mutation.mock.calls[1]?.[1]).not.toHaveProperty("mentionHere");
  } finally {
    vi.useRealTimers();
  }
});

it("strips restored broadcast markers from a thread reply without probing capabilities", async () => {
  const query = vi.fn();
  const mutation = vi.fn().mockResolvedValue("reply");
  await convexPort({ query, mutation } as never).sendMessage({
    channelId: "c",
    threadRootId: "root",
    body: "@here @everyone",
    mentionHere: true,
    mentionEveryone: true,
  });
  expect(query).not.toHaveBeenCalled();
  expect(mutation.mock.calls[0]?.[1]).not.toHaveProperty("mentionHere");
  expect(mutation.mock.calls[0]?.[1]).not.toHaveProperty("mentionEveryone");
});
