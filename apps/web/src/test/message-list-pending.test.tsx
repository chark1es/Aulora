import type { MessagePayload } from "@aulora/core";
import { Permission } from "@aulora/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageList, type MessageListProps } from "../components/chat/MessageList";

const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();

function pendingMessage(id: string): MessagePayload {
  return {
    id,
    channelId: "c1",
    authorId: "me",
    body: `text of ${id}`,
    threadRootId: null,
    attachmentIds: [],
    mentionUserIds: [],
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: NOW,
  };
}

function props(overrides: Partial<MessageListProps> = {}): MessageListProps {
  const id = overrides.messages?.[0]?.id ?? "pending:o1";
  return {
    runtime: undefined,
    channelId: "c1",
    messages: [pendingMessage(id)],
    decrypted: new Map([[id, "text of optimistic"]]),
    attachments: new Map(),
    pendingIds: new Set(),
    permissions: Permission.SendMessages,
    ownUserId: "me",
    ownName: "Me",
    memberNames: new Map([["me", "Me"]]),
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

describe("MessageList unsent states", () => {
  it("labels a queued message as Sending… with no queued items otherwise", () => {
    render(<MessageList {...props({ pendingIds: new Set(["pending:o1"]) })} />);
    expect(screen.getByTestId("pending-pending:o1")).toHaveTextContent("Sending…");
    expect(screen.queryByText("Not sent")).not.toBeInTheDocument();
  });

  it("surfaces a failed message with Retry and Discard wired to the pending id", async () => {
    const onRetrySend = vi.fn();
    const onDiscardSend = vi.fn();
    const user = userEvent.setup();
    render(
      <MessageList
        {...props({
          failedIds: new Set(["pending:o1"]),
          onRetrySend,
          onDiscardSend,
        })}
      />,
    );
    expect(screen.getByTestId("failed-pending:o1")).toHaveTextContent("Not sent");
    expect(screen.queryByTestId("pending-pending:o1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetrySend).toHaveBeenCalledWith("pending:o1");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscardSend).toHaveBeenCalledWith("pending:o1");
  });

  it("shows no sending or failed UI when there are no queued items", () => {
    render(<MessageList {...props()} />);
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
    expect(screen.queryByText("Not sent")).not.toBeInTheDocument();
  });
});
