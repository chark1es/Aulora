import { hasPermission, Permission } from "@aulora/core";
import { type ReactNode, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { pickFromLibrary } from "../../lib/attachments";
import { selectionFeedback } from "../../lib/haptics";
import { dismissKeyboard } from "../../lib/keyboard";
import { visitTab } from "../../lib/visited-tabs";
import { KanbanScreen } from "../kanban/KanbanScreen";
import { useScreenInsets } from "../layout/ScreenContainer";
import { NotesScreen } from "../notes/NotesScreen";
import { ChannelList } from "./ChannelList";
import { errorMessage } from "./chat-screen-types";
import { DirectList } from "./DirectList";
import { HubDock, type HubTab, PaneHeader, RoundButton, useDockClearance } from "./HubPane";
import { SearchView } from "./SearchView";
import { SettingsView } from "./SettingsView";
import { ThreadsInbox } from "./ThreadsInbox";
import type { ChatScreenModel } from "./use-chat-screen-model";

export function ChatHubPane({ model }: { readonly model: ChatScreenModel }) {
  const insets = useScreenInsets();
  const tabs: readonly HubTab[] = [
    "chats",
    "dms",
    ...(model.showKanban ? (["boards"] as const) : []),
    ...(model.showNotes ? (["notes"] as const) : []),
    "threads",
    "search",
    "you",
  ];
  // A tab the addon no longer offers (permissions changed mid-session) falls
  // back to settings, matching the old conditional render.
  const active: HubTab = tabs.includes(model.hubTab) ? model.hubTab : "you";
  // Once a tab has been opened it stays mounted behind the dock. Its queries,
  // scroll position and open editors survive a switch, so coming back shows the
  // already-loaded screen instead of a fresh "Loading…" spinner.
  const [visited, setVisited] = useState<ReadonlySet<HubTab>>(() => new Set([active]));
  useEffect(() => {
    setVisited((current) => visitTab(current, active));
  }, [active]);
  const mounted = tabs.filter((tab) => tab === active || visited.has(tab));
  return (
    <View
      className="flex-1 bg-bg min-w-0"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}
    >
      {mounted.map((tab) => (
        <HubTabSlot key={tab} active={tab === active}>
          {renderHubTab(model, tab)}
        </HubTabSlot>
      ))}
      <HubDock
        tab={model.hubTab}
        onTab={(tab) => {
          // A hidden tab keeps its TextInput mounted now, so close the keyboard
          // explicitly instead of leaving it tied to the screen just left.
          dismissKeyboard();
          model.setHubTab(tab);
        }}
        workspaceName={model.workspaceName}
        workspaceSeed={model.activeProfile?.iconSeed ?? model.workspaceName}
        onSwitchWorkspace={() => {
          model.setWorkspaceSwitcherOpen(true);
        }}
        ownUserId={model.ownUserId}
        ownStatus={model.ownStatus}
        threadBadge={model.threadMentionCount}
        boards={model.showKanban}
        notes={model.showNotes}
      />
    </View>
  );
}

/**
 * One hub tab's frame. Inactive tabs stay mounted but hidden, which is what
 * keeps their Convex subscriptions alive across a switch.
 */
function HubTabSlot({
  active,
  children,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  return (
    <View
      style={{ flex: 1, display: active ? "flex" : "none" }}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
    >
      {children}
    </View>
  );
}

function renderHubTab(model: ChatScreenModel, tab: HubTab): ReactNode {
  switch (tab) {
    case "chats":
      return <ChatHubListTab model={model} />;
    case "dms":
      return <ChatHubDirectTab model={model} />;
    case "boards":
      return <ChatHubBoardsTab model={model} />;
    case "notes":
      return <ChatHubNotesTab model={model} />;
    case "threads":
      return <ChatHubThreadsTab model={model} />;
    case "search":
      return <ChatHubSearchTab model={model} />;
    default:
      return <ChatHubSettingsTab model={model} />;
  }
}

function ChatHubListTab({ model }: { readonly model: ChatScreenModel }) {
  return (
    <ChannelList
      workspaceName={model.workspaceName}
      channels={model.visibleChannels}
      categories={model.categories}
      titles={model.titles}
      activeChannelId={model.activeChannelId}
      unreadByChannel={model.unreadByChannel}
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
      unreadByChannel={model.unreadByChannel}
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
    <View className="flex-1 min-w-0" style={{ paddingBottom: dockClearance }}>
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

function ChatHubNotesTab({ model }: { readonly model: ChatScreenModel }) {
  const dockClearance = useDockClearance();
  return (
    <View className="flex-1 min-w-0" style={{ paddingBottom: dockClearance }}>
      <NotesScreen
        ownUserId={model.ownUserId}
        permissions={model.viewerPermissions}
        members={model.members}
        noteId={model.noteId}
        onNoteChange={model.setNoteId}
      />
    </View>
  );
}

function ChatHubThreadsTab({ model }: { readonly model: ChatScreenModel }) {
  const dockClearance = useDockClearance();
  return (
    <View className="flex-1 min-w-0" style={{ paddingBottom: dockClearance }}>
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
        {...(model.loadMoreThreads ? { onLoadMore: model.loadMoreThreads } : {})}
        channelNames={model.textChannelNames}
        memberNames={model.memberNames}
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
            Alert.alert("Couldn’t open conversation", errorMessage(cause));
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
      canManageRoles={
        model.isOwner || hasPermission(model.viewerPermissions, Permission.ManageRoles)
      }
      onOpenRoleColors={() => {
        model.setRoleColorsOpen(true);
      }}
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
      onDeleteAccount={model.confirmDeleteAccount}
      profileData={model.viewerProfile}
      onSaveProfile={model.onSaveViewerProfile}
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
        Alert.alert("Couldn’t update your profile picture.");
        return;
      }
      const body = (await uploaded.json()) as { storageId?: unknown };
      if (typeof body.storageId !== "string") {
        Alert.alert("Couldn’t update your profile picture.");
        return;
      }
      await model.setAvatar({ storageId: body.storageId as never });
    })().catch(() => {
      Alert.alert("Couldn’t update your profile picture.");
    });
  };
  const onClearAvatar = () => {
    void model.setAvatar({}).catch(() => {
      Alert.alert("Couldn’t remove your profile picture.");
    });
  };
  return { change: onChangeAvatar, clear: onClearAvatar };
}
