import type { ChannelView, MessagePayload } from "@aulora/core";
import { Permission } from "@aulora/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelSidebar, type ChannelSidebarProps } from "../components/chat/ChannelSidebar";
import { Composer } from "../components/chat/Composer";
import { CreateChannelModal } from "../components/chat/CreateChannelModal";
import { MessageList, type MessageListProps } from "../components/chat/MessageList";
import { NewConversationDialog } from "../components/chat/NewConversationDialog";
import { RichText } from "../components/chat/RichText";
import { readDraft, writeDraft } from "../lib/drafts";

const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();

function message(
  id: string,
  authorId: string,
  minutes: number,
  extra: Partial<MessagePayload> = {},
) {
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
  } satisfies MessagePayload;
}

function listProps(overrides: Partial<MessageListProps> = {}): MessageListProps {
  const messages = overrides.messages ?? [
    message("m1", "u-ada", 0),
    message("m2", "u-ada", 1),
    message("m3", "me", 2),
  ];
  return {
    runtime: undefined,
    channelId: "c1",
    messages,
    decrypted: new Map(messages.map((entry) => [entry.id, `text of ${entry.id}`])),
    attachments: new Map(),
    pendingIds: new Set(),
    permissions: Permission.SendMessages | Permission.SendInThreads | Permission.AddReactions,
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

describe("MessageList", () => {
  it("shows the author name once per run and labels the viewer as You", () => {
    render(<MessageList {...listProps()} />);
    const list = screen.getByTestId("message-list");
    expect(within(list).getAllByText("Ada Lovelace")).toHaveLength(1);
    expect(within(list).getByText("You")).toBeInTheDocument();
    expect(within(list).getByText("text of m2")).toBeInTheDocument();
  });

  it("never shows raw user ids for unknown authors", () => {
    render(<MessageList {...listProps({ messages: [message("m1", "u-ghost", 0)] })} />);
    expect(screen.getByText("Unknown member")).toBeInTheDocument();
    expect(screen.queryByText("u-ghost")).not.toBeInTheDocument();
  });

  it("offers edit only on the viewer's own messages", () => {
    render(<MessageList {...listProps()} />);
    const own = screen.getByTestId("message-m3");
    const theirs = screen.getByTestId("message-m1");
    expect(within(own).getByRole("button", { name: "Edit message" })).toBeInTheDocument();
    expect(within(theirs).queryByRole("button", { name: "Edit message" })).not.toBeInTheDocument();
  });

  it("gates pinning on PinMessages, not on authorship", () => {
    const { rerender } = render(<MessageList {...listProps()} />);
    expect(screen.queryByRole("button", { name: "Pin message" })).not.toBeInTheDocument();
    rerender(
      <MessageList
        {...listProps({ permissions: Permission.PinMessages | Permission.SendMessages })}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Pin message" }).length).toBeGreaterThan(0);
  });

  it("asks for confirmation before deleting", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<MessageList {...listProps({ onDelete })} />);
    const own = screen.getByTestId("message-m3");
    await user.click(within(own).getByRole("button", { name: "Delete message" }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(within(own).getByRole("button", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "m3" }));
  });

  it("renders deleted messages as tombstones without actions", () => {
    render(
      <MessageList
        {...listProps({ messages: [message("m1", "me", 0, { deletedAt: NOW + 1 })] })}
      />,
    );
    expect(screen.getByText("This message was deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete message" })).not.toBeInTheDocument();
  });

  it("shows a thread summary that opens the thread", async () => {
    const onReply = vi.fn();
    const user = userEvent.setup();
    render(
      <MessageList
        {...listProps({
          onReply,
          messages: [message("m1", "u-ada", 0, { replyCount: 3, lastReplyAt: NOW })],
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /3 replies/ }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("hides thread controls inside a thread", () => {
    render(
      <MessageList
        {...listProps({ inThread: true, messages: [message("m1", "u-ada", 0, { replyCount: 2 })] })}
      />,
    );
    expect(screen.queryByRole("button", { name: /replies/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply in thread" })).not.toBeInTheDocument();
  });

  it("draws the unread divider and a typing bubble", () => {
    render(
      <MessageList
        {...listProps({
          firstUnreadId: "m2",
          typers: [{ userId: "u-ada", expiresAt: NOW + 10_000 }],
        })}
      />,
    );
    expect(screen.getByText("New messages")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Ada Lovelace is typing" })).toBeInTheDocument();
  });

  it("renders a message body when the decrypted cache has not caught up", () => {
    render(
      <MessageList
        {...listProps({ messages: [message("m1", "u-ada", 0)], decrypted: new Map() })}
      />,
    );
    expect(screen.getByText("text of m1")).toBeInTheDocument();
  });

  it("offers older history when more exists", async () => {
    const onLoadOlder = vi.fn();
    const user = userEvent.setup();
    render(<MessageList {...listProps({ hasOlder: true, onLoadOlder })} />);
    await user.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });
});

describe("RichText", () => {
  it("renders formatting as elements, never as injected HTML", () => {
    const { container } = render(
      <RichText
        text={'**bold** <img src=x onerror="alert(1)"> https://aulora.app'}
        mentionNames={[]}
        viewerName="Me"
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("img")).toBeNull();
    const link = screen.getByRole("link", { name: "https://aulora.app" });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

function sidebarProps(overrides: Partial<ChannelSidebarProps> = {}): ChannelSidebarProps {
  const channels: ChannelView[] = [
    {
      id: "general",
      kind: "text",
      categoryId: null,
      name: "general",
      topic: null,
      archived: false,
    },
    {
      id: "design",
      kind: "text",
      categoryId: "cat-product",
      name: "design",
      topic: null,
      archived: false,
    },
    {
      id: "old",
      kind: "text",
      categoryId: null,
      name: "old",
      topic: null,
      archived: true,
    },
    {
      id: "dm-ada",
      kind: "dm",
      categoryId: null,
      name: "Direct message",
      topic: null,
      archived: false,
      memberIds: ["me", "u-ada"],
    },
  ];
  return {
    workspaceName: "Acme",
    workspaceIconSeed: "aulora:server:acme",
    ownUserId: "me",
    ownName: "Me",
    ownStatus: "online",
    onlineCount: 2,
    channels,
    categories: [{ id: "cat-product", name: "Product", position: 1, overrides: [] }],
    titles: new Map([["dm-ada", "Ada Lovelace"]]),
    presenceOf: () => "online",
    activeChannelId: "general",
    unreadByChannel: new Map([
      ["design", { unread: true, mentionCount: 3, lastActivityAt: NOW }],
      ["dm-ada", { unread: true, mentionCount: 0, lastActivityAt: NOW }],
    ]),
    canCreateChannel: true,
    onSelect: vi.fn(),
    onCreateChannel: vi.fn(),
    onNewConversation: vi.fn(),
    onOpenSearch: vi.fn(),
    onSetStatus: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
}

describe("ChannelSidebar", () => {
  beforeEach(() => localStorage.clear());

  it("groups channels by category and hides archived ones", () => {
    render(<ChannelSidebar {...sidebarProps()} />);
    expect(screen.getByRole("button", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByTestId("channel-row-design")).toBeInTheDocument();
    expect(screen.queryByTestId("channel-row-old")).not.toBeInTheDocument();
  });

  it("names DMs after the other person and shows mention badges", () => {
    render(<ChannelSidebar {...sidebarProps()} />);
    expect(
      within(screen.getByTestId("channel-row-dm-ada")).getByText("Ada Lovelace"),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("channel-row-design")).getByText("3")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("channel-row-dm-ada")).getByText("Unread"),
    ).toBeInTheDocument();
  });

  it("opens the create-channel dialog without reflowing the list", async () => {
    const onCreateChannel = vi.fn();
    const user = userEvent.setup();
    render(<ChannelSidebar {...sidebarProps({ onCreateChannel })} />);
    await user.click(screen.getByRole("button", { name: "Create channel" }));
    expect(onCreateChannel).toHaveBeenCalledTimes(1);
    // The inline form is gone: the channel list is untouched while the modal is open.
    expect(screen.getByTestId("channel-row-design")).toBeInTheDocument();
    expect(screen.queryByLabelText("Channel name")).not.toBeInTheDocument();
  });

  it("hides channel creation without ManageChannels", () => {
    render(<ChannelSidebar {...sidebarProps({ canCreateChannel: false })} />);
    expect(screen.queryByRole("button", { name: "Create channel" })).not.toBeInTheDocument();
  });

  it("collapses a section and remembers it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ChannelSidebar {...sidebarProps()} />);
    await user.click(screen.getByRole("button", { name: "Product" }));
    expect(screen.queryByTestId("channel-row-design")).not.toBeInTheDocument();
    unmount();
    render(<ChannelSidebar {...sidebarProps()} />);
    expect(screen.queryByTestId("channel-row-design")).not.toBeInTheDocument();
  });

  it("sets presence from the account menu and signs out", async () => {
    const onSetStatus = vi.fn();
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(<ChannelSidebar {...sidebarProps({ onSetStatus, onSignOut })} />);
    await user.click(screen.getByRole("button", { name: "Set your status" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Do not disturb/ }));
    expect(onSetStatus).toHaveBeenCalledWith("dnd");
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = screen.getByRole("dialog", { name: /Sign out of/ });
    await user.click(within(dialog).getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("saves a custom status from the account menu", async () => {
    const onSetCustomStatus = vi.fn();
    const user = userEvent.setup();
    render(<ChannelSidebar {...sidebarProps({ onSetCustomStatus })} />);
    await user.click(screen.getByRole("button", { name: "Set your status" }));
    await user.click(screen.getByRole("menuitem", { name: /Set a custom status/ }));
    await user.type(screen.getByLabelText("Custom status"), "Shipping{Enter}");
    expect(onSetCustomStatus).toHaveBeenCalledWith("Shipping");
  });
});

describe("Composer", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  const base = {
    channelId: "c1",
    members: [{ userId: "u-ada", displayName: "Ada Lovelace" }],
    roles: [],
    memberIds: ["u-ada", "me"],
    onTyping: vi.fn(),
  };

  it("sends on Enter, keeps Shift+Enter for new lines and resolves mentions", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Composer {...base} onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "Message" });
    await user.type(input, "hi @Ada");
    await user.keyboard("{Enter}");
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith({
      text: "hi @Ada Lovelace line one\nline two",
      mentionUserIds: ["u-ada"],
      mentionChannelIds: [],
      mentionCategoryIds: [],
      files: [],
    });
    expect(input).toHaveValue("");
  });

  it("disables Send until there is something to send", () => {
    render(<Composer {...base} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("keeps a separate draft per conversation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<Composer {...base} draftKey="c1" onSend={vi.fn()} />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "half-written");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    rerender(<Composer {...base} channelId="c2" draftKey="c2" onSend={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("");
    rerender(<Composer {...base} draftKey="c1" onSend={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("half-written");
  });

  it("inserts a code fence from the toolbar", async () => {
    const user = userEvent.setup();
    render(<Composer {...base} onSend={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Code block" }));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("```\n\n```");
  });
});

describe("drafts", () => {
  beforeEach(() => localStorage.clear());

  it("stores and clears drafts per key", () => {
    writeDraft("c1", "hello");
    expect(readDraft("c1")).toBe("hello");
    expect(readDraft("c2")).toBe("");
    writeDraft("c1", "   ");
    expect(readDraft("c1")).toBe("");
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => undefined,
    };
    expect(() => writeDraft("c1", "x", broken)).not.toThrow();
    expect(readDraft("c1", broken)).toBe("");
  });
});

describe("NewConversationDialog", () => {
  const members = [
    { userId: "me", displayName: "Me" },
    { userId: "u-ada", displayName: "Ada Lovelace" },
    { userId: "u-bob", displayName: "Bob Stone" },
  ];

  it("starts a DM with one person and never lists the viewer", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <NewConversationDialog
        members={members}
        ownUserId="me"
        presenceOf={() => "online"}
        onStart={onStart}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Me/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ada Lovelace/ }));
    await user.click(screen.getByRole("button", { name: "Message Ada Lovelace" }));
    expect(onStart).toHaveBeenCalledWith(["u-ada"]);
  });

  it("starts a group with several people and filters by name", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <NewConversationDialog
        members={members}
        ownUserId="me"
        presenceOf={() => "offline"}
        onStart={onStart}
        onClose={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Find people"), "bob");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Ada Lovelace/ })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /Bob Stone/ }));
    await user.clear(screen.getByLabelText("Find people"));
    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
    await user.click(await screen.findByRole("button", { name: "Start group with 2 people" }));
    expect(onStart).toHaveBeenCalledWith(["u-bob", "u-ada"]);
  });
});

describe("CreateChannelModal", () => {
  it("submits a slugged name, kind and privacy", async () => {
    const { CreateChannelModal } = await import("../components/chat/CreateChannelModal");
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<CreateChannelModal open onClose={vi.fn()} onCreate={onCreate} />);
    await user.type(screen.getByLabelText("Channel name"), "Release Notes");
    await user.click(screen.getByRole("radio", { name: /Announcements/ }));
    await user.click(screen.getByRole("switch", { name: "Make private" }));
    await user.click(screen.getByRole("button", { name: "Create channel" }));
    expect(onCreate).toHaveBeenCalledWith({
      name: "release-notes",
      kind: "announcement",
      private: true,
    });
  });

  it("keeps the primary action disabled until a name is given", () => {
    render(<CreateChannelModal open onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create channel" })).toBeDisabled();
  });

  it("collects role and member whitelists for a private channel", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <CreateChannelModal
        open
        onClose={vi.fn()}
        onCreate={onCreate}
        members={[
          { userId: "u-ada", displayName: "Ada Lovelace" },
          { userId: "u-bob", displayName: "Bob Stone" },
        ]}
        roles={[{ id: "r-admin", name: "Admin" }]}
      />,
    );
    await user.type(screen.getByLabelText("Channel name"), "secret");
    await user.click(screen.getByRole("switch", { name: "Make private" }));
    await user.click(screen.getByRole("button", { name: /^Admin/ }));
    await user.click(screen.getByRole("button", { name: /Ada Lovelace/ }));
    await user.click(screen.getByRole("button", { name: "Create channel" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "secret",
        private: true,
        roleIds: ["r-admin"],
        memberIds: ["u-ada"],
      }),
    );
  });
});
