import type { ChannelView, MessagePayload } from "@aulora/core";
import { useState } from "react";
import type { Nullable } from "./chat-screen-types";
import type { HubTab } from "./HubPane";
import type { PaneIndex } from "./SwipePanes";

function useChatScreenViewState() {
  const [activeChannelId, setActiveChannelId] = useState<string | undefined>(undefined);
  const [pane, setPane] = useState<PaneIndex>(1);
  const [hubTab, setHubTab] = useState<HubTab>("chats");
  const [kanbanBoardId, setKanbanBoardId] = useState<string | null>(null);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [quote, setQuote] = useState<Nullable<MessagePayload>>(null);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [bansOpen, setBansOpen] = useState(false);
  return {
    activeChannelId,
    setActiveChannelId,
    pane,
    setPane,
    hubTab,
    setHubTab,
    kanbanBoardId,
    setKanbanBoardId,
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
    showHidden,
    setShowHidden,
    workspaceSwitcherOpen,
    setWorkspaceSwitcherOpen,
    bansOpen,
    setBansOpen,
  };
}

function useChatScreenOverlayState() {
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [threadRoot, setThreadRoot] = useState<Nullable<MessagePayload>>(null);
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
    threadRoot,
    setThreadRoot,
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
