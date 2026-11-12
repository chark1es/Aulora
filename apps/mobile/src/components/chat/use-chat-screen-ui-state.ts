import type { ChannelView, MessagePayload } from "@aulora/core";
import { useCallback, useRef, useState } from "react";
import { type ChatLocation, popChatLocation, pushChatLocation } from "../../lib/back-navigation";
import type { Nullable } from "./chat-screen-types";
import type { HubTab } from "./HubPane";
import type { PaneIndex } from "./SwipePanes";

function useChatScreenViewState() {
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(undefined);
  const [pane, setPaneState] = useState<PaneIndex>(1);
  const [hubTab, setHubTabState] = useState<HubTab>("chats");
  const [kanbanBoardId, setKanbanBoardId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  // The conversation's nested selections live here rather than in the overlay
  // hook so a history entry can capture them with the pane and channel.
  const [threadRoot, setThreadRoot] = useState<Nullable<MessagePayload>>(null);
  const [quote, setQuote] = useState<Nullable<MessagePayload>>(null);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [bansOpen, setBansOpen] = useState(false);
  const [roleColorsOpen, setRoleColorsOpen] = useState(false);

  // Remember the pane/tab somebody actually left. The refs keep the setters
  // stable and let Back restore both values in one render without pushing the
  // restored state back onto the stack.
  const location = useRef<ChatLocation>({
    pane: 1,
    hubTab: "chats",
    channelId: undefined,
    threadRoot: null,
    quote: null,
    jumpToMessageId: null,
  });
  location.current = {
    pane,
    hubTab,
    channelId: activeChannelId,
    threadRoot,
    quote,
    jumpToMessageId,
  };
  const history = useRef<ChatLocation[]>([]);

  const setPane = useCallback((next: PaneIndex) => {
    if (next === location.current.pane) return;
    history.current = pushChatLocation(history.current, location.current);
    setPaneState(next);
  }, []);

  const setHubTab = useCallback((next: HubTab) => {
    if (next === location.current.hubTab) return;
    history.current = pushChatLocation(history.current, location.current);
    setHubTabState(next);
  }, []);

  /**
   * Restores the whole place somebody left; `null` at the chat's own root.
   * The returned location lets the caller reopen that conversation's session.
   * Setters are the raw state setters so a restore never pushes a new entry.
   */
  const restorePreviousLocation = useCallback((): ChatLocation | null => {
    const previous = popChatLocation(history.current);
    if (previous === null) return null;
    history.current = previous.history;
    location.current = previous.location;
    setPaneState(previous.location.pane);
    setHubTabState(previous.location.hubTab);
    setActiveChannelId(previous.location.channelId);
    setThreadRoot(previous.location.threadRoot ?? null);
    setQuote(previous.location.quote ?? null);
    setJumpToMessageId(previous.location.jumpToMessageId ?? null);
    return previous.location;
  }, []);

  return {
    activeChannelId,
    setActiveChannelId,
    pane,
    setPane,
    hubTab,
    setHubTab,
    restorePreviousLocation,
    kanbanBoardId,
    setKanbanBoardId,
    noteId,
    setNoteId,
    newMessageOpen,
    setNewMessageOpen,
    pinsOpen,
    setPinsOpen,
    profileFor,
    setProfileFor,
    quote,
    setQuote,
    jumpToMessageId,
    setJumpToMessageId,
    threadRoot,
    setThreadRoot,
    showHidden,
    setShowHidden,
    workspaceSwitcherOpen,
    setWorkspaceSwitcherOpen,
    bansOpen,
    setBansOpen,
    roleColorsOpen,
    setRoleColorsOpen,
  };
}

function useChatScreenOverlayState() {
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [channelAction, setChannelAction] = useState<Nullable<ChannelView>>(null);
  const [editChannelModal, setEditChannelModal] = useState<Nullable<ChannelView>>(null);
  const [editChannelBusy, setEditChannelBusy] = useState(false);
  const [editChannelError, setEditChannelError] = useState<string | null>(null);
  const [memberActionsFor, setMemberActionsFor] = useState<string | null>(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  return {
    createOpen,
    setCreateOpen,
    createBusy,
    setCreateBusy,
    createError,
    setCreateError,
    channelAction,
    setChannelAction,
    editChannelModal,
    setEditChannelModal,
    editChannelBusy,
    setEditChannelBusy,
    editChannelError,
    setEditChannelError,
    memberActionsFor,
    setMemberActionsFor,
    moderationBusy,
    setModerationBusy,
    moderationError,
    setModerationError,
    noteFor,
    setNoteFor,
  };
}

export function useChatScreenUiState() {
  const view = useChatScreenViewState();
  const overlays = useChatScreenOverlayState();
  return { ...view, ...overlays };
}

export type ChatScreenUiState = ReturnType<typeof useChatScreenUiState>;
