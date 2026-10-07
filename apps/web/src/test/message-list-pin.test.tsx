import type { MessagePayload } from "@aulora/core";
import { Permission } from "@aulora/core";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageList, type MessageListProps } from "../components/chat/MessageList";

const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();

function message(
  id: string,
  authorId: string,
  minutes: number,
  extra: Partial<MessagePayload> = {},
): MessagePayload {
  return {
    id,
    channelId: "c1",
    authorId,
    body: `text of ${id}`,
    threadRootId: null,
    attachmentIds: [],
    mentionUserIds: [],
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: NOW + minutes * 60_000,
    ...extra,
  };
}

function listProps(overrides: Partial<MessageListProps> = {}): MessageListProps {
  const messages = overrides.messages ?? [message("m1", "u-ada", 0)];
  return {
    runtime: undefined,
    channelId: "c1",
    messages,
    decrypted: new Map(messages.map((entry) => [entry.id, `text of ${entry.id}`])),
    attachments: new Map(),
    pendingIds: new Set(),
    permissions: Permission.SendMessages | Permission.PinMessages,
    ownUserId: "me",
    ownName: "Me",
    memberNames: new Map([
      ["u-ada", "Ada Lovelace"],
      ["me", "Me"],
    ]),
    mentionNames: ["Ada Lovelace", "Me"],
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

describe("MessageList pin indicator", () => {
  it("shows the pin inline beside the author and time, not as its own block", () => {
    // m1 and m2 share an author and fall inside the grouping window, so m2
    // does not start an author run on its own: pinning must force the header.
    const messages = [
      message("m1", "u-ada", 0),
      message("m2", "u-ada", 1, { pinnedAt: NOW + 2 * 60_000 }),
    ];
    render(<MessageList {...listProps({ messages })} />);

    const pinnedRow = screen.getByTestId("message-m2");
    const unpinnedRow = screen.getByTestId("message-m1");

    // The grouped message still gets its author header because it is pinned.
    const author = within(pinnedRow).getByText("Ada Lovelace");
    const pin = within(pinnedRow).getByLabelText("Pinned");
    expect(pin).toBeInTheDocument();

    // The pin sits after the time, which sits after the name.
    const time = within(pinnedRow).getByText(/\d{1,2}:\d{2}/);
    expect(author.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(time.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The unpinned message carries no pin.
    expect(within(unpinnedRow).queryByLabelText("Pinned")).not.toBeInTheDocument();

    // No leftover standalone "Pinned" block sits above the message body.
    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
  });

  it("keeps the pin visible for the viewer's own mirrored messages", () => {
    const messages = [message("m1", "me", 0, { pinnedAt: NOW + 60_000 }), message("m2", "me", 1)];
    render(<MessageList {...listProps({ messages, ownSide: "right" })} />);

    const row = screen.getByTestId("message-m1");
    expect(within(row).getByLabelText("Pinned")).toBeInTheDocument();
    expect(within(screen.getByTestId("message-m2")).queryByLabelText("Pinned")).toBeNull();
  });
});
