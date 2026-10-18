import type { MessagePayload } from "@aulora/core";
import { Permission } from "@aulora/core";
import { ContextMenuProvider } from "@aulora/ui-web";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
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

function pinIconPath(button: HTMLElement): string | null {
  return button.querySelector("path")?.getAttribute("d") ?? null;
}

/** Renders a list whose message flips pinned state through the pin action. */
function PinHarness() {
  const [messages, setMessages] = useState<MessagePayload[]>([message("m1", "u-ada", 0)]);
  return (
    <MessageList
      {...listProps({
        messages,
        onPinToggle: (target) => {
          setMessages((current) =>
            current.map((entry) => (entry.id === target.id ? { ...entry, pinnedAt: NOW } : entry)),
          );
        },
      })}
    />
  );
}

describe("MessageList pin action", () => {
  it("shows Pin message with a pin icon, then flips to Unpin message after pinning", () => {
    render(<PinHarness />);

    const pin = screen.getByRole("button", { name: "Pin message" });
    expect(pinIconPath(pin)).toMatch(/^M16 5v7/);

    fireEvent.click(pin);

    const unpin = screen.getByRole("button", { name: "Unpin message" });
    expect(unpin).toBeInTheDocument();
    expect(pinIconPath(unpin)).toMatch(/^M14 5h-4/);
    expect(screen.queryByRole("button", { name: "Pin message" })).not.toBeInTheDocument();
  });

  it("offers Unpin message in the context menu for a pinned message", () => {
    const onPinToggle = vi.fn();
    render(
      <ContextMenuProvider>
        <MessageList
          {...listProps({
            messages: [message("m1", "u-ada", 0, { pinnedAt: NOW })],
            onPinToggle,
          })}
        />
      </ContextMenuProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId("message-m1"));

    const item = screen.getByRole("menuitem", { name: "Unpin message" });
    expect(pinIconPath(item)).toMatch(/^M14 5h-4/);

    fireEvent.click(item);
    expect(onPinToggle).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("offers Pin message in the context menu for an unpinned message", () => {
    render(
      <ContextMenuProvider>
        <MessageList {...listProps({ messages: [message("m1", "u-ada", 0)] })} />
      </ContextMenuProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId("message-m1"));

    const item = screen.getByRole("menuitem", { name: "Pin message" });
    expect(pinIconPath(item)).toMatch(/^M16 5v7/);
  });
});
