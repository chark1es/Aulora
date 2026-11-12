import type { ChannelView, MessagePayload } from "@aulora/core";
import { activityLabel, ChatSession, Permission } from "@aulora/core";
import { ContextMenuProvider } from "@aulora/ui-web";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexReactClient } from "convex/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockPort } from "../../../../packages/core/src/chat/testing";
import { ConversationStart, type ConversationStartProps } from "../components/chat/ChannelPane";
import { ChannelSidebar, type ChannelSidebarProps } from "../components/chat/ChannelSidebar";
import { Composer } from "../components/chat/Composer";
import { CreateCategoryModal } from "../components/chat/CreateCategoryModal";
import { CreateChannelModal } from "../components/chat/CreateChannelModal";
import { MembersPanel } from "../components/chat/MembersPanel";
import { MessageList, type MessageListProps } from "../components/chat/MessageList";
import { NewConversationDialog } from "../components/chat/NewConversationDialog";
import { RichText } from "../components/chat/RichText";
import type { ChatRuntime } from "../lib/chat-runtime";
import { DraftScopeContext, readDraft, writeDraft } from "../lib/drafts";
import { shortcutLabel } from "../lib/shortcuts";
import { useChannelSession } from "../lib/use-channel";

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
  it("removes New messages after the displayed messages are marked read", async () => {
    const port = createMockPort();
    const session = ChatSession.create({ port, subscriptions: port });
    const firstId = await port.sendMessage({ channelId: "c1", body: "first" });
    const latestId = await port.sendMessage({ channelId: "c1", body: "latest" });
    const runtime: ChatRuntime = {
      port,
      subscriptions: port,
      session,
      client: new ConvexReactClient("https://example.convex.cloud"),
      watchThread: () => () => {},
      watchChannelMessages: (channelId, onChange) =>
        port.watchMessages(channelId, (messages) =>
          onChange({ page: messages, isDone: true, continueCursor: "" }),
        ),
    };
    function Conversation() {
      const state = useChannelSession(runtime, "c1", "me");
      return (
        <MessageList
          {...listProps({
            messages: state.messages,
            decrypted: state.decrypted,
            firstUnreadId: state.unread.firstUnreadId,
          })}
        />
      );
    }
    const { container } = render(<Conversation />);
    await waitFor(() => expect(screen.getByText("New messages")).toBeInTheDocument());
    expect(container.querySelector("[data-unread-divider]")?.nextElementSibling).toHaveAttribute(
      "data-testid",
      `message-${firstId}`,
    );

    await act(() => session.markRead("c1", firstId));
    expect(container.querySelector("[data-unread-divider]")?.nextElementSibling).toHaveAttribute(
      "data-testid",
      `message-${latestId}`,
    );

    await act(() => session.markRead("c1", latestId));

    expect(screen.queryByText("New messages")).not.toBeInTheDocument();

    let newId = "";
    await act(async () => {
      newId = await port.sendMessage({ channelId: "c1", body: "new arrival" });
    });
    expect(screen.getByText("New messages")).toBeInTheDocument();
    expect(container.querySelector("[data-unread-divider]")?.nextElementSibling).toHaveAttribute(
      "data-testid",
      `message-${newId}`,
    );
  });

  it("shows the author name once per run and labels the viewer as You", () => {
    render(<MessageList {...listProps()} />);
    const list = screen.getByTestId("message-list");
    expect(within(list).getAllByText("Ada Lovelace")).toHaveLength(1);
    expect(within(list).getByText("You")).toBeInTheDocument();
    expect(within(list).getByText("text of m2")).toBeInTheDocument();
  });

  it.each(["left", "right"] as const)(
    "keeps consecutive replies' avatars and names with branched previews above them on the %s",
    (ownSide) => {
      const messages = [
        message("original", "u-ada", 0),
        message("m1", "me", 1),
        message("m2", "me", 2, { replyToId: "original" }),
        message("m3", "me", 3, { replyToId: "original" }),
      ];
      render(
        <MessageList
          {...listProps({
            messages,
            ownSide,
            replyPreviews: new Map([
              [
                "original",
                { authorId: "u-ada", authorName: "Ada Lovelace", text: "Original message" },
              ],
            ]),
          })}
        />,
      );

      for (const id of ["m2", "m3"]) {
        const row = screen.getByTestId(`message-${id}`);
        const author = within(row).getByText("You");
        const preview = within(row).getByRole("button", { name: "Jump to replied message" });
        expect(
          preview.compareDocumentPosition(author) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(author.parentElement).not.toContainElement(preview);
        expect(row.querySelector(":scope > svg")).toBeInTheDocument();
        expect(within(row).getByRole("presentation")).toBeInTheDocument();
        expect(within(row).getByText(`text of ${id}`)).toBeInTheDocument();
        expect(within(preview).getByText("Ada Lovelace")).toBeInTheDocument();
        expect(within(preview).getByText("Original message")).toBeInTheDocument();
      }
    },
  );

  it("never shows raw user ids for unknown authors", () => {
    render(<MessageList {...listProps({ messages: [message("m1", "u-ghost", 0)] })} />);
    expect(screen.getByText("Unknown member")).toBeInTheDocument();
    expect(screen.queryByText("u-ghost")).not.toBeInTheDocument();
  });

  it("keeps branched reply context above the author when the original preview is unavailable", () => {
    render(
      <MessageList
        {...listProps({
          messages: [message("m1", "u-ada", 0, { replyToId: "older-message" })],
        })}
      />,
    );
    const author = screen.getByText("Ada Lovelace");
    const preview = screen.getByRole("button", { name: "Jump to replied message" });
    expect(preview.compareDocumentPosition(author) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("message-m1").querySelector(":scope > svg")).toBeInTheDocument();
    expect(preview).toHaveTextContent("Replying to a message");
  });

  it("jumps to the original message from the reply preview", async () => {
    const user = userEvent.setup();
    render(
      <MessageList
        {...listProps({
          messages: [message("m1", "u-ada", 0), message("m2", "me", 1, { replyToId: "m1" })],
        })}
      />,
    );
    const original = screen.getByTestId("message-m1");
    const scrollIntoView = vi.fn();
    original.scrollIntoView = scrollIntoView;
    await user.click(screen.getByRole("button", { name: "Jump to replied message" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
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
    expect(screen.getByRole("dialog").closest("[data-message-row]")).toBeNull();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(within(own).getByRole("button", { name: "Delete message" })).toHaveFocus();
    await user.click(within(own).getByRole("button", { name: "Delete message" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete message?" })).getByRole("button", {
        name: "Delete message",
      }),
    );
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "m3" }));
  });

  it("confirms context-menu deletion and returns focus on cancel", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <ContextMenuProvider>
        <MessageList {...listProps({ onDelete })} />
      </ContextMenuProvider>,
    );
    const row = screen.getByTestId("message-m3");
    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "Delete message" }));
    const dialog = screen.getByRole("dialog", { name: "Delete message?" });
    expect(dialog.closest("[data-message-row]")).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(row).toHaveFocus();
  });

  it("does not render deleted messages", () => {
    render(
      <MessageList
        {...listProps({ messages: [message("m1", "me", 0, { deletedAt: NOW + 1 })] })}
      />,
    );
    expect(screen.queryByText("This message was deleted.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("message-m1")).toBeNull();
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
    expect(screen.getByRole("status")).toHaveTextContent("Ada Lovelace is typing");
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
      ["design", { unread: true, unreadCount: 5, mentionCount: 3, lastActivityAt: NOW }],
      ["dm-ada", { unread: true, unreadCount: 1, mentionCount: 0, lastActivityAt: NOW }],
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
    const row = screen.getByTestId("channel-row-dm-ada");
    expect(within(row).getByText("Ada Lovelace")).toBeInTheDocument();
    const design = screen.getByTestId("channel-row-design");
    expect(within(design).getByText("3")).toBeInTheDocument();
    expect(within(design).getByRole("img", { name: "3 mentions" })).toBeInTheDocument();
    expect(screen.getByTestId("channel-row-general")).toHaveAttribute("aria-current", "page");
    expect(row).not.toHaveAttribute("aria-current");
    expect(within(row).getByText("Unread")).toBeInTheDocument();
    // DM rows keep the dot on the right, centred in a fixed trailing slot, with
    // no timestamp stacked above it.
    const dot = within(row).getByText("Unread").parentElement;
    const slot = dot?.parentElement;
    expect(slot?.parentElement).toBe(row.lastElementChild);
    expect(row.lastElementChild).toHaveClass("items-center");
    expect(row.textContent).not.toContain(activityLabel(NOW));
  });

  it("keeps muted conversations quiet but announces the state", () => {
    render(
      <ChannelSidebar
        {...sidebarProps({
          channels: [
            {
              id: "quiet",
              kind: "text",
              categoryId: null,
              name: "quiet",
              topic: null,
              archived: false,
              muted: true,
            },
          ],
          activeChannelId: undefined,
        })}
      />,
    );
    const row = screen.getByTestId("channel-row-quiet");
    expect(within(row).getByText("Muted")).toBeInTheDocument();
    expect(row).not.toHaveAttribute("aria-current");
    expect(row).toHaveClass("text-text-muted");
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

  it("groups every addon under one Addons menu in the workspace nav", async () => {
    const user = userEvent.setup();
    render(
      <ChannelSidebar
        {...sidebarProps({
          onOpenThreads: vi.fn(),
          onOpenKanban: vi.fn(),
          onOpenNotes: vi.fn(),
          mainView: "kanban",
          threadMentionCount: 12,
        })}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((row) => row.textContent),
    ).toEqual(["Threads9+", "Addons"]);
    const trigger = within(nav).getByTestId("sidebar-addons");
    expect(trigger).toHaveAttribute("aria-current", "page");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).getByTestId("sidebar-threads")).not.toHaveAttribute("aria-current");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Addons" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((row) => row.textContent),
    ).toEqual(["Kanban", "Notes"]);
    expect(within(menu).getByRole("menuitemradio", { name: "Kanban" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(menu).getByRole("menuitemradio", { name: "Notes" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("lists every enabled addon behind the shared Addons row", async () => {
    const user = userEvent.setup();
    render(
      <ChannelSidebar
        {...sidebarProps({
          onOpenKanban: vi.fn(),
          onOpenNotes: vi.fn(),
          onOpenScheduled: vi.fn(),
          onOpenTranscripts: vi.fn(),
          mainView: "transcripts",
        })}
      />,
    );
    await user.click(screen.getByTestId("sidebar-addons"));
    expect(screen.getAllByRole("menuitemradio").map((row) => row.textContent)).toEqual([
      "Kanban",
      "Notes",
      "Scheduled",
      "Transcripts",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "Transcripts" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("drives the Addons menu from the keyboard and restores focus", async () => {
    const user = userEvent.setup();
    render(<ChannelSidebar {...sidebarProps({ onOpenKanban: vi.fn(), onOpenNotes: vi.fn() })} />);
    const trigger = screen.getByTestId("sidebar-addons");
    await user.click(trigger);
    const kanban = screen.getByRole("menuitemradio", { name: "Kanban" });
    const notes = screen.getByRole("menuitemradio", { name: "Notes" });
    await waitFor(() => {
      expect(kanban).toHaveFocus();
    });
    await user.keyboard("{ArrowDown}");
    expect(notes).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(kanban).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Addons" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens the chosen addon and closes the menu", async () => {
    const user = userEvent.setup();
    const onOpenNotes = vi.fn();
    render(<ChannelSidebar {...sidebarProps({ onOpenKanban: vi.fn(), onOpenNotes })} />);
    await user.click(screen.getByTestId("sidebar-addons"));
    await user.click(screen.getByRole("menuitemradio", { name: "Notes" }));
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "Addons" })).not.toBeInTheDocument();
  });

  it("highlights only the open workspace view, not the last channel", async () => {
    const user = userEvent.setup();
    render(
      <ChannelSidebar
        {...sidebarProps({
          onOpenThreads: vi.fn(),
          onOpenNotes: vi.fn(),
          mainView: "notes",
          activeChannelId: "general",
        })}
      />,
    );
    expect(screen.getByTestId("sidebar-addons")).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByTestId("sidebar-addons"));
    expect(screen.getByRole("menuitemradio", { name: "Notes" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("channel-row-general")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("channel-row-dm-ada")).not.toHaveAttribute("aria-current");
  });

  it("shows the platform's search shortcut", () => {
    render(<ChannelSidebar {...sidebarProps()} />);
    const search = screen.getByRole("button", { name: /Jump to or search/ });
    expect(within(search).getByText(shortcutLabel(["Mod", "K"]))).toBeInTheDocument();
  });

  it("offers New channel and New category, with keyboard navigation", async () => {
    const user = userEvent.setup();
    const onCreateChannel = vi.fn();
    const onCreateCategory = vi.fn();
    render(
      <ChannelSidebar
        {...sidebarProps({ onCreateChannel, onCreateCategory, canManageCategories: true })}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Create channel or category" });
    await user.click(trigger);
    expect(screen.queryByRole("menuitem", { name: "New text channel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "New voice channel" })).not.toBeInTheDocument();
    const channelItem = screen.getByRole("menuitem", { name: "New channel" });
    const categoryItem = screen.getByRole("menuitem", { name: "New category" });
    await waitFor(() => {
      expect(channelItem).toHaveFocus();
    });
    await user.keyboard("{ArrowDown}");
    expect(categoryItem).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(channelItem).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "New channel" }));
    expect(onCreateChannel).toHaveBeenCalledWith("text");
    expect(onCreateCategory).not.toHaveBeenCalled();
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

describe("ConversationStart", () => {
  function channel(overrides: Partial<ChannelView> = {}): ChannelView {
    return {
      id: "dm-aiden",
      kind: "dm",
      categoryId: null,
      name: "Direct message",
      topic: null,
      archived: false,
      memberIds: ["me", "u-aiden"],
      ...overrides,
    };
  }

  function startProps(overrides: Partial<ConversationStartProps> = {}): ConversationStartProps {
    return {
      channel: channel(),
      title: "aiden",
      ownUserId: "me",
      memberNames: new Map([
        ["me", "Me"],
        ["u-aiden", "aiden"],
      ]),
      presenceOf: () => "online",
      canSend: true,
      canStartCall: false,
      onSayHi: vi.fn(),
      onStartCall: vi.fn(),
      ...overrides,
    };
  }

  it("opens a direct message with the person, their presence and the first action", () => {
    render(<ConversationStart {...startProps()} />);

    expect(screen.getByRole("heading", { name: "aiden" })).toBeInTheDocument();
    expect(screen.queryByText("Online · Direct message")).not.toBeInTheDocument();
    expect(screen.getByText("The first message is yours.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Online" })).toBeInTheDocument();
  });

  it("prefills a personal greeting from Say hi", async () => {
    const user = userEvent.setup();
    const onSayHi = vi.fn();
    render(<ConversationStart {...startProps({ onSayHi })} />);

    await user.click(screen.getByRole("button", { name: "Say hi" }));
    expect(onSayHi).toHaveBeenCalledWith("Hi aiden");
  });

  it("offers a call when the conversation supports one", async () => {
    const user = userEvent.setup();
    const onStartCall = vi.fn();
    render(
      <ConversationStart {...startProps({ canSend: false, canStartCall: true, onStartCall })} />,
    );

    await user.click(screen.getByRole("button", { name: "Start a call" }));
    expect(onStartCall).toHaveBeenCalledTimes(1);
  });

  it("keeps notes-to-self quiet and does not offer a greeting", () => {
    render(
      <ConversationStart
        {...startProps({
          channel: channel({ memberIds: ["me"] }),
          title: "Notes to self",
          canStartCall: true,
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Notes to self" })).toBeInTheDocument();
    expect(
      screen.getByText("A place for notes, links, and reminders to yourself."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Say hi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start a call" })).not.toBeInTheDocument();
  });

  it("names the group and its size, and greets everyone", async () => {
    const user = userEvent.setup();
    const onSayHi = vi.fn();
    render(
      <ConversationStart
        {...startProps({
          channel: channel({
            id: "group-1",
            kind: "group_dm",
            memberIds: ["me", "u-ada", "u-grace"],
          }),
          title: "Ada Lovelace, Grace Hopper",
          memberNames: new Map([
            ["me", "Me"],
            ["u-ada", "Ada Lovelace"],
            ["u-grace", "Grace Hopper"],
          ]),
          onSayHi,
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Ada Lovelace, Grace Hopper" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Everyone here will see your message.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Say hi" }));
    expect(onSayHi).toHaveBeenCalledWith("Hi everyone");
  });

  it("uses the shared channel opening", () => {
    render(
      <ConversationStart
        {...startProps({ channel: channel({ id: "general", kind: "text" }), title: "general" })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Welcome to #general" })).toBeInTheDocument();
    expect(screen.getByText("Say hello to the channel.")).toBeInTheDocument();
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
    const input = screen.getByRole("combobox", { name: "Message" });
    await user.type(input, "hi @Ada");
    await user.keyboard("{Enter}");
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith({
      text: "hi @Ada Lovelace line one\nline two",
      mentionEveryone: false,
      mentionHere: false,
      mentionUserIds: ["u-ada"],
      mentionChannelIds: [],
      mentionCategoryIds: [],
      mentionRoleIds: [],
      files: [],
    });
    expect(input).toHaveValue("");
  });

  it("disables Send until there is something to send", () => {
    render(<Composer {...base} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("offers mentions without showing a duplicate message preview below the input", async () => {
    const user = userEvent.setup();
    render(<Composer {...base} onSend={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Message" });

    await user.type(input, "@Ada");
    expect(screen.getByRole("listbox", { name: "Mention suggestions" })).toBeInTheDocument();
    expect(screen.queryByTestId("composer-preview")).not.toBeInTheDocument();

    await user.keyboard("{Tab}");
    expect(input).toHaveValue("@Ada Lovelace ");
    expect(screen.queryByRole("listbox", { name: "Mention suggestions" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("composer-preview")).not.toBeInTheDocument();
  });

  it("keeps a separate draft per conversation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<Composer {...base} draftKey="c1" onSend={vi.fn()} />, {
      wrapper: ({ children }) => (
        <DraftScopeContext.Provider value="test-server:test-user">
          {children}
        </DraftScopeContext.Provider>
      ),
    });
    await user.type(screen.getByRole("combobox", { name: "Message" }), "half-written");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    rerender(<Composer {...base} channelId="c2" draftKey="c2" onSend={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Message" })).toHaveValue("");
    rerender(<Composer {...base} draftKey="c1" onSend={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Message" })).toHaveValue("half-written");
  });

  it("prefills the input from a first-message suggestion", () => {
    render(<Composer {...base} seedText={{ token: 1, text: "Hi aiden" }} onSend={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Message" })).toHaveValue("Hi aiden");
  });

  it("never clobbers a draft that already has text", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Composer {...base} onSend={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Message" });
    await user.type(input, "my own draft");

    rerender(<Composer {...base} seedText={{ token: 1, text: "Hi aiden" }} onSend={vi.fn()} />);
    expect(input).toHaveValue("my own draft");
  });

  it("inserts a code fence from the toolbar", async () => {
    const user = userEvent.setup();
    render(<Composer {...base} onSend={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Code block" }));
    expect(screen.getByRole("combobox", { name: "Message" })).toHaveValue("```\n\n```");
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

describe("MembersPanel paging", () => {
  const members = [
    { userId: "u-ada", displayName: "Ada Lovelace" },
    { userId: "u-bob", displayName: "Bob Stone" },
  ];

  function panel(overrides: { hasMore?: boolean; onLoadMore?: () => void } = {}) {
    return (
      <MembersPanel
        members={members}
        presence={[]}
        customStatuses={new Map()}
        ownUserId="me"
        onViewProfile={vi.fn()}
        onMessage={vi.fn()}
        onClose={vi.fn()}
        {...overrides}
      />
    );
  }

  it("keeps offline labels readable while dimming only the avatar", () => {
    render(
      <MembersPanel
        members={[
          { ...members[0], userId: "u-ada", displayName: "Ada Lovelace", roleColor: "#eeeeee" },
        ]}
        presence={[]}
        customStatuses={new Map([["u-ada", "Away until Monday"]])}
        ownUserId="me"
        onViewProfile={vi.fn()}
        onMessage={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const row = screen.getByTestId("presence-row-u-ada");
    expect(row.className).not.toMatch(/opacity-/);
    const name = screen.getByText("Ada Lovelace");
    const status = screen.getByText("Away until Monday");
    expect(name).toHaveClass("text-text-muted");
    expect(name.style.color).toBe("");
    expect(status).toHaveClass("text-text-muted");
    expect(row.querySelector(".opacity-60")).not.toContainElement(name);
    expect(row.querySelector(".opacity-60")).not.toContainElement(status);
    expect(row.querySelector(".opacity-60")).toContainElement(
      screen.getByRole("img", { name: "Offline" }),
    );
  });

  it("offers the next page while the directory has more rows", async () => {
    const onLoadMore = vi.fn();
    const user = userEvent.setup();
    render(panel({ hasMore: true, onLoadMore }));
    expect(screen.getByText(/2\+ shown/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show more members" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("hides the paging control on the last page", () => {
    render(panel());
    expect(screen.queryByRole("button", { name: "Show more members" })).not.toBeInTheDocument();
    expect(screen.getByText(/2 shown/)).toBeInTheDocument();
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

async function focusChannelName() {
  await waitFor(() => {
    expect(screen.getByLabelText("Channel name")).toHaveFocus();
  });
}

describe("CreateChannelModal", () => {
  it("submits a slugged name, kind and privacy", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<CreateChannelModal open onClose={vi.fn()} onCreate={onCreate} />);
    await focusChannelName();
    await user.type(screen.getByLabelText("Channel name"), "Release Notes");
    await user.click(screen.getByRole("radio", { name: /Announcement/ }));
    await user.click(screen.getByRole("switch", { name: "Private channel" }));
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

  it("preselects the requested kind and moves it with arrow keys", async () => {
    const user = userEvent.setup();
    render(<CreateChannelModal open initialKind="voice" onClose={vi.fn()} onCreate={vi.fn()} />);
    await focusChannelName();
    const voice = screen.getByRole("radio", { name: /Voice/ });
    expect(voice).toBeChecked();
    const text = screen.getByRole("radio", { name: /^Text/ });
    await user.click(text);
    await user.keyboard("{ArrowDown}");
    expect(voice).toBeChecked();
    expect(voice).toHaveFocus();
  });

  it("hints at the slug only when it differs from the typed name", async () => {
    const user = userEvent.setup();
    render(<CreateChannelModal open onClose={vi.fn()} onCreate={vi.fn()} />);
    await focusChannelName();
    const name = screen.getByLabelText("Channel name");
    await user.type(name, "product");
    expect(screen.queryByText("Will be created as #product")).not.toBeInTheDocument();
    await user.type(name, " Launch");
    expect(screen.getByText("Will be created as #product-launch")).toBeInTheDocument();
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
    await focusChannelName();
    await user.type(screen.getByLabelText("Channel name"), "secret");
    await user.click(screen.getByRole("switch", { name: "Private channel" }));
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

describe("CreateCategoryModal", () => {
  it("submits the trimmed category name", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CreateCategoryModal open onClose={vi.fn()} onSubmit={onSubmit} />);
    await waitFor(() => {
      expect(screen.getByLabelText("Category name")).toHaveFocus();
    });
    await user.type(screen.getByLabelText("Category name"), "  Product  ");
    await user.click(screen.getByRole("button", { name: "Create category" }));
    expect(onSubmit).toHaveBeenCalledWith("Product");
  });
});

it("shows a plain-text hint when broadcasts are not permitted", async () => {
  const user = userEvent.setup();
  render(
    <Composer
      channelId="denied-hint"
      members={[]}
      roles={[]}
      memberIds={[]}
      onTyping={vi.fn()}
      onSend={vi.fn()}
    />,
  );
  await user.type(screen.getByRole("combobox", { name: "Message" }), "@everyone");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Only members with permission can notify everyone. This will send as plain text.",
  );
  expect(screen.queryByRole("option", { name: /everyone/ })).not.toBeInTheDocument();
});
it("confirms a large @everyone once at compose time", async () => {
  const user = userEvent.setup();
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(
    <Composer
      channelId="large-confirm"
      members={[]}
      roles={[]}
      memberIds={Array.from({ length: 101 }, (_, i) => `u${i}`)}
      canMentionEveryone
      onTyping={vi.fn()}
      onSend={onSend}
    />,
  );
  await user.type(screen.getByRole("combobox", { name: "Message" }), "@everyone hello");
  await user.click(screen.getByRole("button", { name: "Send" }));
  const dialog = screen.getByRole("dialog", { name: "This will notify about 101 people. Send?" });
  expect(onSend).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Send" }));
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith(
    expect.objectContaining({ mentionEveryone: true, mentionUserIds: [] }),
  );
});
