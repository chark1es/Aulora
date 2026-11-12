import { type ChatSession, memoryOutboxStore, Outbox } from "@aulora/core";
import { expect, it, vi } from "vitest";
import { convexPort } from "../src/lib/convex-chat";
import { sendOutboxItem } from "../src/lib/outbox-send";

it.each([true, false])(
  "flushes semantic broadcast markers using current capability %s",
  async (capable) => {
    const store = memoryOutboxStore([
      {
        id: "queued",
        channelId: "c",
        text: "@everyone",
        mentionUserIds: ["explicit"],
        mentionEveryone: true,
        createdAt: 0,
        attempts: 0,
        nextAttemptAt: 0,
        status: "pending",
      },
    ]);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ capabilities: { mentionMarkers: capable } })
      .mockResolvedValueOnce({ kind: "text" })
      .mockResolvedValueOnce(["visible"]);
    const mutation = vi.fn().mockResolvedValue("m");
    const port = convexPort({ query, mutation } as never);
    const session = {
      sendMessage: (channelId: string, body: string, options: object) =>
        port.sendMessage({ channelId, body, ...options }),
    } as ChatSession;
    const queue = new Outbox({ store });
    await queue.flush((item) => sendOutboxItem(session, item));
    const sent = mutation.mock.calls[0]?.[1];
    expect(sent.mentionUserIds).toEqual(capable ? ["explicit"] : ["explicit", "visible"]);
    if (capable) expect(sent.mentionEveryone).toBe(true);
    else expect(sent).not.toHaveProperty("mentionEveryone");
    expect(await queue.list()).toEqual([]);
  },
);
