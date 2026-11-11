import type { MessagePayload } from "@aulora/core";
import { Permission } from "@aulora/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageList, type MessageListProps } from "../components/chat/MessageList";

const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();

function threadRoot(extra: Partial<MessagePayload> = {}): MessagePayload {
  return {
    id: "m1",
    channelId: "c1",
    authorId: "u-ada",
    body: "text of m1",
    threadRootId: null,
    attachmentIds: [],
    mentionUserIds: [],
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: NOW - 60_000,
    replyCount: 3,
    lastReplyAt: NOW - 5 * 60_000,
    ...extra,
  };
}

function props(overrides: Partial<MessageListProps> = {}): MessageListProps {
  const messages = overrides.messages ?? [threadRoot()];
  return {
    runtime: undefined,
    channelId: "c1",
    messages,
    decrypted: new Map(messages.map((entry) => [entry.id, entry.body])),
    attachments: new Map(),
    pendingIds: new Set(),
    permissions: Permission.SendMessages | Permission.SendInThreads,
    ownUserId: "me",
    ownName: "Me",
    memberNames: new Map([
      ["u-ada", "Ada Lovelace"],
      ["me", "Me"],
    ]),
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

describe("MessageList thread summary", () => {
  it("opens the thread from a quiet summary row with the reply count and last activity", async () => {
    const onReply = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<MessageList {...props({ onReply })} />);

    expect(screen.getByText("3 replies")).toBeInTheDocument();
    expect(screen.getByText(/last reply/)).toBeInTheDocument();
    expect(container.querySelector('[data-testid="thread-branch"]')).toBeNull();

    await user.click(screen.getByRole("button", { name: /3 replies/ }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("uses the singular label for one reply", () => {
    render(
      <MessageList
        {...props({
          messages: [threadRoot({ replyCount: 1, lastReplyAt: null })],
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /1 reply/ })).toBeInTheDocument();
    expect(screen.queryByText(/last reply/)).not.toBeInTheDocument();
  });

  it("shows up to three repliers and a plus when there are more", () => {
    const repliers = ["u-a", "u-b", "u-c", "u-d"];
    const { container, rerender } = render(
      <MessageList {...props({ messages: [threadRoot({ replyParticipantIds: repliers })] })} />,
    );
    const stack = container.querySelector('[data-testid="thread-repliers"]');
    expect(stack?.querySelectorAll("span.inline-flex")).toHaveLength(3);
    expect(stack?.querySelector("svg")).not.toBeNull();
    expect(stack?.querySelectorAll("[aria-hidden] svg, svg")).toHaveLength(1);

    rerender(
      <MessageList
        {...props({ messages: [threadRoot({ replyParticipantIds: repliers.slice(0, 2) })] })}
      />,
    );
    const fewer = container.querySelector('[data-testid="thread-repliers"]');
    expect(fewer?.querySelectorAll("span.inline-flex")).toHaveLength(2);
    expect(fewer?.querySelector("svg")).toBeNull();
  });

  it("hides the summary inside a thread", () => {
    render(<MessageList {...props({ inThread: true })} />);
    expect(screen.queryByRole("button", { name: /replies/ })).not.toBeInTheDocument();
  });

  it("keeps the summary usable when the viewer's own messages are mirrored", async () => {
    const onReply = vi.fn();
    const user = userEvent.setup();
    render(
      <MessageList
        {...props({
          ownSide: "right",
          onReply,
          messages: [threadRoot({ authorId: "me" })],
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /3 replies/ }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });
});

it("uses one row tab stop and moves it with arrow keys", () => {
  const messages = [threadRoot({ id: "m1" }), threadRoot({ id: "m2" }), threadRoot({ id: "m3" })];
  const view = render(<MessageList {...props({ messages })} />);
  const rows = messages.map((m) => screen.getByTestId(`message-${m.id}`));
  expect(rows.map((row) => row.tabIndex)).toEqual([-1, -1, 0]);
  rows[2]?.focus();
  fireEvent.keyDown(rows[2] as HTMLElement, { key: "ArrowUp" });
  expect(rows[1]).toHaveFocus();
  expect(rows.map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
  view.rerender(<MessageList {...props({ messages: [...messages, threadRoot({ id: "m4" })] })} />);
  expect(rows[1]).toHaveAttribute("tabindex", "0");
  fireEvent.keyDown(rows[1] as HTMLElement, { key: "ArrowDown" });
  expect(rows[2]).toHaveFocus();
  expect(rows[2]?.className).toContain("focus-visible:ring-2");
});
