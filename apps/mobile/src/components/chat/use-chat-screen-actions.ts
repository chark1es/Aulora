import { type ChannelView, type MessagePayload, Permission } from "@aulora/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect } from "react";
import { Alert, BackHandler, Keyboard } from "react-native";
import { createCategory } from "../../lib/backend-actions";
import { selectionFeedback } from "../../lib/haptics";
import { planChannelEdit } from "../../lib/permissions";
import type { NewChannelKind } from "./CreateChannelSheet";
import { errorMessage } from "./chat-screen-types";
import type { PaneIndex } from "./SwipePanes";
import type { ThreadInboxItem } from "./ThreadsInbox";
import type { ChatScreenData } from "./use-chat-screen-data";

function useChatScreenNavigation(data: ChatScreenData) {
  const {
    runtime,
    channels,
    voice,
    pane,
    hubTab,
    threadRoot,
    setActiveChannelId,
    setPane,
    setThreadRoot,
    setQuote,
    setJumpToMessageId,
    setHubTab,
  } = data;

  const openChannel = useCallback(
    async (channelId: string) => {
      setActiveChannelId(channelId);
      setThreadRoot(null);
      setQuote(null);
      setJumpToMessageId(null);
      setPane(1);
      const summary = channels.find((entry) => entry.id === channelId);
      if (runtime !== undefined && summary !== undefined) {
        await runtime.session.openChannel(summary);
      }
    },
    [runtime, channels, setActiveChannelId, setThreadRoot, setQuote, setJumpToMessageId, setPane],
  );

  const joinVoiceChannel = useCallback(
    (channelId: string) => {
      void openChannel(channelId);
      const live = voice.activeCalls.find((entry) => entry.channelId === channelId);
      if (live !== undefined) {
        void voice.joinCall(live.id);
      } else {
        void voice.startCall(channelId, "voice");
      }
    },
    [openChannel, voice],
  );

  const openThreadFromInbox = useCallback(
    (thread: ThreadInboxItem) => {
      const root: MessagePayload = {
        id: thread.id,
        channelId: thread.channelId,
        authorId: thread.authorId,
        body: thread.body,
        threadRootId: null,
        attachmentIds: [],
        mentionUserIds: [...thread.mentionedUserIds],
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        replyCount: thread.replyCount,
        lastReplyAt: thread.lastReplyAt,
        createdAt: thread.createdAt,
      };
      setActiveChannelId(thread.channelId);
      setThreadRoot(root);
      setPane(1);
      const summary = channels.find((entry) => entry.id === thread.channelId);
      if (runtime !== undefined && summary !== undefined) {
        void runtime.session.openChannel(summary);
      }
    },
    [channels, runtime, setActiveChannelId, setThreadRoot, setPane],
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (threadRoot !== null) return false;
      if (pane === 2) {
        setPane(1);
        return true;
      }
      if (pane === 1) {
        setPane(0);
        return true;
      }
      if (hubTab !== "chats") {
        setHubTab("chats");
        return true;
      }
      return false;
    });
    return () => {
      subscription.remove();
    };
  }, [pane, hubTab, threadRoot, setPane, setHubTab]);

  const goToPane = useCallback(
    (next: PaneIndex) => {
      Keyboard.dismiss();
      selectionFeedback();
      setPane(next);
    },
    [setPane],
  );

  return { openChannel, joinVoiceChannel, openThreadFromInbox, goToPane };
}

function useChatScreenCreation(
  data: ChatScreenData,
  openChannel: (channelId: string) => Promise<void>,
) {
  const {
    runtime,
    setCreateBusy,
    setCreateError,
    setCreateOpen,
    setEditChannelBusy,
    setEditChannelError,
    setEditChannelModal,
    editChannelModal,
    ownUserId,
    titles,
  } = data;

  const create = useCallback(
    async (input: {
      readonly kind: NewChannelKind;
      readonly name: string;
      readonly topic?: string;
      readonly categoryId?: string;
      readonly private: boolean;
    }) => {
      if (runtime === undefined) {
        return;
      }
      setCreateBusy(true);
      setCreateError(null);
      try {
        const newId = await runtime.port.createChannel({
          kind: input.kind,
          name: input.name,
          ...(input.topic !== undefined ? { topic: input.topic } : {}),
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          private: input.private,
        });
        setCreateOpen(false);
        if (input.kind !== "voice") {
          await openChannel(newId);
        }
      } catch (error) {
        setCreateError(errorMessage(error));
      } finally {
        setCreateBusy(false);
      }
    },
    [runtime, openChannel, setCreateBusy, setCreateError, setCreateOpen],
  );

  const createNewCategory = useCallback(
    async (name: string) => {
      if (runtime === undefined) {
        return;
      }
      setCreateBusy(true);
      setCreateError(null);
      try {
        await createCategory(runtime.client, name);
        setCreateOpen(false);
      } catch (error) {
        setCreateError(errorMessage(error));
      } finally {
        setCreateBusy(false);
      }
    },
    [runtime, setCreateBusy, setCreateError, setCreateOpen],
  );

  const submitChannelEdit = useCallback(
    async (patch: {
      readonly name: string;
      readonly topic: string;
      readonly private: boolean;
      readonly memberIds: readonly string[];
      readonly blockedUserIds: readonly string[];
    }) => {
      const target = editChannelModal;
      if (target === null || runtime === undefined) {
        return;
      }
      const original = {
        name: titles.get(target.id) ?? target.name,
        topic: target.topic ?? "",
        private: target.isPrivate === true,
        memberIds: target.memberIds ?? [],
        blockedUserIds: (target.overrides ?? [])
          .filter((override) => override.targetType === "member")
          .filter((override) => (override.deny & Permission.ViewChannel) !== 0n)
          .map((override) => override.targetId),
      };
      const plan = planChannelEdit(original, patch, ownUserId);
      setEditChannelBusy(true);
      setEditChannelError(null);
      try {
        if (plan.name !== null) {
          await runtime.session.setChannelName(target.id, plan.name);
        }
        if (plan.topic !== null) {
          await runtime.port.setChannelTopic({ channelId: target.id, topic: plan.topic });
        }
        if (plan.privacy !== null) {
          await runtime.port.setChannelPrivate({
            channelId: target.id,
            private: plan.privacy.private,
            memberIds: plan.privacy.memberIds,
          });
        }
        if (plan.blockedUserIds !== null) {
          await runtime.port.setChannelBlocked({
            channelId: target.id,
            userIds: plan.blockedUserIds,
          });
        }
        setEditChannelModal(null);
      } catch (error) {
        setEditChannelError(errorMessage(error));
      } finally {
        setEditChannelBusy(false);
      }
    },
    [
      editChannelModal,
      ownUserId,
      runtime,
      titles,
      setEditChannelBusy,
      setEditChannelError,
      setEditChannelModal,
    ],
  );

  return { create, createNewCategory, submitChannelEdit };
}

function useChatScreenChannelActions(data: ChatScreenData) {
  const { runtime, activeChannelId, sessionState, setChannelAction } = data;

  const toggleMute = useCallback(
    async (target: ChannelView) => {
      if (runtime === undefined) {
        return;
      }
      await runtime.port.setChannelMuted?.({
        channelId: target.id,
        muted: target.muted !== true,
      });
      setChannelAction(null);
    },
    [runtime, setChannelAction],
  );

  const toggleHide = useCallback(
    async (target: ChannelView) => {
      if (runtime === undefined) {
        return;
      }
      await runtime.port.setChannelHidden?.({
        channelId: target.id,
        hidden: target.hidden !== true,
      });
      setChannelAction(null);
    },
    [runtime, setChannelAction],
  );

  const markChannelRead = useCallback(async () => {
    if (runtime === undefined || activeChannelId === undefined) {
      return;
    }
    const latest = sessionState.messages[sessionState.messages.length - 1];
    if (latest !== undefined) {
      await runtime.session.markRead(activeChannelId, latest.id);
    }
    setChannelAction(null);
  }, [runtime, activeChannelId, sessionState.messages, setChannelAction]);

  return { toggleMute, toggleHide, markChannelRead };
}

function useChatScreenModeration(data: ChatScreenData) {
  const { runtime, setModerationBusy, setModerationError, setMemberActionsFor } = data;

  const runModeration = useCallback(
    async (task: (_client: NonNullable<typeof runtime>["client"]) => Promise<void>) => {
      if (runtime === undefined) {
        return;
      }
      setModerationBusy(true);
      setModerationError(null);
      try {
        await task(runtime.client);
        setMemberActionsFor(null);
      } catch (error) {
        setModerationError(errorMessage(error));
      } finally {
        setModerationBusy(false);
      }
    },
    [runtime, setModerationBusy, setModerationError, setMemberActionsFor],
  );

  return { runModeration };
}

function useChatScreenSignOut(data: ChatScreenData) {
  const { workspaceName, onSignOut, unregisterPush, recentKey } = data;
  const confirmSignOut = useCallback(() => {
    Alert.alert(`Sign out of ${workspaceName}?`, "You can sign back in at any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void unregisterPush()
            .then(() => AsyncStorage.removeItem(recentKey).catch(() => undefined))
            .then(onSignOut)
            .catch(() => {
              Alert.alert(
                "Couldn't sign out",
                "Connect to your workspace and try again so notifications can be removed from this device.",
              );
            });
        },
      },
    ]);
  }, [workspaceName, onSignOut, unregisterPush, recentKey]);
  return { confirmSignOut };
}

export function useChatScreenActions(data: ChatScreenData) {
  const navigation = useChatScreenNavigation(data);
  const creation = useChatScreenCreation(data, navigation.openChannel);
  const channels = useChatScreenChannelActions(data);
  const moderation = useChatScreenModeration(data);
  const signOut = useChatScreenSignOut(data);
  return { ...navigation, ...creation, ...channels, ...moderation, ...signOut };
}

export type ChatScreenActions = ReturnType<typeof useChatScreenActions>;
