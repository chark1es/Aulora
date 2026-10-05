import { hasPermission, Permission } from "@aulora/core";
import { Alert, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pickFromLibrary } from "../../lib/attachments";
import { selectionFeedback } from "../../lib/haptics";
import { KanbanScreen } from "../kanban/KanbanScreen";
import { ChannelList } from "./ChannelList";
import { errorMessage } from "./chat-screen-types";
import { DirectList } from "./DirectList";
import { HubDock, PaneHeader, RoundButton, useDockClearance } from "./HubPane";
import { SearchView } from "./SearchView";
import { SettingsView } from "./SettingsView";
import { ThreadsInbox } from "./ThreadsInbox";
import type { ChatScreenModel } from "./use-chat-screen-model";

export function ChatHubPane({ model }: { readonly model: ChatScreenModel }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {model.hubTab === "chats" ? (
        <ChatHubListTab model={model} />
      ) : model.hubTab === "dms" ? (
        <ChatHubDirectTab model={model} />
      ) : model.hubTab === "boards" && model.showKanban ? (
        <ChatHubBoardsTab model={model} />
      ) : model.hubTab === "threads" ? (
        <ChatHubThreadsTab model={model} />
      ) : model.hubTab === "search" ? (
        <ChatHubSearchTab model={model} />
      ) : (
        <ChatHubSettingsTab model={model} />
      )}
      <HubDock
        tab={model.hubTab}
        onTab={model.setHubTab}
        workspaceName={model.workspaceName}
        workspaceSeed={model.activeProfile?.iconSeed ?? model.workspaceName}
        onSwitchWorkspace={() => {
          model.setWorkspaceSwitcherOpen(true);
        }}
        ownUserId={model.ownUserId}
        ownStatus={model.ownStatus}
        threadBadge={model.threadMentionCount}
        boards={model.showKanban}
      />
    </View>
  );
}

function ChatHubListTab({ model }: { readonly model: ChatScreenModel }) {
  return (
    <ChannelList
      workspaceName={model.workspaceName}
      channels={model.visibleChannels}
      categories={model.categories}
      titles={model.titles}
      activeChannelId={model.activeChannelId}
      ownUserId={model.ownUserId}
      presence={model.presence}
      members={model.members}
      workspaceHost={model.workspaceHost}
      onMemberPress={model.setProfileFor}
      hiddenCount={model.hiddenCount}
      showHidden={model.showHidden}
      canManageChannels={model.canManageChannels}
      activeCalls={model.voice.activeCalls}
      memberNames={model.memberNames}
      clientId={model.voice.clientId}
      localCallId={model.voice.callId}
      remoteLevels={model.voice.remoteLevels}
      onOpenChannel={(channelId) => void model.openChannel(channelId)}
      onChannelActions={(target) => {
        selectionFeedback();
        model.setChannelAction(target);
      }}
      onJoinVoice={model.joinVoiceChannel}
      threads={model.threadRows}
      onOpenThread={model.openThreadFromInbox}
      onOpenThreads={() => {
        model.setHubTab("threads");
      }}
      onCreateChannel={() => {
        model.setCreateError(null);
        model.setCreateOpen(true);
      }}
      onToggleHidden={() => {
        model.setShowHidden(!model.showHidden);
      }}
    />
  );
}

function ChatHubDirectTab({ model }: { readonly model: ChatScreenModel }) {
  return (
    <DirectList
      channels={model.visibleChannels}
      titles={model.titles}
      activeChannelId={model.activeChannelId}
      ownUserId={model.ownUserId}
      presence={model.presence}
      onOpenChannel={(channelId) => void model.openChannel(channelId)}
      onChannelActions={(target) => {
        selectionFeedback();
        model.setChannelAction(target);
      }}
      onNewMessage={() => {
        model.setNewMessageOpen(true);
      }}
    />
  );
}

function ChatHubBoardsTab({ model }: { readonly model: ChatScreenModel }) {
  const dockClearance = useDockClearance();
  return (
    <View className="flex-1" style={{ paddingBottom: dockClearance }}>
      <KanbanScreen
        ownUserId={model.ownUserId}
        permissions={model.viewerPermissions}
        members={model.members}
        boardId={model.kanbanBoardId}
        onBoardChange={model.setKanbanBoardId}
      />
    </View>
  );
}

function ChatHubThreadsTab({ model }: { readonly model: ChatScreenModel }) {
  const dockClearance = useDockClearance();
  return (
    <View className="flex-1" style={{ paddingBottom: dockClearance }}>
      <PaneHeader
        title="Threads"
        subtitle="Conversations you replied to or were mentioned in"
        leading={
          <RoundButton
            icon="chevron-left"
            label="Back to channels"
            onPress={() => {
              model.setHubTab("chats");
            }}
          />
        }
      />
      <ThreadsInbox
        threads={model.threadRows ?? []}
        loading={model.threadRows === undefined}
        channelNames={model.textChannelNames}
        memberNames={model.memberNames}
        memberColors={model.memberColors}
        titles={model.titles}
        ownUserId={model.ownUserId}
        onOpen={model.openThreadFromInbox}
      />
    </View>
  );
}

function ChatHubSearchTab({ model }: { readonly model: ChatScreenModel }) {
  return (
    <SearchView
      channels={model.channels}
      titles={model.titles}
      members={model.members}
      memberNames={model.memberNames}
      presence={model.presence}
      ownUserId={model.ownUserId}
      recentKey={model.recentKey}
      search={model.search}
      loadHistory={model.loadSearchHistory}
      onOpenMember={model.setProfileFor}
      onOpen={(id, messageId) => {
        void model
          .openChannel(id)
          .then(() => {
            model.setJumpToMessageId(messageId ?? null);
          })
          .catch((cause: unknown) => {
            Alert.alert("Couldn't open conversation", errorMessage(cause));
          });
      }}
    />
  );
}

function ChatHubSettingsTab({ model }: { readonly model: ChatScreenModel }) {
  const avatar = profileAvatarActions(model);
  return (
    <SettingsView
      workspaceName={model.workspaceName}
      ownUserId={model.ownUserId}
      ownDisplayName={model.memberNames.get(model.ownUserId) ?? model.ownDisplayName}
      canChangeNickname={hasPermission(model.viewerPermissions, Permission.ChangeOwnNickname)}
      hasAvatar={model.avatarUrls.has(model.ownUserId)}
      onChangeAvatar={avatar.change}
      onClearAvatar={avatar.clear}
      ownStatus={model.ownStatus}
      ownCustomStatus={model.ownCustomStatus}
      pushState={model.pushState}
      onSetStatus={(status, customStatus) => {
        void model.runtime?.port.setStatus({
          status,
          ...(customStatus !== undefined ? { customStatus } : {}),
        });
      }}
      onSignOut={model.confirmSignOut}
    />
  );
}

function profileAvatarActions(model: ChatScreenModel) {
  const onChangeAvatar = () => {
    void (async () => {
      const file = (await pickFromLibrary()).at(0);
      if (file === undefined) {
        return;
      }
      const bytes = await fetch(file.uri).then((response) => response.blob());
      if (bytes.size > 4 * 1024 * 1024) {
        Alert.alert("Image too large", "Choose an image under 4 MB.");
        return;
      }
      const uploadUrl = await model.generateAvatarUploadUrl({});
      const uploaded = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.mime },
        body: bytes,
      });
      if (!uploaded.ok) {
        Alert.alert("Couldn't update your profile picture.");
        return;
      }
      const body = (await uploaded.json()) as { storageId?: unknown };
      if (typeof body.storageId !== "string") {
        Alert.alert("Couldn't update your profile picture.");
        return;
      }
      await model.setAvatar({ storageId: body.storageId as never });
    })().catch(() => {
      Alert.alert("Couldn't update your profile picture.");
    });
  };
  const onClearAvatar = () => {
    void model.setAvatar({}).catch(() => {
      Alert.alert("Couldn't remove your profile picture.");
    });
  };
  return { change: onChangeAvatar, clear: onClearAvatar };
}
