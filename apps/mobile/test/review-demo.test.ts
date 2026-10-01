import { downloadAttachment, uploadAttachment } from "@aulora/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReviewDemo, isReviewDemoAddress } from "../src/lib/review-demo";

afterEach(() => vi.unstubAllGlobals());

describe("offline Apple review workspace", () => {
  it("supports chat, threads, reactions, and files without a network request", async () => {
    const fetch = vi.fn(() => {
      throw new Error("The review demo must stay offline");
    });
    vi.stubGlobal("fetch", fetch);
    const demo = await createReviewDemo();
    try {
      const id = await demo.runtime.session.sendMessage(
        demo.firstChannelId,
        "Offline review message",
      );
      expect(demo.port.state.messages.get(id)?.createdAt).toBeGreaterThan(1_700_000_000_000);
      expect(demo.search("Offline review message").map((hit) => hit.messageId)).toContain(id);
      const replies: string[] = [];
      const off = demo.runtime.watchThread("explore", (messages) => {
        replies.splice(0, replies.length, ...messages.map((m) => m.id));
      });
      expect(replies).toContain("reply");
      const replyId = await demo.runtime.session.sendMessage(demo.firstChannelId, "Local reply", {
        threadRootId: "explore",
      });
      expect(replies).toContain(replyId);
      off();
      await demo.runtime.session.toggleReaction(demo.firstChannelId, id, "👍");
      expect(demo.port.state.reactions.get(id)?.some((row) => row.emoji === "👍")).toBe(true);
      const bytes = new TextEncoder().encode("Local review attachment");
      const descriptor = await uploadAttachment(demo.port, {
        bytes,
        name: "review.txt",
        mime: "text/plain",
      });
      expect(await downloadAttachment(demo.port, descriptor)).toEqual(bytes);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      demo.dispose();
    }
  });

  it("starts clean after exiting and cannot mutate another workspace", async () => {
    const first = await createReviewDemo();
    await first.runtime.session.sendMessage(first.firstChannelId, "Private demo draft");
    first.dispose();
    const second = await createReviewDemo();
    try {
      expect(second.search("Private demo draft")).toEqual([]);
    } finally {
      second.dispose();
    }
  });

  it("opens only for the reserved review address", () => {
    for (const input of [
      "demo.aulora.example",
      " Demo.Aulora.Example/ ",
      "https://demo.aulora.example",
    ]) {
      expect(isReviewDemoAddress(input)).toBe(true);
    }
    for (const input of ["", "chat.acme.com", "demo.aulora.example.com", "demo.aulora.example/x"]) {
      expect(isReviewDemoAddress(input)).toBe(false);
    }
  });
});
