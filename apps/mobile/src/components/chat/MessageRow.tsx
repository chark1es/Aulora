/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  type AttachmentDescriptor,
  hasPermission,
  type MessagePayload,
  messageTime,
  Permission,
} from "@aulora/core";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { ChatSurfaceRuntime } from "../../lib/chat-surface";
import { AttachmentView } from "./AttachmentView";
import { MemberAvatar } from "./MemberAvatar";
import { ReactionRow } from "./ReactionRow";
import { RichText } from "./RichText";

/** The message a reply answers, as far as this client has it loaded. */
export interface ReplyPreview {
  readonly messageId: string;
  readonly authorName: string | undefined;
  readonly authorColor: string | undefined;
  /** Missing when the original is not loaded or was deleted. */
  readonly text: string | undefined;
}

/** What every row of one list shares: the conversation, the viewer and the handlers. */
export interface MessageRowContext {
  readonly runtime: ChatSurfaceRuntime | undefined;
  readonly channelId: string;
  readonly permissions: bigint;
  readonly ownUserId: string;
  readonly viewerName: string;
  readonly mentionNames: readonly string[];
  readonly channelNames: readonly string[];
  readonly onActions: (message: MessagePayload) => void;
  readonly onJumpToReply: (messageId: string) => void;
  readonly onReply?: ((message: MessagePayload) => void) | undefined;
  readonly onMemberPress?: ((userId: string) => void) | undefined;
  readonly onChannelPress?: ((name: string) => void) | undefined;
}

export interface MessageRowProps {
  readonly context: MessageRowContext;
  readonly message: MessagePayload;
  /** Continues the previous message's author block: no avatar or name. */
  readonly grouped: boolean;
  /** Briefly marked after being jumped to. */
  readonly highlighted: boolean;
  readonly text: string | undefined;
  readonly reply: ReplyPreview | null;
  readonly attachments: readonly AttachmentDescriptor[];
  readonly pending: boolean;
  readonly authorName: string;
  readonly authorColor: string | undefined;
}

interface ReplyLineProps {
  readonly reply: ReplyPreview;
  readonly onPress: () => void;
}

/** One line above a reply naming what it answers, tied to the avatar by an elbow, as on web. */
function ReplyLine({ reply, onPress }: ReplyLineProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        reply.authorName === undefined
          ? "Jump to replied message"
          : `Reply to ${reply.authorName}. Jump to that message`
      }
      hitSlop={{ top: 10, bottom: 6 }}
      onPress={onPress}
      className="mb-1 flex-row items-center active:opacity-70"
    >
      <Svg width={48} height={16} viewBox="0 0 48 16" fill="none">
        <Path
          d="M 18 16 L 18 13 Q 18 8 23 8 L 44 8"
          stroke={reply.authorColor ?? palette["text-muted"]}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </Svg>
      <Text size="xs" numberOfLines={1} className="min-w-0 flex-1" maxFontSizeMultiplier={1.6}>
        {reply.text === undefined ? (
          <Text size="xs" tone="muted" className="italic">
            Replying to a message
          </Text>
        ) : (
          <>
            <Text
              size="xs"
              className="font-semibold"
              style={{ color: reply.authorColor ?? palette.accent }}
            >
              {reply.authorName ?? "Member"}
            </Text>
            <Text size="xs" tone="muted">
              {"  "}
              {reply.text.replace(/\s+/g, " ").trim()}
            </Text>
          </>
        )}
      </Text>
    </Pressable>
  );
}

interface AuthorLineProps {
  readonly name: string;
  readonly color: string | undefined;
  readonly time: string;
  readonly pinned: boolean;
}

function AuthorLine({ name, color, time, pinned }: AuthorLineProps) {
  const palette = usePalette();
  return (
    <View className="flex-row flex-wrap items-baseline gap-x-2">
      <Text size="sm" className="font-semibold" style={color !== undefined ? { color } : undefined}>
        {name}
      </Text>
      <Text size="xs" tone="muted">
        {time}
      </Text>
      {pinned && <Icon name="pin" size={12} color={palette.accent} />}
    </View>
  );
}

interface ThreadChipProps {
  readonly replies: number;
  readonly onPress: () => void;
}

function ThreadChip({ replies, onPress }: ThreadChipProps) {
  const palette = usePalette();
  const label = `${replies} ${replies === 1 ? "reply" : "replies"}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open thread, ${label}`}
      hitSlop={8}
      onPress={onPress}
      className="flex-row items-center gap-1.5 self-start rounded-pill bg-surface-2 px-3 py-1.5 active:opacity-70"
    >
      <Icon name="thread" size={14} color={palette.accent} />
      <Text size="xs" tone="accent" className="font-semibold">
        {label}
      </Text>
      <Icon name="chevron-right" size={14} color={palette["text-muted"]} />
    </Pressable>
  );
}

interface MessageTextProps {
  readonly text: string | undefined;
  readonly pending: boolean;
  readonly edited: boolean;
  readonly context: MessageRowContext;
}

/** The message's words, or why they are missing, and whether it was edited. */
function MessageText({ text, pending, edited, context }: MessageTextProps) {
  return (
    <>
      {text !== undefined && (
        <RichText
          text={text}
          mentionNames={context.mentionNames}
          channelNames={context.channelNames}
          viewerName={context.viewerName}
          onChannelPress={context.onChannelPress}
        />
      )}
      {text === undefined && !pending && (
        <Text size="sm" tone="muted">
          Unable to load this message.
        </Text>
      )}
      {edited && (
        <Text size="xs" tone="muted">
          edited
        </Text>
      )}
    </>
  );
}

/** Text, attachments, reactions and the thread chip: everything beside the avatar. */
function MessageBody(props: MessageRowProps) {
  const { context, message, text, pending } = props;
  const replies = message.replyCount ?? 0;
  const { runtime, onReply } = context;
  return (
    <View className="min-w-0 flex-1 gap-1">
      {!props.grouped && (
        <AuthorLine
          name={props.authorName}
          color={props.authorColor}
          time={messageTime(message.createdAt)}
          pinned={message.pinnedAt !== null}
        />
      )}
      <MessageText
        text={text}
        pending={pending}
        edited={message.editedAt !== null}
        context={context}
      />
      {props.attachments.map((attachment) => (
        <AttachmentView key={attachment.fileId} runtime={runtime} descriptor={attachment} />
      ))}
      {pending && (
        <Text size="xs" tone="muted">
          Sending…
        </Text>
      )}
      {runtime !== undefined && (
        <ReactionRow
          runtime={runtime}
          channelId={context.channelId}
          messageId={message.id}
          ownUserId={context.ownUserId}
          onAdd={() => {
            context.onActions(message);
          }}
          pending={pending}
          canReact={hasPermission(context.permissions, Permission.AddReactions)}
        />
      )}
      {replies > 0 && onReply !== undefined && (
        <ThreadChip
          replies={replies}
          onPress={() => {
            onReply(message);
          }}
        />
      )}
    </View>
  );
}

/** One message. Tap or long-press it for reactions, replies and the rest of its actions. */
export function MessageRow(props: MessageRowProps) {
  const { context, message, grouped, reply, pending, authorName } = props;
  const openActions = () => {
    context.onActions(message);
  };
  const { onMemberPress } = context;
  return (
    <Pressable
      accessibilityLabel={`${authorName}, ${messageTime(message.createdAt)}. ${props.text ?? ""}`}
      accessibilityHint="Opens reactions, replies and more"
      disabled={pending}
      delayLongPress={280}
      onPress={openActions}
      onLongPress={openActions}
      className={`px-4 active:bg-surface-1 ${grouped ? "py-0.5" : "pb-0.5 pt-2.5"} ${
        props.highlighted ? "bg-accent-soft" : ""
      } ${pending ? "opacity-60" : ""}`}
    >
      {reply !== null && (
        <ReplyLine
          reply={reply}
          onPress={() => {
            context.onJumpToReply(reply.messageId);
          }}
        />
      )}
      <View className="flex-row gap-3">
        {grouped ? (
          <View className="w-9" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Profile of ${authorName}`}
            disabled={onMemberPress === undefined}
            hitSlop={6}
            onPress={() => onMemberPress?.(message.authorId)}
            className="pt-0.5"
          >
            <MemberAvatar userId={message.authorId} size={36} roleColor={props.authorColor} />
          </Pressable>
        )}
        <MessageBody {...props} />
      </View>
    </Pressable>
  );
}
