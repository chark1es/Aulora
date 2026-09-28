import type { PresenceRow } from "@aulora/core";
import { type ContextMenuItem, cn, Icon, useContextMenu } from "@aulora/ui-web";
import { useMemo } from "react";
import { PresenceAvatar } from "./PresenceAvatar";

export interface MemberEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly roleIds?: readonly string[];
  /** Role names held, highest first, for the role pills. */
  readonly roleNames?: readonly string[];
  readonly isOwner?: boolean;
  /** Highest-position role color; tints the ring and the username. */
  readonly roleColor?: string | null;
}

export interface MembersPanelProps {
  readonly members: readonly MemberEntry[];
  readonly presence: readonly PresenceRow[];
  readonly customStatuses: ReadonlyMap<string, string>;
  readonly ownUserId: string;
  readonly onMessage: (userId: string) => void;
  readonly onClose: () => void;
  /** Optional member actions surfaced in the right-click menu. */
  readonly memberActions?: {
    readonly message?: (userId: string) => void;
    readonly assignRoles?: (userId: string) => void;
    readonly kick?: (userId: string) => void;
    readonly ban?: (userId: string) => void;
  };
}

/**
 * The member list, split into who is around and who is offline. Clicking a
 * member opens a direct message with them.
 */
export function MembersPanel({
  members,
  presence,
  customStatuses,
  ownUserId,
  onMessage,
  onClose,
  memberActions,
}: MembersPanelProps) {
  const byUser = useMemo(() => new Map(presence.map((row) => [row.userId, row])), [presence]);
  const sorted = useMemo(
    () => [...members].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [members],
  );
  const statusOf = (userId: string) => byUser.get(userId)?.status ?? "offline";
  const active = sorted.filter((member) => statusOf(member.userId) !== "offline");
  const offline = sorted.filter((member) => statusOf(member.userId) === "offline");
  const openMenu = useContextMenu();

  const memberMenu = (member: MemberEntry, event: React.MouseEvent) => {
    if (member.userId === ownUserId) {
      return;
    }
    event.preventDefault();
    const items: ContextMenuItem[] = [];
    items.push({
      id: "message",
      label: "Send message",
      icon: <Icon name="message" size={14} />,
      onSelect: () => (memberActions?.message ?? onMessage)(member.userId),
    });
    if (memberActions?.assignRoles !== undefined) {
      items.push({
        id: "roles",
        label: "Edit roles…",
        icon: <Icon name="shield" size={14} />,
        separatorBefore: true,
        onSelect: () => memberActions.assignRoles?.(member.userId),
      });
    }
    if (memberActions?.kick !== undefined) {
      items.push({
        id: "kick",
        label: "Kick from workspace",
        icon: <Icon name="logout" size={14} />,
        danger: true,
        separatorBefore: true,
        onSelect: () => memberActions.kick?.(member.userId),
      });
    }
    if (memberActions?.ban !== undefined) {
      items.push({
        id: "ban",
        label: "Ban from workspace",
        icon: <Icon name="x" size={14} />,
        danger: true,
        onSelect: () => memberActions.ban?.(member.userId),
      });
    }
    openMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      items,
      label: member.displayName,
    });
  };

  return (
    <aside
      aria-label="Members"
      className="pane flex h-full w-[264px] shrink-0 animate-slide-in-right flex-col border-l border-border"
    >
      <header className="material-chrome flex h-[52px] shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-text">Members</h2>
          <p className="text-[11px] text-text-muted">
            {active.length} online · {members.length} total
          </p>
        </div>
        <button
          type="button"
          aria-label="Close members"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-text-muted hover:bg-surface-3 hover:text-text"
        >
          <Icon name="x" size={18} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <MemberGroup
          title="Online"
          members={active}
          statusOf={statusOf}
          customStatuses={customStatuses}
          ownUserId={ownUserId}
          onMessage={onMessage}
          onContextMenu={memberMenu}
        />
        <MemberGroup
          title="Offline"
          members={offline}
          statusOf={statusOf}
          customStatuses={customStatuses}
          ownUserId={ownUserId}
          onMessage={onMessage}
          onContextMenu={memberMenu}
          dim
        />
      </div>
    </aside>
  );
}

function MemberGroup({
  title,
  members,
  statusOf,
  customStatuses,
  ownUserId,
  onMessage,
  onContextMenu,
  dim = false,
}: {
  readonly title: string;
  readonly members: readonly MemberEntry[];
  readonly statusOf: (userId: string) => PresenceRow["status"];
  readonly customStatuses: ReadonlyMap<string, string>;
  readonly ownUserId: string;
  readonly onMessage: (userId: string) => void;
  readonly onContextMenu: (member: MemberEntry, event: React.MouseEvent) => void;
  readonly dim?: boolean;
}) {
  if (members.length === 0) {
    return null;
  }
  return (
    <section className="mb-4">
      <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        {title} — {members.length}
      </h3>
      <ul className="stagger flex flex-col gap-px">
        {members.map((member) => {
          const custom = customStatuses.get(member.userId);
          const self = member.userId === ownUserId;
          return (
            <li key={member.userId}>
              <button
                type="button"
                data-testid={`presence-row-${member.userId}`}
                disabled={self}
                onClick={() => onMessage(member.userId)}
                onContextMenu={(event) => onContextMenu(member, event)}
                title={self ? undefined : `Message ${member.displayName}`}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition enabled:hover:bg-surface-3",
                  dim && "opacity-60 hover:opacity-100",
                )}
              >
                <PresenceAvatar
                  userId={member.userId}
                  size={30}
                  status={statusOf(member.userId)}
                  roleColor={member.roleColor}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="truncate text-[13px] font-medium text-text"
                      style={
                        member.roleColor !== null && member.roleColor !== undefined
                          ? { color: member.roleColor }
                          : undefined
                      }
                    >
                      {member.displayName}
                      {self ? " (you)" : ""}
                    </span>
                    {member.isOwner === true && (
                      <span className="rounded-[5px] bg-accent-soft px-1 text-[10px] font-semibold uppercase text-accent">
                        Owner
                      </span>
                    )}
                  </span>
                  {member.roleNames !== undefined && member.roleNames.length > 0 && (
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {member.roleNames.slice(0, 2).map((roleName) => (
                        <span
                          key={roleName}
                          className="rounded-[4px] border border-border bg-surface-2 px-1 text-[10px] font-medium text-text-muted"
                        >
                          {roleName}
                        </span>
                      ))}
                    </span>
                  )}
                  {custom !== undefined && (
                    <span className="block truncate text-[11px] text-text-muted">{custom}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
