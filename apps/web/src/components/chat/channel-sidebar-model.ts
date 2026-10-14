/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { ChannelView } from "@aulora/core";
import type { ReactNode } from "react";
import type { CategoryView } from "../../lib/workspace-admin";
import type { PresenceStatus } from "./PresenceAvatar";
import type { CategoryActions, ChannelActions } from "./sidebar-menus";

export interface ChannelUnread {
  readonly unread: boolean;
  readonly mentionCount: number;
  readonly lastActivityAt: number | null;
}

export interface ChannelSidebarProps {
  readonly workspaceName: string;
  readonly workspaceIconSeed: string;
  readonly ownUserId: string;
  readonly ownName: string;
  readonly ownStatus: PresenceStatus;
  readonly onlineCount: number;
  readonly channels: readonly ChannelView[];
  readonly categories: readonly CategoryView[];
  /** Display title per channel id (DMs are named after their members). */
  readonly titles: ReadonlyMap<string, string>;
  readonly presenceOf: (userId: string) => PresenceStatus;
  readonly activeChannelId: string | undefined;
  readonly unreadByChannel: ReadonlyMap<string, ChannelUnread>;
  readonly canCreateChannel: boolean;
  /** Which main pane is showing; drives the sidebar Threads row. */
  readonly mainView?: "chat" | "threads" | "kanban" | "notes";
  readonly onOpenKanban?: () => void;
  /** Opens the Notes addon from the sidebar row. */
  readonly onOpenNotes?: () => void;
  /** Mentions across the viewer's threads; badges the Threads row. */
  readonly threadMentionCount?: number;
  /** Opens the Threads inbox from the sidebar row. */
  readonly onOpenThreads?: () => void;
  /** Create a category from the Channels header "+" chooser. */
  readonly onCreateCategory?: () => void;
  /** Whether the viewer may manage categories (adds "New category" to the chooser). */
  readonly canManageCategories?: boolean;
  /** Open the user settings surface from the account footer. */
  readonly onOpenUserSettings?: () => void;
  readonly appUpdateAvailable?: boolean;
  readonly workspaceUpdateAvailable?: boolean;
  /** Show the workspace admin control (the viewer has at least one admin flag). */
  readonly showAdmin?: boolean;
  readonly onOpenAdmin?: () => void;
  /**
   * Workspace switcher control rendered in the header. Injected so the
   * sidebar stays testable without a {@link ProfileProvider}.
   */
  readonly workspaceMenu?: ReactNode;
  /**
   * Full workspace switcher (trigger + menu) for the header. When set, it
   * replaces the static identity block and the `workspaceMenu` control.
   */
  readonly workspaceSwitcher?: ReactNode;
  readonly onSelect: (channelId: string) => void;
  /** Opens the create dialog, optionally pre-selecting the channel kind. */
  readonly onCreateChannel: (kind?: "text" | "voice") => void;
  readonly onNewConversation: () => void;
  readonly onOpenSearch: () => void;
  readonly onSetStatus: (status: PresenceStatus) => void;
  /** The viewer's current custom status; shown in the account status menu. */
  readonly customStatus?: string;
  /** Set or clear (empty string) the viewer's custom status. */
  readonly onSetCustomStatus?: (text: string) => void;
  /** Reorder channels via drag and drop; absent disables the feature. */
  readonly onReorderChannels?: (
    _moves: readonly {
      readonly channelId: string;
      readonly categoryId: string | null;
      readonly position: number;
    }[],
  ) => void;
  /** Whether the viewer may drag channels between/within categories. */
  readonly canReorderChannels?: boolean;
  /** Reorder categories via drag and drop; absent disables the feature. */
  readonly onReorderCategories?: (
    _moves: readonly {
      readonly categoryId: string;
      readonly position: number;
    }[],
  ) => void;
  /** Whether the viewer may drag category headers. */
  readonly canReorderCategories?: boolean;
  readonly onSignOut: () => void;
  /** Channel context-menu actions; absent entries are hidden. */
  readonly channelActions?: ChannelActions;
  /** Resolves a member's display name for voice-channel participant lists. */
  readonly memberNameOf?: (userId: string) => string;
  /** Category context-menu actions; absent entries are hidden. */
  readonly categoryActions?: CategoryActions;
}

/** localStorage key holding the sidebar's collapsed-section ids. */
export const COLLAPSED_KEY = "aulora.sidebar.collapsed.v1";

interface ChannelGroup {
  readonly key: string;
  readonly name: string;
  readonly channels: readonly ChannelView[];
  readonly category?: CategoryView;
}

/**
 * Stable sort by explicit position; channels without a position keep their
 * existing (creation) order rather than being shuffled by the sort.
 */
function sortByPosition(channels: readonly ChannelView[]): ChannelView[] {
  return channels
    .map((channel, index) => ({ channel, index }))
    .sort((a, b) => (a.channel.position ?? 0) - (b.channel.position ?? 0) || a.index - b.index)
    .map((entry) => entry.channel);
}

/** Builds the sidebar's channel groups: uncategorised "Channels" then each category. */
export function buildChannelGroups(
  channels: readonly ChannelView[],
  categories: readonly CategoryView[],
): ChannelGroup[] {
  const chat = channels.filter(
    (channel) =>
      (channel.kind === "text" || channel.kind === "announcement" || channel.kind === "voice") &&
      !channel.archived &&
      channel.hidden !== true,
  );
  const known = new Set(categories.map((category) => category.id));
  const sorted = [...categories].sort((a, b) => a.position - b.position);
  const result: ChannelGroup[] = [
    {
      key: "channels",
      name: "Channels",
      channels: sortByPosition(
        chat.filter((c) => c.categoryId === null || !known.has(c.categoryId)),
      ),
    },
  ];
  for (const category of sorted) {
    result.push({
      key: category.id,
      name: category.name,
      channels: sortByPosition(chat.filter((c) => c.categoryId === category.id)),
      category,
    });
  }
  return result;
}

/** Reads the collapsed-section ids from localStorage, tolerating absence or corruption. */
export function readCollapsed(): Set<string> {
  try {
    const raw = globalThis.localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}
