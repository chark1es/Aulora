import type { MessagePayload } from "@aulora/core";
import { Permission } from "@aulora/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList, type MessageListProps } from "../components/chat/MessageList";

function props(overrides: Partial<MessageListProps> = {}): MessageListProps {
  const messages: MessagePayload[] = [
    {
      id: "m1",
      channelId: "c1",
      authorId: "me",
      body: "Latest message",
      threadRootId: null,
      attachmentIds: [],
      mentionUserIds: [],
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      createdAt: new Date(2026, 8, 25, 12).getTime(),
    },
  ];
  return {
    runtime: undefined,
    channelId: "c1",
    messages,
    decrypted: new Map(),
    attachments: new Map(),
    pendingIds: new Set(),
    permissions: Permission.SendMessages,
    ownUserId: "me",
    ownName: "Me",
    memberNames: new Map([["me", "Me"]]),
    mentionNames: [],
    firstUnreadId: "m1",
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

function loadConversation() {
  const { rerender } = render(<MessageList {...props({ messages: [], loading: true })} />);
  rerender(<MessageList {...props()} />);
  return { rerender };
}

describe("MessageList scrolling", () => {
  let height: number;
  let viewport: number;
  let unreadTop: number;
  let notifyResize: (() => void) | undefined;

  beforeEach(() => {
    height = 600;
    viewport = 600;
    unreadTop = 400;
    const positions = new WeakMap<Element, number>();
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(() => height);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(() => viewport);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(() => unreadTop);
    vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
      return Math.min(positions.get(this) ?? 0, Math.max(0, height - viewport));
    });
    vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
      this: Element,
      top,
    ) {
      positions.set(this, Math.max(0, Math.min(top, height - viewport)));
    });
    notifyResize = undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notifyResize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("hides jump to latest when unread messages fit in the viewport", () => {
    loadConversation();
    expect(screen.getByText("New messages")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jump to latest" })).not.toBeInTheDocument();
  });

  it("hides jump to latest after scrolling down to the bottom", () => {
    height = 1800;
    loadConversation();
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();

    const list = screen.getByTestId("message-list");
    list.scrollTop = height - viewport;
    fireEvent.scroll(list);

    expect(screen.queryByRole("button", { name: "Jump to latest" })).not.toBeInTheDocument();
  });

  it("keeps an overflowing conversation at the unread divider until the user scrolls", () => {
    height = 1800;
    loadConversation();
    expect(screen.getByTestId("message-list").scrollTop).toBe(200);
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();
  });

  it("preserves the unread position when messages are already available on mount", () => {
    height = 1800;
    render(<MessageList {...props()} />);
    expect(screen.getByTestId("message-list").scrollTop).toBe(200);
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();
  });

  it("hides jump to latest when the unread divider opens near the bottom", () => {
    height = 1800;
    unreadTop = 1350;
    loadConversation();
    expect(screen.queryByRole("button", { name: "Jump to latest" })).not.toBeInTheDocument();
  });

  it("resets the button when switching from history to a short conversation", () => {
    height = 1800;
    const { rerender } = loadConversation();
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();

    height = viewport;
    rerender(<MessageList {...props({ channelId: "c2" })} />);

    expect(screen.queryByRole("button", { name: "Jump to latest" })).not.toBeInTheDocument();
  });

  it("follows new messages after the user has scrolled down", () => {
    height = 1800;
    const { rerender } = loadConversation();
    const list = screen.getByTestId("message-list");
    list.scrollTop = height - viewport;
    fireEvent.scroll(list);

    const initial = props();
    const latest = initial.messages[0];
    if (latest === undefined) throw new Error("Missing message fixture");
    height += 100;
    rerender(<MessageList {...initial} messages={[latest, { ...latest, id: "m2" }]} />);

    expect(list.scrollTop).toBe(height - viewport);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).not.toBeInTheDocument();
  });

  it("preserves the reader's position when new messages arrive while reading history", () => {
    height = 1800;
    const { rerender } = loadConversation();
    const list = screen.getByTestId("message-list");
    const previousTop = list.scrollTop;
    const initial = props();
    const latest = initial.messages[0];
    if (latest === undefined) throw new Error("Missing message fixture");
    height += 100;
    rerender(<MessageList {...initial} messages={[latest, { ...latest, id: "m2" }]} />);

    expect(list.scrollTop).toBe(previousTop);
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();
  });

  it("hides jump to latest when resizing reveals the remaining messages", () => {
    height = 1000;
    loadConversation();
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();

    act(() => {
      viewport = 1000;
      notifyResize?.();
    });

    expect(screen.queryByRole("button", { name: "Jump to latest" })).not.toBeInTheDocument();
  });
});
