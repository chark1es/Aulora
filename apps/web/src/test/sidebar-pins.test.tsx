import type { ChannelView } from "@aulora/core";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelSidebar, type ChannelSidebarProps } from "../components/chat/ChannelSidebar";
import { channelMenuItems } from "../components/chat/sidebar-menus";

function channel(id: string, extra: Partial<ChannelView> = {}): ChannelView {
  return {
    id,
    kind: "dm",
    categoryId: null,
    name: "Direct message",
    topic: null,
    archived: false,
    memberIds: ["me", id],
    ...extra,
  };
}

describe("channelMenuItems pin actions", () => {
  it("offers Pin conversation for an unpinned DM", () => {
    const pin = vi.fn();
    const items = channelMenuItems(channel("dm-a"), false, { pin, unpin: vi.fn() });
    const item = items.find((entry) => entry.id === "pin");
    expect(item?.label).toBe("Pin conversation");
    item?.onSelect();
    expect(pin).toHaveBeenCalledTimes(1);
  });

  it("offers Unpin conversation for a pinned DM", () => {
    const unpin = vi.fn();
    const items = channelMenuItems(channel("dm-a", { pinned: true }), false, {
      pin: vi.fn(),
      unpin,
    });
    const item = items.find((entry) => entry.id === "unpin");
    expect(item?.label).toBe("Unpin conversation");
    item?.onSelect();
    expect(unpin).toHaveBeenCalledTimes(1);
  });

  it("never offers pinning for a text channel", () => {
    const items = channelMenuItems(channel("general", { kind: "text" }), false, {
      pin: vi.fn(),
      unpin: vi.fn(),
    });
    expect(items.some((entry) => entry.id === "pin" || entry.id === "unpin")).toBe(false);
  });
});

function sidebarProps(overrides: Partial<ChannelSidebarProps> = {}): ChannelSidebarProps {
  const channels: ChannelView[] = [
    channel("dm-pinned", { pinned: true, pinnedAt: 200 }),
    channel("dm-recent", { pinnedAt: null }),
    channel("dm-later-pin", { pinned: true, pinnedAt: 500 }),
  ];
  return {
    workspaceName: "Acme",
    workspaceIconSeed: "aulora:server:acme",
    ownUserId: "me",
    ownName: "Me",
    ownStatus: "online",
    onlineCount: 2,
    channels,
    categories: [],
    titles: new Map([
      ["dm-pinned", "Pinned pal"],
      ["dm-recent", "Recent pal"],
      ["dm-later-pin", "Later pal"],
    ]),
    presenceOf: () => "online",
    activeChannelId: "dm-recent",
    unreadByChannel: new Map(),
    canCreateChannel: false,
    onSelect: vi.fn(),
    onCreateChannel: vi.fn(),
    onNewConversation: vi.fn(),
    onOpenSearch: vi.fn(),
    onSetStatus: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
}

describe("ChannelSidebar pinned DMs", () => {
  beforeEach(() => localStorage.clear());

  it("shows pinned conversations first, oldest pin first, under a Pinned heading", () => {
    render(<ChannelSidebar {...sidebarProps()} />);

    expect(screen.getByText("Pinned")).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^channel-row-dm-/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "channel-row-dm-pinned",
      "channel-row-dm-later-pin",
      "channel-row-dm-recent",
    ]);
  });

  it("omits the Pinned heading when nothing is pinned", () => {
    render(
      <ChannelSidebar
        {...sidebarProps({
          channels: [channel("dm-recent"), channel("dm-other")],
        })}
      />,
    );

    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
  });
});
