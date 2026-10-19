import type { MessagePayload } from "@aulora/core";
import { ChatSession } from "@aulora/core";
import { act, render } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { describe, expect, it } from "vitest";
import { createMockPort } from "../../../../packages/core/src/chat/testing";
import type { ChatRuntime } from "../lib/chat-runtime";
import {
  type ChannelSessionState,
  MAX_RETAINED_PAGES,
  MESSAGE_PAGE_SIZE,
  useChannelSession,
} from "../lib/use-channel";

/** A channel long enough to walk many pages past the retained-window cap. */
const TOTAL_MESSAGES = 3_000;

function message(index: number): MessagePayload {
  return {
    id: `m${index}`,
    channelId: "c1",
    authorId: "u-ada",
    body: `text ${index}`,
    threadRootId: null,
    attachmentIds: [],
    mentionUserIds: [],
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: index * 1_000,
  };
}

const ALL_MESSAGES = Array.from({ length: TOTAL_MESSAGES }, (_, index) => message(index));

/**
 * A runtime whose `watchChannelMessages` pages a fixed, oldest-first history the
 * way Convex does: the tail is the newest page, and each `continueCursor` walks
 * one page further back. Emits synchronously so the window can be driven a page
 * at a time from the test.
 */
function pagedRuntime(): ChatRuntime {
  const port = createMockPort();
  const session = ChatSession.create({ port, subscriptions: port });
  return {
    port,
    subscriptions: port,
    session,
    client: new ConvexReactClient("https://example.convex.cloud"),
    watchThread: () => () => {},
    watchChannelMessages: (_channelId, onChange, options = {}) => {
      const end = options.cursor == null ? TOTAL_MESSAGES : Number(options.cursor);
      const start = Math.max(0, end - (options.limit ?? MESSAGE_PAGE_SIZE));
      const isDone = start === 0;
      onChange({
        page: ALL_MESSAGES.slice(start, end),
        isDone,
        continueCursor: isDone ? "" : String(start),
      });
      return () => {};
    },
  };
}

function renderSession(runtime: ChatRuntime): () => ChannelSessionState {
  let latest: ChannelSessionState | undefined;
  function Probe() {
    latest = useChannelSession(runtime, "c1", "me");
    return null;
  }
  render(<Probe />);
  return () => {
    if (latest === undefined) {
      throw new Error("useChannelSession has not rendered yet");
    }
    return latest;
  };
}

describe("useChannelSession retained window", () => {
  it("keeps the mounted window bounded while scrolling up and re-anchors to the tail", () => {
    const state = renderSession(pagedRuntime());
    const mountedCap = (MAX_RETAINED_PAGES + 1) * MESSAGE_PAGE_SIZE;

    // Tail only: the newest page is mounted and older history is available.
    expect(state().messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(state().hasOlder).toBe(true);
    expect(state().historySeamId).toBeNull();

    // Scroll all the way to the oldest message, one page at a time. The mounted
    // window must never exceed the cap, no matter how deep the reader goes.
    let pages = 0;
    while (state().hasOlder && pages < 100) {
      act(() => {
        state().loadOlder();
      });
      expect(state().messages.length).toBeLessThanOrEqual(mountedCap);
      pages += 1;
    }

    expect(state().hasOlder).toBe(false);
    expect(state().messages.length).toBeLessThanOrEqual(mountedCap);
    // The window slid with the reader all the way to the oldest message.
    expect(state().messages[0]?.id).toBe("m0");
    // Truncated, so the seam marks the oldest live-tail message.
    expect(state().historySeamId).toBe(`m${TOTAL_MESSAGES - MESSAGE_PAGE_SIZE}`);

    // Settling back at the newest message re-anchors the window to the tail.
    act(() => {
      state().resetHistoryWindow();
    });
    expect(state().messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(state().historySeamId).toBeNull();

    // The pages the cap evicted are re-fetched from the tail cursor, newest
    // older page first — not a deep one.
    act(() => {
      state().loadOlder();
    });
    expect(state().messages).toHaveLength(2 * MESSAGE_PAGE_SIZE);
    expect(state().messages[0]?.id).toBe(`m${TOTAL_MESSAGES - 2 * MESSAGE_PAGE_SIZE}`);
  });
});
