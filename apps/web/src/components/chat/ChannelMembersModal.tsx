import { cn, Icon, Modal } from "@aulora/ui-web";
import { useMemo, useState } from "react";
import { PresenceAvatar, type PresenceStatus } from "./PresenceAvatar";

export interface ChannelMembersModalProps {
  readonly open: boolean;
  readonly channelName: string;
  readonly isPrivate: boolean;
  readonly members: readonly { readonly userId: string; readonly displayName: string }[];
  /** User ids currently in the channel (private channels only). */
  readonly memberIds?: readonly string[];
  readonly ownUserId: string;
  readonly presenceOf: (_userId: string) => PresenceStatus;
  readonly canManage: boolean;
  readonly onAdd?: (_userId: string) => void;
  readonly onRemove?: (_userId: string) => void;
  readonly onClose: () => void;
}

/**
 * Channel membership for a private channel: who is in it, and a searchable list
 * to add or remove people. For public channels it is informational only, since
 * access is governed by roles.
 */
export function ChannelMembersModal({
  open,
  channelName,
  isPrivate,
  members,
  memberIds = [],
  ownUserId,
  presenceOf,
  canManage,
  onAdd,
  onRemove,
  onClose,
}: ChannelMembersModalProps) {
  const [query, setQuery] = useState("");
  const inChannel = useMemo(() => new Set(memberIds), [memberIds]);

  const visible = members
    .filter((member) => member.displayName.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => {
      const aIn = inChannel.has(a.userId);
      const bIn = inChannel.has(b.userId);
      return aIn === bIn ? a.displayName.localeCompare(b.displayName) : aIn ? -1 : 1;
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={`${channelName} members`}
      title={isPrivate ? "Private channel members" : "Channel access"}
      description={
        isPrivate
          ? "Only the people listed here can see this channel."
          : "Anyone with the View channel permission can join this channel."
      }
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
          <Icon name={isPrivate ? "lock" : "users"} size={17} />
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {isPrivate && canManage && (
          <div className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-3 px-3 focus-within:border-accent">
            <Icon name="search" size={15} className="text-text-muted" />
            <input
              aria-label="Find people"
              placeholder="Add people…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              className="h-9 flex-1 bg-transparent text-[13px] text-text placeholder:text-text-muted focus-visible:outline-none"
            />
          </div>
        )}

        <ul className="stagger flex max-h-[min(46vh,340px)] flex-col overflow-y-auto">
          {visible.map((member) => {
            const inRoom = inChannel.has(member.userId);
            const self = member.userId === ownUserId;
            return (
              <li
                key={member.userId}
                className="flex items-center gap-3 rounded-[8px] px-2.5 py-1.5"
              >
                <PresenceAvatar
                  userId={member.userId}
                  size={30}
                  status={presenceOf(member.userId)}
                  ringClassName="ring-surface-2"
                />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
                  {member.displayName}
                  {self ? " (you)" : ""}
                </span>
                {isPrivate && canManage && (
                  <button
                    type="button"
                    disabled={self && inRoom}
                    onClick={() => (inRoom ? onRemove?.(member.userId) : onAdd?.(member.userId))}
                    className={cn(
                      "h-7 rounded-[7px] px-2.5 text-[12px] font-medium transition disabled:opacity-40",
                      inRoom
                        ? "border border-border text-text-muted hover:border-danger/40 hover:text-danger"
                        : "bg-accent text-on-accent hover:brightness-110",
                    )}
                  >
                    {inRoom ? "Remove" : "Add"}
                  </button>
                )}
                {(!isPrivate || !canManage) && inRoom && (
                  <span className="text-[11px] text-text-muted">In channel</span>
                )}
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-text-muted">
              No one matches that name.
            </li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
