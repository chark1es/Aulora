import type { ChannelView, MessagePayload } from "@aulora/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ChatLocation, popChatLocation, pushChatLocation } from "../../lib/back-navigation";
import type { Nullable } from "./chat-screen-types";
import type { HubTab } from "./HubPane";
import type { PaneIndex } from "./SwipePanes";

/** Which addon-backed hub tabs the dock and the rendered pane can offer. */
export interface HubTabAvailability {
  readonly boards: boolean;
  readonly notes: boolean;
}

const ALL_HUB_TABS: HubTabAvailability = { boards: true, notes: true };

function chatLocationFrom(
  pane: PaneIndex,
  hubTab: HubTab,
  activeChannelId: string | undefined,
  threadRoot: Nullable<MessagePayload>,
  quote: Nullable<MessagePayload>,
  jumpToMessageId: string | null,
): ChatLocation {
  return { pane, hubTab, channelId: activeChannelId, threadRoot, quote, jumpToMessageId };
}

/**
 * The conversation's nested selections. They live outside the navigation hook
 * so a history entry can capture them with the pane and channel.
 */
function useChatConversationSelectionState() {
  const [threadRoot, setThreadRoot] = useState<Nullable<MessagePayload>>(null);
  const [quote, setQuote] = useState<Nullable<MessagePayload>>(null);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  return { threadRoot, setThreadRoot, quote, setQuote, jumpToMessageId, setJumpToMessageId };
}

function useChatHubSelectionState() {
  const [kanbanBoardId, setKanbanBoardId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  return { kanbanBoardId, setKanbanBoardId, noteId, setNoteId };
}

function useChatPanelState() {
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [bansOpen, setBansOpen] = useState(false);
  const [roleColorsOpen, setRoleColorsOpen] = useState(false);
  return {
    newMessageOpen,
    setNewMessageOpen,
    pinsOpen,
    setPinsOpen,
    profileFor,
    setProfileFor,
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

function useChatNavigationState(
  availability: HubTabAvailability,
  selection: ReturnType<typeof useChatConversationSelectionState>,
) {
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(undefined);
  const [pane, setPaneState] = useState<PaneIndex>(1);
  const [hubTab, setHubTabState] = useState<HubTab>("chats");
  const { setThreadRoot, setQuote, setJumpToMessageId } = selection;

  // Remember the pane/tab somebody actually left. The refs keep the setters
  // stable and let Back restore both values in one render without pushing the
  // restored state back onto the stack.
  const location = useRef<ChatLocation>(chatLocationFrom(1, "chats", undefined, null, null, null));
  location.current = chatLocationFrom(
    pane,
    hubTab,
    activeChannelId,
    selection.threadRoot,
    selection.quote,
    selection.jumpToMessageId,
  );
  const history = useRef<ChatLocation[]>([]);

  // An addon can be revoked (or its permission removed) while its tab is on
  // screen or sitting in Back history. Rendering the settings fallback under a
  // stale `boards`/`notes` value looks like the addon is still current, so the
  // unavailable tab falls back to the conversations list. This uses the raw
  // setter and never pushes history: Back should keep retracing what the
  // person actually visited.
  useEffect(() => {
    if (hubTab === "boards" && !availability.boards) setHubTabState("chats");
    else if (hubTab === "notes" && !availability.notes) setHubTabState("chats");
  }, [hubTab, availability.boards, availability.notes]);

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
  }, [setThreadRoot, setQuote, setJumpToMessageId]);

  return {
    activeChannelId,
    setActiveChannelId,
    pane,
    setPane,
    hubTab,
    setHubTab,
    restorePreviousLocation,
  };
}

function useChatScreenViewState(availability: HubTabAvailability = ALL_HUB_TABS) {
  const selection = useChatConversationSelectionState();
  const navigation = useChatNavigationState(availability, selection);
  const hubSelection = useChatHubSelectionState();
  const panels = useChatPanelState();
  return { ...navigation, ...selection, ...hubSelection, ...panels };
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

export function useChatScreenUiState(availability: HubTabAvailability = ALL_HUB_TABS) {
  const view = useChatScreenViewState(availability);
  const overlays = useChatScreenOverlayState();
  return { ...view, ...overlays };
}

export type ChatScreenUiState = ReturnType<typeof useChatScreenUiState>;
