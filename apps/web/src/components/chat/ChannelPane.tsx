import type { ChannelView, MentionTarget, MessagePayload, RoleMentionTarget } from "@aulora/core";
import { hasPermission, Permission } from "@aulora/core";
import { Icon } from "@aulora/ui-web";
import type { ChatRuntime } from "../../lib/chat-runtime";
import type { ChannelSessionState } from "../../lib/use-channel";
import type { ChatContextValue } from "../../providers/ChatProvider";
import type { VoiceContextValue } from "../../providers/VoiceProvider";
import { Composer } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";
import { MessageList } from "./MessageList";
import { PinnedMessagesPanel } from "./PinnedMessagesPanel";
import type { PresenceStatus } from "./PresenceAvatar";

export interface ChannelMentionEntry {
  readonly channelId: string;
  readonly name: string;
}

export interface CategoryMentionEntry {
  readonly categoryId: string;
  readonly name: string;
}

export interface ConversationStartProps {
  readonly channel: ChannelView;
  readonly title: string;
}

/** The empty-state shown at the start of a fresh conversation or channel. */
export function ConversationStart({ channel, title }: ConversationStartProps) {
  const isChannel = channel.kind === "text" || channel.kind === "announcement";
  const icon = isChannel ? (channel.kind === "announcement" ? "announce" : "hash") : "message";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
        <Icon name={icon} size={24} />
      </span>
      <h3 className="text-xl font-semibold tracking-tight text-text">
        {isChannel ? `Welcome to #${title}` : title}
      </h3>
      <p className="max-w-sm text-sm text-text-muted">
        {isChannel
          ? "This is the very beginning of the channel. Say hello."
          : "This is the start of your conversation."}
      </p>
    </div>
  );
}

/** The channel surface for one open text/announcement/DM conversation. */
export interface ChannelPaneProps {
  readonly runtime: ChatRuntime;
  readonly channel: ChannelView;
  readonly title: string;
  readonly placeholder: string;
  readonly ownUserId: string;
  readonly ownName: string;
  readonly alignment: "left" | "right";
  readonly channelPermissions: bigint;
  readonly sessionState: ChannelSessionState;
  readonly mergedMessages: readonly MessagePayload[];
  readonly mergedDecrypted: ReadonlyMap<string, string>;
  readonly attachments: NonNullable<Parameters<typeof MessageList>[0]["attachments"]>;
  readonly pendingIds: ReadonlySet<string>;
  readonly failedIds: ReadonlySet<string>;
  readonly replyPreviews: NonNullable<Parameters<typeof MessageList>[0]["replyPreviews"]>;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors: ReadonlyMap<string, string>;
  readonly mentionNames: readonly string[];
  readonly mentionMembers: readonly MentionTarget[];
  readonly memberIds: readonly string[];
  readonly roles: readonly RoleMentionTarget[];
  readonly channelMentions: readonly ChannelMentionEntry[];
  readonly categoryMentions: readonly CategoryMentionEntry[];
  readonly visibleMemberCount: number;
  readonly presenceOf: (userId: string) => PresenceStatus;
  readonly voice: VoiceContextValue;
  readonly chat: ChatContextValue;
  readonly canSend: boolean;
  readonly canAttach: boolean;
  readonly canMentionEveryone: boolean;
  /** Effective single-upload cap in bytes, forwarded to the composer. */
  readonly maxUploadBytes: number;
  readonly pinsOpen: boolean;
  readonly membersOpen: boolean;
  readonly replyTarget?: MessagePayload;
  readonly sendError: string | null;
  readonly typingPing: (channelId: string) => void;
  readonly onOpenChannel: (channelId: string) => void;
  readonly onSetReplyTarget: (message?: MessagePayload) => void;
  readonly onSetThreadRoot: (message?: MessagePayload) => void;
  readonly onToggleMembers: () => void;
  readonly onOpenSearch: () => void;
  readonly onTogglePins: () => void;
  readonly onBack: () => void;
  readonly onSetSendError: (error: string | null) => void;
  readonly onSetNewConversationOpen: (open: boolean) => void;
  readonly sendWithFiles: (
    channelId: string,
    input: {
      text: string;
      mentionUserIds: readonly string[];
      mentionChannelIds?: readonly string[];
      mentionCategoryIds?: readonly string[];
      files: readonly File[];
    },
    extra?: { threadRootId?: string; replyToId?: string },
  ) => Promise<string | undefined>;
}

function truncateReply(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const max = 120;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Header plus optional pin panel for a channel. */
function ChannelHeader(props: ChannelPaneProps) {
  const { voice, channel, channelPermissions } = props;
  return (
    <>
      <ConversationHeader
        channel={channel}
        title={props.title}
        ownUserId={props.ownUserId}
        memberCount={props.visibleMemberCount}
        presenceOf={props.presenceOf}
        membersOpen={props.membersOpen}
        onToggleMembers={props.onToggleMembers}
        onOpenSearch={props.onOpenSearch}
        pinsOpen={props.pinsOpen}
        onTogglePins={props.onTogglePins}
        onBack={props.onBack}
        canStartCall={voice.canConnect && hasPermission(channelPermissions, Permission.Connect)}
        canStartVideoCall={voice.canVideo && hasPermission(channelPermissions, Permission.UseVideo)}
        onStartCall={(kind) => {
          props.onSetNewConversationOpen(false);
          void voice.startCall(channel.id, kind);
        }}
      />
      {props.pinsOpen && (
        <PinnedMessagesPanel
          key={channel.id}
          channelId={channel.id}
          memberNames={props.memberNames}
          permissions={channelPermissions}
          onClose={props.onTogglePins}
        />
      )}
    </>
  );
}

/** The scrollable message timeline for a channel. */
function ChannelTimeline(props: ChannelPaneProps) {
  const { runtime, channel, chat } = props;
  return (
    <MessageList
      key={channel.id}
      runtime={runtime}
      channelId={channel.id}
      messages={props.mergedMessages}
      decrypted={props.mergedDecrypted}
      attachments={props.attachments}
      pendingIds={props.pendingIds}
      failedIds={props.failedIds}
      onRetrySend={(pendingId) => {
        void chat.retrySend?.(pendingId.replace(/^pending:/, ""));
      }}
      onDiscardSend={(pendingId) => {
        void chat.discardSend?.(pendingId.replace(/^pending:/, ""));
      }}
      permissions={props.channelPermissions}
      ownUserId={props.ownUserId}
      ownName={props.ownName}
      memberNames={props.memberNames}
      memberColors={props.memberColors}
      mentionNames={props.mentionNames}
      channelNames={props.channelMentions.map((entry) => entry.name)}
      onChannelClick={(name) => {
        const target = props.channelMentions.find((entry) => entry.name === name);
        if (target !== undefined) {
          props.onOpenChannel(target.channelId);
        }
      }}
      firstUnreadId={props.sessionState.unread.firstUnreadId}
      typers={props.sessionState.typers}
      hasOlder={props.sessionState.hasOlder}
      loading={props.sessionState.loading}
      onLoadOlder={props.sessionState.loadOlder}
      onReply={(message) => {
        props.onSetThreadRoot(message);
      }}
      onReplyTo={(message) => {
        props.onSetReplyTarget(message);
      }}
      replyPreviews={props.replyPreviews}
      ownSide={props.alignment}
      onEdit={(message, text) => {
        void runtime.session.editMessage(channel.id, message.id, text);
      }}
      onDelete={(message) => {
        void runtime.session.deleteMessage(channel.id, message.id);
      }}
      onPinToggle={(message) => {
        void (message.pinnedAt !== null
          ? runtime.session.unpinMessage(channel.id, message.id)
          : runtime.session.pinMessage(channel.id, message.id));
      }}
      onReact={(message, emoji) => {
        void runtime.session.toggleReaction(channel.id, message.id, emoji);
      }}
      emptyState={<ConversationStart channel={channel} title={props.title} />}
    />
  );
}

/** The reply banner's quoted preview, or null when not replying. */
function replyPreviewOf(props: ChannelPaneProps): { authorName: string; preview: string } | null {
  const target = props.replyTarget;
  if (target === undefined) {
    return null;
  }
  const authorName =
    target.authorId === props.ownUserId
      ? props.ownName
      : (props.memberNames.get(target.authorId) ?? "Unknown member");
  return {
    authorName,
    preview: truncateReply(props.mergedDecrypted.get(target.id) ?? target.body),
  };
}

/** The composer (or a read-only notice) beneath a channel timeline. */
function ChannelComposer(props: ChannelPaneProps) {
  const { channel } = props;
  if (!props.canSend) {
    return (
      <p className="m-4 rounded-[10px] border border-border bg-surface-2 px-4 py-3 text-center text-[13px] text-text-muted">
        You can read this channel, but only some roles can post here.
      </p>
    );
  }
  return (
    <Composer
      channelId={channel.id}
      draftKey={channel.id}
      members={props.mentionMembers}
      roles={props.roles}
      memberIds={props.memberIds}
      channels={props.channelMentions}
      categories={props.categoryMentions}
      canAttach={props.canAttach}
      canMentionEveryone={props.canMentionEveryone}
      maxUploadBytes={props.maxUploadBytes}
      ownName={props.ownName}
      placeholder={props.placeholder}
      onTyping={props.typingPing}
      onSend={async (input) => {
        await props.sendWithFiles(
          channel.id,
          input,
          props.replyTarget !== undefined ? { replyToId: props.replyTarget.id } : {},
        );
        props.onSetReplyTarget(undefined);
      }}
      replyTo={replyPreviewOf(props)}
      onCancelReply={() => {
        props.onSetReplyTarget(undefined);
      }}
    />
  );
}

/** Renders the header, timeline, optional pin panel and composer for a channel. */
export function ChannelPane(props: ChannelPaneProps) {
  return (
    <>
      <ChannelHeader {...props} />
      <ChannelTimeline {...props} />
      {props.sendError !== null && (
        <div
          role="alert"
          className="mx-4 mb-1 flex items-center gap-2 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"
        >
          <span className="flex-1">{props.sendError}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              props.onSetSendError(null);
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      <ChannelComposer {...props} />
    </>
  );
}
