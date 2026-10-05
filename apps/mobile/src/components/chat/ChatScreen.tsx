import { Button, Spinner, Text } from "@aulora/ui-native";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { selectionFeedback } from "../../lib/haptics";
import { ChatConversation } from "./ChatConversation";
import { ChatHubPane } from "./ChatHubPane";
import { ChatScreenSheets } from "./ChatScreenSheets";
import type { ChatScreenProps } from "./chat-screen-types";
import { MembersPane } from "./MembersPane";
import { SwipePanes } from "./SwipePanes";
import { useChatScreenModel } from "./use-chat-screen-model";
import { WorkspaceSwitcherSheet } from "./WorkspaceSwitcherSheet";

export type { ChatScreenProps } from "./chat-screen-types";

/**
 * The signed-in mobile chat surface as three full-screen panes. The conversation
 * sits in the middle; swipe right for the hub (conversations, threads, search,
 * settings) and left for the people in it.
 */
export function ChatScreen(props: ChatScreenProps) {
  const model = useChatScreenModel(props);
  if (!model.ready || model.startupError !== null) {
    return <ChatScreenStatus model={model} />;
  }
  return <ChatScreenPanes model={model} />;
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
