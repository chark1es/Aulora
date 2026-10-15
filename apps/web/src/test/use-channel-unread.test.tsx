import type { ChatSubscriptions, ReadStateRow } from "@aulora/core";
import { ChatSession } from "@aulora/core";
import { act, render } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { describe, expect, it } from "vitest";
import { createMockPort } from "../../../../packages/core/src/chat/testing";
import type { ChatRuntime } from "../lib/chat-runtime";
import { type ChannelSessionState, useChannelSession } from "../lib/use-channel";

/**
 * A runtime whose `watchReadState` never delivers on its own. The real read
 * cursor arrives asynchronously, and the bug was that messages landing first
 * made every message look unread. Tests drive the cursor explicitly.
 */
function deferredReadStateRuntime(): {
  readonly runtime: ChatRuntime;
  readonly deliverReadState: (state: ReadStateRow | null) => void;
} {
  const port = createMockPort();
  const session = ChatSession.create({ port, subscriptions: port });
  let listener: ((state: ReadStateRow | null) => void) | undefined;
  const subscriptions: ChatSubscriptions = {
    ...port,
    watchReadState(_channelId, onChange) {
      listener = onChange;
      return () => {
        listener = undefined;
      };
    },
  };
  const runtime: ChatRuntime = {
    port,
    subscriptions,
    session,
    client: new ConvexReactClient("https://example.convex.cloud"),
    watchThread: () => () => {},
    watchChannelMessages: (channelId, onChange) =>
      port.watchMessages(channelId, (messages) =>
        onChange({ page: messages, isDone: true, continueCursor: "" }),
      ),
  };
  return {
    runtime,
    deliverReadState: (state) => {
      act(() => {
        listener?.(state);
      });
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

describe("useChannelSession unread", () => {
  it("does not flash unread before the read cursor arrives", async () => {
    const { runtime, deliverReadState } = deferredReadStateRuntime();
    const firstId = await runtime.port.sendMessage({ channelId: "c1", body: "first" });
    const latestId = await runtime.port.sendMessage({ channelId: "c1", body: "latest" });

    const state = renderSession(runtime);

    // Messages have loaded while the read cursor has not.
    expect(state().messages.map((message) => message.id)).toEqual([firstId, latestId]);
    expect(state().readStateLoaded).toBe(false);
    expect(state().unread.firstUnreadId).toBeNull();
    expect(state().unread.unreadCount).toBe(0);
    expect(state().unread.unread).toBe(false);

    // Once the cursor lands, the divider resolves to the first unread message.
    deliverReadState({ channelId: "c1", lastReadMessageId: firstId, mentionCount: 0 });
    expect(state().readStateLoaded).toBe(true);
    expect(state().unread.firstUnreadId).toBe(latestId);
    expect(state().unread.unreadCount).toBe(1);
    expect(state().unread.unread).toBe(true);
  });

  it("shows every message unread for a brand-new channel once the null cursor loads", async () => {
    const { runtime, deliverReadState } = deferredReadStateRuntime();
    const firstId = await runtime.port.sendMessage({ channelId: "c1", body: "first" });
    await runtime.port.sendMessage({ channelId: "c1", body: "latest" });

    const state = renderSession(runtime);

    // A null cursor only counts as loaded once the subscription has fired.
    expect(state().unread.firstUnreadId).toBeNull();

    deliverReadState(null);
    expect(state().readStateLoaded).toBe(true);
    expect(state().readState).toBeNull();
    expect(state().unread.firstUnreadId).toBe(firstId);
    expect(state().unread.unreadCount).toBe(2);
    expect(state().unread.unread).toBe(true);
  });
});
