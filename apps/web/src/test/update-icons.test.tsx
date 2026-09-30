import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChannelSidebar, type ChannelSidebarProps } from "../components/chat/ChannelSidebar";

const props: ChannelSidebarProps = {
  workspaceName: "Workspace",
  workspaceIconSeed: "workspace",
  ownUserId: "me",
  ownName: "Me",
  ownStatus: "online",
  onlineCount: 1,
  channels: [],
  categories: [],
  titles: new Map(),
  presenceOf: () => "online",
  activeChannelId: undefined,
  unreadByChannel: new Map(),
  canCreateChannel: false,
  onSelect: vi.fn(),
  onCreateChannel: vi.fn(),
  onNewConversation: vi.fn(),
  onOpenSearch: vi.fn(),
  onSetStatus: vi.fn(),
  onSignOut: vi.fn(),
  onOpenUserSettings: vi.fn(),
  showAdmin: true,
  onOpenAdmin: vi.fn(),
};
describe("settings update indicators", () => {
  it("shows app updates only on user settings and workspace updates only on workspace settings", () => {
    const view = render(<ChannelSidebar {...props} appUpdateAvailable />);
    expect(
      screen.getByRole("button", { name: "User settings (update available)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace settings" })).toBeInTheDocument();
    view.rerender(<ChannelSidebar {...props} workspaceUpdateAvailable />);
    expect(
      screen.getByRole("button", { name: "Workspace settings (update available)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "User settings" })).toBeInTheDocument();
  });
});
