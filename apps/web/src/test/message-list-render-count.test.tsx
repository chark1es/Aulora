import type { MessagePayload } from "@aulora/core";
import { Permission } from "@aulora/core";
import type * as UiWebModule from "@aulora/ui-web";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageList, type MessageListProps } from "../components/chat/MessageList";
import type { ChatRuntime } from "../lib/chat-runtime";

/**
 * Every row called `useContextMenu` once per render, so a mocked hook counts
 * row renders without reaching into the component's internals or snapshotting
 * markup.
 */
const counts = vi.hoisted(() => ({ rows: 0 }));

vi.mock("@aulora/ui-web", async (importOriginal) => {
  const actual = await importOriginal<typeof UiWebModule>();
  return {
    ...actual,
    useContextMenu: () => {
      counts.rows += 1;
      return () => undefined;
    },
  };
});

const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();
const ROWS = 500;

function message(index: number): MessagePayload {
  return {
    id: `m${index}`,
    channelId: "c1",
    // One author, one minute apart: consecutive rows group together, so an
    // append can at most flip the previous row's trailing flag.
    authorId: "ada",
    body: `message ${index}`,
    threadRootId: null,
    attachmentIds: [],
    mentionUserIds: [],
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: NOW + index * 60_000,
  };
}

const MESSAGES: readonly MessagePayload[] = Array.from({ length: ROWS }, (_, index) =>
  message(index),
);

function props(
  overrides: Partial<MessageListProps> = {},
  runtime: ChatRuntime | undefined = undefined,
): MessageListProps {
  return {
    runtime,
    channelId: "c1",
    messages: MESSAGES,
    decrypted: new Map(),
    attachments: new Map(),
    pendingIds: new Set(),
    permissions: Permission.SendMessages,
    ownUserId: "ada",
    ownName: "Ada",
    memberNames: new Map([["ada", "Ada"]]),
    mentionNames: [],
    firstUnreadId: null,
    typers: [],
    hasOlder: false,
    loading: false,
    onLoadOlder: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onPinToggle: vi.fn(),
    onReact: vi.fn(),
    ...overrides,
  };
}

describe("MessageList render amplification", () => {
  it("re-renders at most two rows when one message is appended", { timeout: 30_000 }, () => {
    // One props object for both renders: a fresh Map/Set per render would
    // change the rows' shared `list` prop and re-render every row regardless.
    const base = props();
    const { rerender } = render(<MessageList {...base} />);
    expect(screen.getByTestId(`message-${MESSAGES[0]?.id ?? ""}`)).toBeInTheDocument();
    counts.rows = 0;

    rerender(<MessageList {...base} messages={[...MESSAGES, message(ROWS)]} />);

    // The appended row plus, at most, the previous row whose run ends.
    expect(counts.rows).toBeLessThanOrEqual(2);
    expect(counts.rows).toBeGreaterThan(0);
  });

  it("re-renders only the row whose reactions changed", { timeout: 30_000 }, () => {
    let emitReactions: ((rows: readonly unknown[]) => void) | undefined;
    const runtime = {
      subscriptions: {
        watchReactionsBatch: (
          _messageIds: readonly string[],
          onChange: (rows: readonly unknown[]) => void,
        ) => {
          emitReactions = onChange;
          return () => undefined;
        },
      },
    } as unknown as ChatRuntime;

    render(<MessageList {...props({}, runtime)} />);
    counts.rows = 0;

    act(() => {
      emitReactions?.([{ messageId: "m250", userId: "ada", emoji: "👍" }]);
    });

    expect(counts.rows).toBe(1);
    expect(screen.getByTestId("message-m250")).toHaveTextContent("👍");
  });

  it("keeps row identity when an unrelated reaction delta arrives", { timeout: 30_000 }, () => {
    let emitReactions: ((rows: readonly unknown[]) => void) | undefined;
    const runtime = {
      subscriptions: {
        watchReactionsBatch: (
          _messageIds: readonly string[],
          onChange: (rows: readonly unknown[]) => void,
        ) => {
          emitReactions = onChange;
          return () => undefined;
        },
      },
    } as unknown as ChatRuntime;

    render(<MessageList {...props({}, runtime)} />);
    act(() => {
      emitReactions?.([{ messageId: "m10", userId: "ada", emoji: "👍" }]);
    });
    counts.rows = 0;

    act(() => {
      emitReactions?.([{ messageId: "m10", userId: "ada", emoji: "👍" }]);
    });

    // Identical rows rebuild the same group arrays, so nothing re-renders.
    expect(counts.rows).toBe(0);
  });
});
