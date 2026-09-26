import { Avatar, userAvatarSeed } from "@aulora/avatars";
import type { AttachmentDescriptor, MessagePayload, ReactionRow } from "@aulora/core";
import { gridDays, hasPermission, Permission } from "@aulora/core";
import { IconButton, Text } from "@aulora/ui-web";
import { useEffect, useState } from "react";
import type { ChatRuntime } from "../../lib/chat-runtime";
import { AttachmentView } from "./AttachmentView";
import { ReactionChips, type ReactionGroup } from "./ReactionChips";

export interface MessageListProps {
  readonly runtime: ChatRuntime | undefined;
  readonly channelId: string;
  readonly messages: readonly MessagePayload[];
  readonly decrypted: ReadonlyMap<string, string>;
  readonly attachments: ReadonlyMap<string, readonly AttachmentDescriptor[]>;
  readonly pendingIds: ReadonlySet<string>;
  readonly permissions: bigint;
  readonly ownUserId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  /** Highest-position role color per user id, for rings and tinted names. */
  readonly memberColors?: ReadonlyMap<string, string>;
  readonly firstUnreadId: string | null;
  readonly onReply: (message: MessagePayload) => void;
  readonly onEdit: (message: MessagePayload, text: string) => void;
  readonly onDelete: (message: MessagePayload) => void;
  readonly onPinToggle: (message: MessagePayload) => void;
  readonly onReact: (message: MessagePayload, emoji: string) => void;
  readonly onJumpToFirstUnread: () => void;
}

const QUICK_REACTIONS = ["👍", "🎉", "👀", "❤️"] as const;

/** Flat, realtime, decrypted message list with day separators. */
export function MessageList({
  runtime,
  channelId,
  messages,
  decrypted,
  attachments,
  pendingIds,
  permissions,
  ownUserId,
  memberNames,
  memberColors,
  firstUnreadId,
  onReply,
  onEdit,
  onDelete,
  onPinToggle,
  onReact,
  onJumpToFirstUnread,
}: MessageListProps) {
  const days = gridDays(messages);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3"
      data-testid="message-list"
      data-channel={channelId}
    >
      {firstUnreadId !== null && (
        <button
          type="button"
          onClick={onJumpToFirstUnread}
          className="self-start rounded-pill bg-accent-soft px-3 py-1 text-xs font-medium text-accent"
        >
          Jump to first unread
        </button>
      )}
      {days.map(([day, dayMessages]) => (
        <section key={day} className="flex flex-col gap-1">
          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-border" />
            <Text size="xs" tone="muted" mono>
              {new Date(day).toDateString()}
            </Text>
            <span className="h-px flex-1 bg-border" />
          </div>
          {dayMessages.map((message) => (
            <MessageRow
              key={message.id}
              runtime={runtime}
              channelId={channelId}
              message={message}
              text={decrypted.get(message.id)}
              attachments={attachments.get(message.id) ?? []}
              pending={pendingIds.has(message.id)}
              permissions={permissions}
              ownUserId={ownUserId}
              authorName={memberNames.get(message.authorId) ?? message.authorId}
              authorColor={memberColors?.get(message.authorId)}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onPinToggle={onPinToggle}
              onReact={onReact}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function MessageRow({
  runtime,
  channelId,
  message,
  text,
  attachments,
  pending,
  permissions,
  ownUserId,
  authorName,
  authorColor,
  onReply,
  onEdit,
  onDelete,
  onPinToggle,
  onReact,
}: {
  runtime: ChatRuntime | undefined;
  channelId: string;
  message: MessagePayload;
  text: string | undefined;
  attachments: readonly AttachmentDescriptor[];
  pending: boolean;
  permissions: bigint;
  ownUserId: string;
  authorName: string;
  authorColor: string | undefined;
  onReply(message: MessagePayload): void;
  onEdit(message: MessagePayload, text: string): void;
  onDelete(message: MessagePayload): void;
  onPinToggle(message: MessagePayload): void;
  onReact(message: MessagePayload, emoji: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  const [reactions, setReactions] = useState<readonly ReactionGroup[]>([]);
  const canEdit =
    message.authorId === ownUserId || hasPermission(permissions, Permission.ManageMessages);
  const canDelete =
    message.authorId === ownUserId || hasPermission(permissions, Permission.ManageMessages);
  const canPin = hasPermission(permissions, Permission.PinMessages);
  const canReact = hasPermission(permissions, Permission.AddReactions);
  void canPin;

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-subscribe only when the message/runtime changes
  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    let cancelled = false;
    const off = runtime.subscriptions.watchReactions(message.id, (rows: readonly ReactionRow[]) => {
      void runtime.session.loadReactions(channelId, message.id, rows).then((resolved) => {
        if (!cancelled) {
          setReactions(groupReactions(resolved, ownUserId));
        }
      });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [runtime, message.id, ownUserId]);

  if (message.deletedAt !== null) {
    return (
      <div className="rounded-input bg-surface-2/50 px-3 py-2">
        <Text size="sm" tone="muted" className="italic">
          This message was deleted.
        </Text>
      </div>
    );
  }

  return (
    <article
      id={`message-${message.id}`}
      className="group relative flex gap-3 rounded-input px-3 py-1.5 hover:bg-surface-2"
      data-testid={`message-${message.id}`}
    >
      <Avatar
        seed={userAvatarSeed(message.authorId)}
        size={32}
        {...(authorColor !== undefined && authorColor.length > 0 ? { roleColor: authorColor } : {})}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Text
            size="sm"
            className="font-medium"
            style={authorColor !== undefined ? { color: authorColor } : undefined}
          >
            {authorName}
          </Text>
          <Text size="xs" tone="muted" mono>
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          {message.editedAt !== null && (
            <Text size="xs" tone="muted" mono>
              (edited)
            </Text>
          )}
          {message.pinnedAt !== null && (
            <Text size="xs" tone="accent" mono>
              pinned
            </Text>
          )}
        </div>
        {editing ? (
          <form
            className="flex flex-col gap-2 py-1"
            onSubmit={(event) => {
              event.preventDefault();
              onEdit(message, draft);
              setEditing(false);
            }}
          >
            <textarea
              className="min-h-[60px] rounded-input border border-border bg-surface-3 p-2 text-sm text-text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="flex gap-2">
              <button type="submit" className="rounded-pill bg-accent px-3 py-1 text-xs text-bg">
                Save
              </button>
              <button
                type="button"
                className="rounded-pill px-3 py-1 text-xs text-text-muted"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <MessageBody text={text} />
        )}
        {attachments.length > 0 && (
          <div className="mt-1 flex flex-col gap-1">
            {attachments.map((attachment) => (
              <AttachmentView key={attachment.fileId} runtime={runtime} descriptor={attachment} />
            ))}
          </div>
        )}
        {pending && (
          <Text size="xs" tone="muted" data-testid={`pending-${message.id}`}>
            Sending…
          </Text>
        )}
        {reactions.length > 0 && (
          <ReactionChips groups={reactions} onToggle={(emoji) => onReact(message, emoji)} />
        )}
      </div>

      {!pending && (
        <div className="absolute right-3 -top-3 hidden items-center gap-1 rounded-pill border border-border bg-surface-3 p-1 group-hover:flex">
          {canReact &&
            QUICK_REACTIONS.map((emoji) => (
              <IconButton
                key={emoji}
                size="sm"
                label={`React ${emoji}`}
                onClick={() => onReact(message, emoji)}
              >
                <span aria-hidden="true">{emoji}</span>
              </IconButton>
            ))}
          <IconButton size="sm" label="Reply in thread" onClick={() => onReply(message)}>
            <span aria-hidden="true">↩</span>
          </IconButton>
          {canEdit && (
            <IconButton
              size="sm"
              label="Edit message"
              onClick={() => {
                setDraft(text ?? "");
                setEditing(true);
              }}
            >
              <span aria-hidden="true">✎</span>
            </IconButton>
          )}
          {canEdit && (
            <IconButton
              size="sm"
              label={message.pinnedAt ? "Unpin" : "Pin"}
              onClick={() => onPinToggle(message)}
            >
              <span aria-hidden="true">📌</span>
            </IconButton>
          )}
          {canDelete && (
            <IconButton size="sm" label="Delete message" onClick={() => onDelete(message)}>
              <span aria-hidden="true">🗑</span>
            </IconButton>
          )}
        </div>
      )}
    </article>
  );
}

function MessageBody({ text }: { readonly text: string | undefined }) {
  if (text === undefined) {
    return (
      <Text size="sm" tone="muted" className="italic">
        Unable to decrypt this message.
      </Text>
    );
  }
  const segments = splitCodeBlocks(text);
  return (
    <div className="flex flex-col gap-1">
      {segments.map((segment, index) => {
        const key = `${segment.code ? "code" : "text"}:${index}`;
        return segment.code ? (
          <pre
            key={key}
            className="overflow-x-auto rounded-input bg-surface-3 p-2 font-mono text-xs text-text"
          >
            {segment.value}
          </pre>
        ) : (
          <Text key={key} size="sm" className="whitespace-pre-wrap break-words">
            {segment.value}
          </Text>
        );
      })}
    </div>
  );
}

function splitCodeBlocks(text: string): { value: string; code: boolean }[] {
  const parts: { value: string; code: boolean }[] = [];
  const pattern = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ value: text.slice(lastIndex, index), code: false });
    }
    parts.push({ value: (match[1] ?? "").replace(/^\n/, ""), code: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ value: text.slice(lastIndex), code: false });
  }
  return parts.length > 0 ? parts : [{ value: text, code: false }];
}

function groupReactions(
  reactions: readonly { userId: string; emoji: string }[],
  ownUserId: string,
): ReactionGroup[] {
  const groups = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const reaction of reactions) {
    const group = groups.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false };
    group.count += 1;
    group.mine = group.mine || reaction.userId === ownUserId;
    groups.set(reaction.emoji, group);
  }
  return [...groups.values()];
}
