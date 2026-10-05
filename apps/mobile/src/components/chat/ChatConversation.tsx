import {
  type AttachmentDescriptor,
  expandBroadcast,
  hasPermission,
  joinedElsewhere,
  Permission,
  resolveChannelMentions,
  resolveMentions,
} from "@aulora/core";
import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type PickedFile, uploadPickedFiles } from "../../lib/attachments";
import { JoinedElsewhereScreen } from "../voice/JoinedElsewhereScreen";
import { ChatPendingFailures } from "./ChatPendingFailures";
import { Composer } from "./Composer";
import { RoundButton } from "./HubPane";
import { MessageList } from "./MessageList";
import { PresenceAvatar } from "./PresenceAvatar";
import type { ChatScreenModel } from "./use-chat-screen-model";

type Palette = ReturnType<typeof usePalette>;

export function ChatConversation({ model }: { readonly model: ChatScreenModel }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={-insets.bottom}
      style={{ flex: 1, backgroundColor: palette.bg, paddingTop: insets.top }}
    >
      <ChatConversationHeader model={model} palette={palette} />
      <ChatConversationBody model={model} palette={palette} />
    </KeyboardAvoidingView>
  );
}

function ChatConversationHeader({
  model,
  palette,
}: {
  readonly model: ChatScreenModel;
  readonly palette: Palette;
}) {
  return (
    <View className="flex-row items-center gap-3 border-b border-border px-3 pb-2 pt-1">
      <RoundButton
        icon="menu"
        label="Open conversations"
        onPress={() => {
          model.goToPane(0);
        }}
      />
      <ChatHeaderTitle model={model} palette={palette} />
      <ChatHeaderCallButtons model={model} />
      {model.channel !== undefined &&
        hasPermission(model.channelPermissions, Permission.ReadHistory) && (
          <RoundButton
            icon="pin"
            label="Pinned messages"
            onPress={() => {
              model.setPinsOpen(true);
            }}
          />
        )}
      <RoundButton
        icon="users"
        label="Members"
        onPress={() => {
          model.goToPane(2);
        }}
      />
    </View>
  );
}

function ChatHeaderTitle({
  model,
  palette,
}: {
  readonly model: ChatScreenModel;
  readonly palette: Palette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${model.channelTitle}, show members`}
      onPress={() => {
        model.goToPane(2);
      }}
      className="min-h-11 min-w-0 flex-1 flex-row items-center gap-2.5 active:opacity-70"
    >
      <ChannelIdentityIcon model={model} palette={palette} />
      <View className="min-w-0 flex-1">
        <Text className="font-semibold" numberOfLines={1} maxFontSizeMultiplier={1.5}>
          {model.channelTitle}
        </Text>
        {model.channelSubtitle !== undefined && model.channelSubtitle.length > 0 && (
          <Text size="xs" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.5}>
            {model.channelSubtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function ChannelIdentityIcon({
  model,
  palette,
}: {
  readonly model: ChatScreenModel;
  readonly palette: Palette;
}) {
  const { channel, partnerId } = model;
  if (partnerId !== undefined) {
    return (
      <PresenceAvatar
        userId={partnerId}
        status={model.partnerPresence?.status ?? "offline"}
        size={32}
        surface={palette.bg}
      />
    );
  }
  if (channel === undefined || model.isDirect) {
    return null;
  }
  return <Icon name={channelIconName(channel)} size={20} color={palette["text-muted"]} />;
}

function channelIconName(channel: NonNullable<ChatScreenModel["channel"]>) {
  if (channel.kind === "voice") {
    return "volume" as const;
  }
  if (channel.isPrivate === true) {
    return "lock" as const;
  }
  return channel.kind === "announcement" ? ("megaphone" as const) : ("hash" as const);
}

function ChatHeaderCallButtons({ model }: { readonly model: ChatScreenModel }) {
  const { channel, voice } = model;
  if (channel === undefined || !model.isDirect || !voice.canConnect) {
    return null;
  }
  return (
    <>
      <RoundButton
        icon="phone"
        label="Start voice call"
        onPress={() => void voice.startCall(channel.id, "voice")}
      />
      {voice.canVideo && (
        <RoundButton
          icon="video"
          label="Start video call"
          onPress={() => void voice.startCall(channel.id, "video")}
        />
      )}
    </>
  );
}

function ChatConversationBody({
  model,
  palette,
}: {
  readonly model: ChatScreenModel;
  readonly palette: Palette;
}) {
  const { channel, voice, ownUserId } = model;
  if (channel === undefined) {
    return <ChatEmptyState model={model} />;
  }
  const elsewhere = joinedElsewhere(
    voice.activeCalls.find((entry) => entry.channelId === channel.id) ?? null,
    ownUserId,
    voice.clientId,
    voice.callId,
  );
  if (channel.kind === "voice" && elsewhere) {
    return <ChatJoinedElsewhere model={model} />;
  }
  return <ChatMessageArea model={model} palette={palette} />;
}

function ChatEmptyState({ model }: { readonly model: ChatScreenModel }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <Text tone="muted" className="text-center">
        Pick a conversation to start.
      </Text>
      <Button
        variant="secondary"
        onPress={() => {
          model.goToPane(0);
        }}
      >
        Browse conversations
      </Button>
    </View>
  );
}

function ChatJoinedElsewhere({ model }: { readonly model: ChatScreenModel }) {
  const channel = model.channel;
  if (channel === undefined) {
    return null;
  }
  return (
    <JoinedElsewhereScreen
      channelName={channel.name}
      pending={model.voice.pending}
      canJoin={model.voice.canConnect}
      onJoin={() => {
        model.joinVoiceChannel(channel.id);
      }}
    />
  );
}

function ChatMessageArea({
  model,
  palette,
}: {
  readonly model: ChatScreenModel;
  readonly palette: Palette;
}) {
  const channel = model.channel;
  if (channel === undefined) {
    return null;
  }
  return (
    <>
      <MessageList
        key={channel.id}
        runtime={model.runtime}
        channelId={channel.id}
        messages={model.mergedMessages}
        decrypted={model.mergedDecrypted}
        attachments={model.attachmentsByMessage}
        pendingIds={model.pendingIds}
        ownUserId={model.ownUserId}
        memberNames={model.memberNames}
        memberColors={model.memberColors}
        channelNames={model.mentionNames}
        hasOlder={model.sessionState.hasOlder}
        loadingOlder={model.sessionState.loadingOlder}
        onLoadOlder={model.sessionState.loadOlder}
        firstUnreadId={model.sessionState.unread.firstUnreadId}
        permissions={model.channelPermissions}
        jumpToMessageId={model.messageContext?.root.id ?? model.jumpToMessageId}
        onQuote={model.setQuote}
        onMemberPress={model.setProfileFor}
        onReply={model.setThreadRoot}
        onChannelPress={(name) => {
          const target = model.mentionChannelTargets.find((entry) => entry.name === name);
          if (target !== undefined) {
            void model.openChannel(target.channelId);
          }
        }}
        onJumpToFirstUnread={() => {
          if (model.sessionState.unread.firstUnreadId !== null) {
            void model.runtime?.session.markRead(
              channel.id,
              model.sessionState.unread.firstUnreadId,
            );
          }
        }}
      />
      <ChatTypingIndicator model={model} />
      <ChatPendingFailures model={model} />
      <ChatQuoteBar model={model} palette={palette} />
      <ChatComposer model={model} channelId={channel.id} />
    </>
  );
}

function ChatTypingIndicator({ model }: { readonly model: ChatScreenModel }) {
  if (model.typing === null) {
    return null;
  }
  return (
    <Text size="xs" tone="muted" className="px-4 pb-1" accessibilityLiveRegion="polite">
      {model.typing}
    </Text>
  );
}

function ChatQuoteBar({
  model,
  palette,
}: {
  readonly model: ChatScreenModel;
  readonly palette: Palette;
}) {
  const { quote } = model;
  if (quote === null) {
    return null;
  }
  return (
    <View className="flex-row items-center gap-2 border-t border-border py-1.5 pl-4 pr-2">
      <Icon name="reply" size={14} color={palette.accent} />
      <Text size="xs" numberOfLines={1} className="min-w-0 flex-1">
        <Text size="xs" className="font-semibold">
          {model.memberNames.get(quote.authorId) ?? "Member"}
        </Text>
        <Text size="xs" tone="muted">
          {"  "}
          {(model.sessionState.decrypted.get(quote.id) ?? quote.body).replace(/\s+/g, " ").trim()}
        </Text>
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel reply"
        hitSlop={12}
        onPress={() => {
          model.setQuote(null);
        }}
        className="h-7 w-7 items-center justify-center rounded-pill active:bg-surface-3"
      >
        <Icon name="x" size={14} color={palette["text-muted"]} />
      </Pressable>
    </View>
  );
}

function ChatComposer({
  model,
  channelId,
}: {
  readonly model: ChatScreenModel;
  readonly channelId: string;
}) {
  const channel = model.channel;
  if (channel === undefined) {
    return null;
  }
  return (
    <Composer
      disabled={
        channel.archived || !hasPermission(model.channelPermissions, Permission.SendMessages)
      }
      channelId={channelId}
      placeholder={
        model.isDirect ? `Message ${model.channelTitle}` : `Message #${model.channelTitle}`
      }
      members={model.mentionUserTargets}
      roles={model.roles}
      channels={model.mentionChannelOptions}
      canMentionEveryone={model.canMentionEveryone}
      viewerName={model.ownDisplayName}
      onTyping={(typingChannelId) => {
        void model.runtime?.port.setTyping({ channelId: typingChannelId });
      }}
      onSend={makeSendHandler(model, channel.id)}
    />
  );
}

function makeSendHandler(model: ChatScreenModel, channelId: string) {
  return async ({
    text,
    files,
  }: {
    readonly text: string;
    readonly files: readonly PickedFile[];
  }) => {
    const runtime = model.runtime;
    if (runtime === undefined) {
      return;
    }
    const attachments = files.length > 0 ? await uploadPickedFiles(runtime.port, files) : undefined;
    const result = await model.sendMessage(channelId, text, sendOptions(model, text, attachments));
    model.setQuote(null);
    if (!result.queued && result.messageId !== undefined) {
      void runtime.session.markRead(channelId, result.messageId);
    }
  };
}

function sendOptions(
  model: ChatScreenModel,
  text: string,
  attachments: readonly AttachmentDescriptor[] | undefined,
) {
  const resolution = resolveMentions(text, model.mentionUserTargets, model.roles);
  const mentionUserIds = expandBroadcast(resolution, model.mentionMemberIds);
  const channelMentions = resolveChannelMentions(
    text,
    model.mentionChannelTargets,
    model.mentionCategoryTargets,
  );
  return {
    ...(model.quote !== null ? { replyToId: model.quote.id } : {}),
    ...(mentionUserIds.length > 0 ? { mentionUserIds } : {}),
    ...(channelMentions.channelIds.length > 0
      ? { mentionChannelIds: channelMentions.channelIds }
      : {}),
    ...(channelMentions.categoryIds.length > 0
      ? { mentionCategoryIds: channelMentions.categoryIds }
      : {}),
    ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
  };
}
