import type {
  AttachmentDescriptor,
  MentionTarget,
  MessagePayload,
  RoleMentionTarget,
} from "@aulora/core";
import { Icon } from "@aulora/ui-web";
import { useEffect, useMemo, useState } from "react";
import type { ChatRuntime } from "../../lib/chat-runtime";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

export interface ThreadsPanelProps {
  readonly runtime: ChatRuntime | undefined;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly root: MessagePayload;
  readonly rootText: string | undefined;
  readonly members: readonly MentionTarget[];
  readonly roles: readonly RoleMentionTarget[];
  readonly memberIds: readonly string[];
  readonly permissions: bigint;
  /** Effective single-upload cap in bytes, forwarded to the reply composer. */
  readonly maxUploadBytes: number;
  readonly ownUserId: string;
  readonly ownName: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly memberColors: ReadonlyMap<string, string>;
  readonly mentionNames: readonly string[];
  readonly onClose: () => void;
  readonly onTyping: (channelId: string) => void;
  readonly onSendReply: (input: {
    text: string;
    mentionUserIds: readonly string[];
    mentionChannelIds?: readonly string[];
    mentionCategoryIds?: readonly string[];
    files: readonly File[];
    /** Also post the reply to the channel timeline, not only the thread. */
    alsoSendToChannel: boolean;
  }) => void | Promise<void>;
  readonly onEdit: (message: MessagePayload, text: string) => void;
  readonly onDelete: (message: MessagePayload) => void;
  readonly onPinToggle: (message: MessagePayload) => void;
  readonly onReact: (message: MessagePayload, emoji: string) => void;
}

/** Side panel with one thread: the root message, its replies and a reply composer. */
export function ThreadsPanel(props: ThreadsPanelProps) {
  const { runtime, channelId, root, rootText } = props;
  const [replies, setReplies] = useState<readonly MessagePayload[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, string>>(new Map());
  const [alsoSend, setAlsoSend] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-subscribe only when the root/runtime changes
  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    let cancelled = false;
    const off = runtime.watchThread(root.id, (incoming) => {
      void runtime.session.receiveMessages(incoming).then(() => {
        if (cancelled) {
          return;
        }
        setReplies(incoming);
        setDecrypted((current) => {
          const next = new Map(current);
          for (const reply of incoming) {
            next.set(reply.id, runtime.session.decryptedText(reply.id));
          }
          return next;
        });
      });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [runtime, channelId, root.id]);

  const messages = useMemo(() => [root, ...replies], [root, replies]);
  const texts = useMemo(() => {
    const next = new Map(decrypted);
    if (rootText !== undefined) {
      next.set(root.id, rootText);
    }
    return next;
  }, [decrypted, root.id, rootText]);
  const attachments = useMemo(() => {
    const map = new Map<string, readonly AttachmentDescriptor[]>();
    if (runtime !== undefined) {
      for (const message of messages) {
        const list = runtime.session.attachmentsFor(message.id);
        if (list.length > 0) {
          map.set(message.id, list);
        }
      }
    }
    return map;
  }, [runtime, messages]);

  return (
    <aside
      aria-label="Thread"
      className="pane chat-canvas flex h-full w-[352px] shrink-0 animate-slide-in-right flex-col border-l border-border"
    >
      <header className="material-chrome flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-accent-soft text-accent">
          <Icon name="thread" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-text">Thread</h2>
          <p className="truncate text-xs text-text-muted">
            {replies.length === 1 ? "1 reply" : `${replies.length} replies`} · {props.channelTitle}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close thread"
          onClick={props.onClose}
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-text-muted hover:bg-surface-3 hover:text-text"
        >
          <Icon name="x" size={18} />
        </button>
      </header>

      <MessageList
        runtime={runtime}
        channelId={`${channelId}:thread:${root.id}`}
        messages={messages}
        decrypted={texts}
        attachments={attachments}
        pendingIds={new Set()}
        permissions={props.permissions}
        ownUserId={props.ownUserId}
        ownName={props.ownName}
        memberNames={props.memberNames}
        memberColors={props.memberColors}
        mentionNames={props.mentionNames}
        firstUnreadId={null}
        typers={[]}
        hasOlder={false}
        loading={false}
        onLoadOlder={() => undefined}
        onReply={() => undefined}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onPinToggle={props.onPinToggle}
        onReact={props.onReact}
        inThread
      />

      <Composer
        channelId={channelId}
        draftKey={`thread:${root.id}`}
        members={props.members}
        roles={props.roles}
        memberIds={props.memberIds}
        maxUploadBytes={props.maxUploadBytes}
        placeholder="Reply in thread…"
        windowDropEnabled={false}
        onTyping={props.onTyping}
        onSend={(input) =>
          props.onSendReply({
            text: input.text,
            mentionUserIds: input.mentionUserIds,
            mentionChannelIds: input.mentionChannelIds,
            mentionCategoryIds: input.mentionCategoryIds,
            files: input.files,
            alsoSendToChannel: alsoSend,
          })
        }
        toolbarExtra={
          <label className="ml-1 flex cursor-pointer select-none items-center gap-1.5 rounded-[7px] px-1.5 py-1 text-xs text-text-muted hover:text-text">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-accent"
              checked={alsoSend}
              onChange={(event) => {
                setAlsoSend(event.target.checked);
              }}
            />
            Also send to channel
          </label>
        }
      />
    </aside>
  );
}
