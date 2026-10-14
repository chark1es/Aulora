import { Button, Spinner, Text } from "@aulora/ui-native";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
import { View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { selectionFeedback } from "../../lib/haptics";
import { useStuckTimeout } from "../../lib/stuck-timeout";
import { useProfiles } from "../../providers/ProfileProvider";
import { ConnectionRecoveryActions } from "../ConnectionRecoveryActions";
import { ChatConversation } from "./ChatConversation";
import { ChatHubPane } from "./ChatHubPane";
import { ChatScreenSheets } from "./ChatScreenSheets";
import { ChatScreenSessionProvider } from "./chat-screen-session";
import type { ChatScreenProps } from "./chat-screen-types";
import { MembersPane } from "./MembersPane";
import { SwipePanes } from "./SwipePanes";
import { useConvexChatScreenSession } from "./use-chat-screen-data";
import { useChatScreenModel } from "./use-chat-screen-model";
import { WorkspaceSwitcherSheet } from "./WorkspaceSwitcherSheet";

export type { ChatScreenProps } from "./chat-screen-types";

/**
 * The signed-in mobile chat surface as three full-screen panes. The conversation
 * sits in the middle; swipe right for the hub (conversations, threads, search,
 * settings) and left for the people in it.
 */
export function ChatScreen(props: ChatScreenProps) {
  const session = useConvexChatScreenSession(
    props.workspaceName,
    props.ownUserId,
    props.ownDisplayName,
  );
  return (
    <ChatScreenSessionProvider value={session}>
      <ChatScreenView {...props} />
    </ChatScreenSessionProvider>
  );
}

export interface ChatScreenViewProps extends ChatScreenProps {
  /**
   * A persistent bar above the panes, used by the offline demo to label itself.
   * When present the panes drop their own top inset so nothing is double-padded.
   */
  readonly notice?: ReactNode;
}

/**
 * The chat surface driven by whichever session sits in context. The offline
 * review demo renders this over its mock session, so every pane, sheet and
 * interaction here stays identical to the signed-in app.
 */
export function ChatScreenView({ notice, ...props }: ChatScreenViewProps) {
  const insets = useSafeAreaInsets();
  const noticeInsets = useMemo(() => ({ ...insets, top: 0 }), [insets]);
  const model = useChatScreenModel(props);
  const panes =
    !model.ready || model.startupError !== null ? (
      <ChatScreenStatus model={model} />
    ) : (
      <ChatScreenPanes model={model} />
    );
  if (notice === undefined) {
    return panes;
  }
  return (
    <View className="flex-1 bg-bg">
      <View style={{ paddingTop: insets.top }}>{notice}</View>
      <SafeAreaInsetsContext.Provider value={noticeInsets}>
        <View className="flex-1">{panes}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

function ChatScreenStatus({ model }: { readonly model: ReturnType<typeof useChatScreenModel> }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center gap-4 bg-bg px-8"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {!model.ready ? (
        <>
          <Spinner size={28} label="Opening workspace" />
          <Text size="sm" tone="muted">
            Opening {model.workspaceName}…
          </Text>
          <ChatStartupRecovery model={model} />
        </>
      ) : (
        <>
          <Text tone="danger" accessibilityRole="alert" className="text-center">
            {model.startupError}
          </Text>
          <Button onPress={model.retryStartup}>Try again</Button>
          <Button
            variant="ghost"
            onPress={() => {
              model.setWorkspaceSwitcherOpen(true);
            }}
          >
            Switch workspace
          </Button>
          <WorkspaceSwitcherSheet
            visible={model.workspaceSwitcherOpen}
            onClose={() => {
              model.setWorkspaceSwitcherOpen(false);
            }}
          />
        </>
      )}
    </View>
  );
}

/**
 * Recovery actions for a startup that is taking too long: retry the runtime,
 * forget the saved server, or return to the connect screen.
 */
function ChatStartupRecovery({ model }: { readonly model: ReturnType<typeof useChatScreenModel> }) {
  const router = useRouter();
  const { profiles, remove } = useProfiles();
  const [retrySignal, setRetrySignal] = useState(0);
  const stuck = useStuckTimeout(!model.ready, retrySignal);
  if (!stuck) {
    return null;
  }

  const activeProfileId = model.activeProfile?.id;
  const canRemoveServer =
    activeProfileId !== undefined && profiles.some((entry) => entry.id === activeProfileId);

  return (
    <>
      <Text size="sm" tone="muted">
        This is taking longer than usual.
      </Text>
      <ConnectionRecoveryActions
        serverName={model.workspaceName}
        canRemoveServer={canRemoveServer}
        onRetry={() => {
          model.retryStartup();
          setRetrySignal((signal) => signal + 1);
        }}
        onSwitchServer={() => {
          router.push("/connect");
        }}
        onRemoveServer={() => {
          if (activeProfileId === undefined) {
            return;
          }
          void remove(activeProfileId);
          router.push("/connect");
        }}
      />
    </>
  );
}

function ChatScreenPanes({ model }: { readonly model: ReturnType<typeof useChatScreenModel> }) {
  return (
    <BottomSheetModalProvider>
      <View className="flex-1 bg-bg">
        <SwipePanes
          index={model.pane}
          onIndexChange={(next) => {
            selectionFeedback();
            model.setPane(next);
          }}
          left={<ChatHubPane model={model} />}
          center={<ChatConversation model={model} />}
          right={
            <MembersPane
              memberIds={model.conversationMemberIds}
              channelTitle={model.channelTitle}
              members={model.members}
              presence={model.presence}
              roles={model.memberRoleGroups}
              ownUserId={model.ownUserId}
              canModerateMembers={model.canModerateMembers}
              onBack={() => {
                model.goToPane(1);
              }}
              onMemberPress={model.setProfileFor}
              onMemberActions={(userId) => {
                model.setModerationError(null);
                model.setMemberActionsFor(userId);
              }}
              onOpenBans={
                model.canBan
                  ? () => {
                      model.setBansOpen(true);
                    }
                  : undefined
              }
            />
          }
        />
        <ChatScreenSheets model={model} />
      </View>
    </BottomSheetModalProvider>
  );
}
