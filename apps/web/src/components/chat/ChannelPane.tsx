/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { ChannelView, MentionTarget, MessagePayload, RoleMentionTarget } from "@aulora/core";
import {
  channelOpening,
  conversationOpening,
  dmPartnerId,
  hasPermission,
  Permission,
} from "@aulora/core";
import { Icon } from "@aulora/ui-web";
import { useCallback, useMemo, useState } from "react";
import type { ChatRuntime } from "../../lib/chat-runtime";
import type { ChannelSessionState } from "../../lib/use-channel";
import type { ChatContextValue } from "../../providers/ChatProvider";
import type { VoiceContextValue } from "../../providers/VoiceProvider";
import { Composer, type ComposerSeed } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";
import { MessageList } from "./MessageList";
import { PinnedMessagesPanel } from "./PinnedMessagesPanel";
import { GroupAvatar, PresenceAvatar, type PresenceStatus } from "./PresenceAvatar";

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
  readonly ownUserId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly presenceOf: (userId: string) => PresenceStatus;
  /** Whether the viewer may post here. */
  readonly canSend: boolean;
  /** Whether the viewer may start a voice call here. */
  readonly canStartCall: boolean;
  /** Places a first-message suggestion in the composer. */
  readonly onSayHi: (text: string) => void;
  readonly onStartCall: () => void;
}

function ConversationAction({
  icon,
  onClick,
  children,
}: {
  readonly icon: "message" | "phone";
  readonly onClick: () => void;
  readonly children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 select-none items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 text-[12.5px] font-medium text-text transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-chat"
    >
      <Icon name={icon} size={15} className="text-accent-text" />
      {children}
    </button>
  );
}

/**
 * The opening of a direct or group conversation: the people in it, how they
 * relate to the viewer, and a first action — not a generic "empty" glyph.
 */
function ConversationOpening(props: ConversationStartProps) {
  const { channel, title, ownUserId } = props;
  const partnerId = dmPartnerId(channel, ownUserId);
  const status = partnerId === undefined ? undefined : props.presenceOf(partnerId);
  const opening = conversationOpening({ ...props, partnerStatus: status });
  const { isGroup, isSelf, partnerId: partner, otherIds: others, body, sayHi } = opening;

  return (
    <div className="flex flex-1 items-center py-10">
      <section className="w-full max-w-[34rem] animate-slide-up motion-reduce:animate-none">
        <div className="flex items-start gap-4">
          {isGroup ? (
            <GroupAvatar userIds={others} size={64} />
          ) : (
            <PresenceAvatar
              userId={partner ?? ownUserId}
              size={64}
              {...(isSelf || status === undefined ? {} : { status })}
              ringClassName="ring-chat"
            />
          )}
          <div className="min-w-0 pt-1">
            <h3 className="break-words text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-text sm:text-[26px]">
              {title}
            </h3>
          </div>
        </div>
        <p className="mt-5 max-w-[52ch] text-sm leading-6 text-text-muted">{body}</p>
        {opening.showActions && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {sayHi !== null && (
              <ConversationAction
                icon="message"
                onClick={() => {
                  props.onSayHi(sayHi);
                }}
              >
                Say hi
              </ConversationAction>
            )}
            {sayHi === null && props.canStartCall && (
              <ConversationAction icon="phone" onClick={props.onStartCall}>
                Start a call
              </ConversationAction>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** The empty-state shown at the start of a fresh conversation or channel. */
export function ConversationStart(props: ConversationStartProps) {
  const { channel, title } = props;
  const isChannel = channel.kind === "text" || channel.kind === "announcement";
  if (!isChannel) {
    return <ConversationOpening {...props} />;
  }
  const icon = channel.kind === "announcement" ? "announce" : "hash";
  const opening = channelOpening(channel.kind, title);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-accent-soft text-accent-text">
        <Icon name={icon} size={24} />
      </span>
      <h3 className="text-xl font-semibold tracking-tight text-text">{opening.heading}</h3>
      <p className="max-w-sm text-sm text-text-muted">{opening.body}</p>
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
  readonly failureReasons?: ReadonlyMap<string, string>;
  readonly failedIds: ReadonlySet<string>;
  readonly replyPreviews: NonNullable<Parameters<typeof MessageList>[0]["replyPreviews"]>;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors: ReadonlyMap<string, string>;
  readonly mentionNames: readonly string[];
  readonly mentionMembers: readonly MentionTarget[];
  /** Server-side member search for mention autocomplete and resolution. */
  readonly searchMembers?: (query: string) => Promise<readonly MentionTarget[]>;
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
  readonly mentionMarkers?: boolean;
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
      mentionEveryone?: boolean;
      mentionHere?: boolean;
      mentionChannelIds?: readonly string[];
      mentionCategoryIds?: readonly string[];
      mentionRoleIds?: readonly string[];
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
function ChannelTimeline(props: ChannelPaneProps & { readonly onSayHi: (text: string) => void }) {
  const { runtime, channel, chat } = props;
  // Stable callbacks and derived arrays so the memoized timeline rows can skip
  // re-rendering when only unrelated state (typing, presence, voice level) changes.
  const channelNames = useMemo(
    () => props.channelMentions.map((entry) => entry.name),
    [props.channelMentions],
  );
  const onChannelClick = useCallback(
    (name: string) => {
      const target = props.channelMentions.find((entry) => entry.name === name);
      if (target !== undefined) {
        props.onOpenChannel(target.channelId);
      }
    },
    [props.channelMentions, props.onOpenChannel],
  );
  const onRetrySend = useCallback(
    (pendingId: string) => {
      void chat.retrySend?.(pendingId.replace(/^pending:/, ""));
    },
    [chat.retrySend],
  );
  const onDiscardSend = useCallback(
    (pendingId: string) => {
      void chat.discardSend?.(pendingId.replace(/^pending:/, ""));
    },
    [chat.discardSend],
  );
  const onReply = useCallback(
    (message: MessagePayload) => {
      props.onSetThreadRoot(message);
    },
    [props.onSetThreadRoot],
  );
  const onReplyTo = useCallback(
    (message: MessagePayload) => {
      props.onSetReplyTarget(message);
    },
    [props.onSetReplyTarget],
  );
  const onEdit = useCallback(
    (message: MessagePayload, text: string) => {
      void runtime.session.editMessage(channel.id, message.id, text);
    },
    [runtime, channel.id],
  );
  const onDelete = useCallback(
    (message: MessagePayload) => {
      void runtime.session.deleteMessage(channel.id, message.id);
    },
    [runtime, channel.id],
  );
  const onPinToggle = useCallback(
    (message: MessagePayload) => {
      void (message.pinnedAt !== null
        ? runtime.session.unpinMessage(channel.id, message.id)
        : runtime.session.pinMessage(channel.id, message.id));
    },
    [runtime, channel.id],
  );
  const onReact = useCallback(
    (message: MessagePayload, emoji: string) => {
      void runtime.session.toggleReaction(channel.id, message.id, emoji);
    },
    [runtime, channel.id],
  );
  return (
    <MessageList
      key={channel.id}
      runtime={runtime}
      channelId={channel.id}
      messages={props.mergedMessages}
      decrypted={props.mergedDecrypted}
      attachments={props.attachments}
      pendingIds={props.pendingIds}
      failureReasons={props.failureReasons}
      failedIds={props.failedIds}
      onRetrySend={onRetrySend}
      onDiscardSend={onDiscardSend}
      permissions={props.channelPermissions}
      ownUserId={props.ownUserId}
      ownName={props.ownName}
      memberNames={props.memberNames}
      memberColors={props.memberColors}
      mentionNames={props.mentionNames}
      channelNames={channelNames}
      onChannelClick={onChannelClick}
      firstUnreadId={props.sessionState.unread.firstUnreadId}
      typers={props.sessionState.typers}
      hasOlder={props.sessionState.hasOlder}
      loading={props.sessionState.loading}
      onLoadOlder={props.sessionState.loadOlder}
      historySeamId={props.sessionState.historySeamId}
      onResetHistory={props.sessionState.resetHistoryWindow}
      onReply={onReply}
      onReplyTo={onReplyTo}
      replyPreviews={props.replyPreviews}
      ownSide={props.alignment}
      onEdit={onEdit}
      onDelete={onDelete}
      onPinToggle={onPinToggle}
      onReact={onReact}
      emptyState={
        <ConversationStart
          channel={channel}
          title={props.title}
          ownUserId={props.ownUserId}
          memberNames={props.memberNames}
          presenceOf={props.presenceOf}
          canSend={props.canSend}
          canStartCall={
            props.voice.canConnect && hasPermission(props.channelPermissions, Permission.Connect)
          }
          onSayHi={props.onSayHi}
          onStartCall={() => {
            props.onSetNewConversationOpen(false);
            void props.voice.startCall(channel.id, "voice");
          }}
        />
      }
    />
  );
}

/** The reply banner’s quoted preview, or null when not replying. */
function replyPreviewOf(
  props: ChannelPaneProps,
): { authorName: string; preview: string; mentionEveryone: boolean; mentionHere: boolean } | null {
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
    mentionEveryone: target.mentionEveryone === true,
    mentionHere: target.mentionHere === true,
  };
}

/** The composer (or a read-only notice) beneath a channel timeline. */
function ChannelComposer(
  props: ChannelPaneProps & { readonly composerSeed: ComposerSeed | undefined },
) {
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
      mentionMarkers={props.mentionMarkers ?? false}
      channelId={channel.id}
      draftKey={channel.id}
      {...(props.composerSeed !== undefined ? { seedText: props.composerSeed } : {})}
      members={props.mentionMembers}
      {...(props.searchMembers !== undefined ? { searchMembers: props.searchMembers } : {})}
      roles={props.roles}
      memberIds={props.memberIds}
      channels={props.channelMentions}
      categories={props.categoryMentions}
      canAttach={props.canAttach}
      canMentionEveryone={props.canMentionEveryone}
      massMentionHint={
        props.channel.kind === "dm" || props.channel.kind === "group_dm"
          ? "Notifying everyone isn't available in direct messages."
          : undefined
      }
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
  const [composerSeed, setComposerSeed] = useState<ComposerSeed | undefined>(undefined);
  const onSayHi = useCallback(
    (text: string) => {
      setComposerSeed((current) => ({ token: (current?.token ?? 0) + 1, text }));
      props.onSetNewConversationOpen(false);
    },
    [props.onSetNewConversationOpen],
  );

  return (
    <>
      <ChannelHeader {...props} />
      <ChannelTimeline {...props} onSayHi={onSayHi} />
      {props.sendError !== null && (
        <div
          role="alert"
          className="mx-4 mb-1 flex items-center gap-2 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger-text"
        >
          <span className="flex-1">{props.sendError}</span>
          <button
            type="button"
            aria-label="Dismiss send error"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-danger-text/80 transition hover:bg-danger/15 hover:text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
            onClick={() => {
              props.onSetSendError(null);
            }}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      )}
      <ChannelComposer {...props} composerSeed={composerSeed} />
    </>
  );
}
