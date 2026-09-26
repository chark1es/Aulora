import { Avatar, userAvatarSeed } from "@aulora/avatars";
import type { PresenceRow } from "@aulora/core";
import { cn, Text } from "@aulora/ui-web";

export interface MemberEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly roleIds?: readonly string[];
  readonly isOwner?: boolean;
}

export interface MembersPanelProps {
  readonly members: readonly MemberEntry[];
  readonly presence: readonly PresenceRow[];
  readonly customStatuses: ReadonlyMap<string, string>;
  readonly onSetStatus: (status: "online" | "idle" | "dnd" | "offline") => void;
}

const STATUS_COLOR: Record<PresenceRow["status"], string> = {
  online: "bg-secondary",
  idle: "bg-accent",
  dnd: "bg-danger",
  offline: "bg-text-muted",
};

/** Member list with presence dots and custom status. */
export function MembersPanel({
  members,
  presence,
  customStatuses,
  onSetStatus,
}: MembersPanelProps) {
  const presenceByUser = new Map(presence.map((row) => [row.userId, row]));
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-3 border-l border-border bg-surface-1 p-3">
      <div className="flex items-center justify-between">
        <Text size="xs" tone="muted" mono>
          MEMBERS
        </Text>
        <select
          aria-label="Set your status"
          className="rounded-pill border border-border bg-surface-3 px-2 py-0.5 text-xs text-text"
          defaultValue="online"
          onChange={(event) =>
            onSetStatus(event.target.value as "online" | "idle" | "dnd" | "offline")
          }
        >
          <option value="online">Online</option>
          <option value="idle">Idle</option>
          <option value="dnd">Do not disturb</option>
          <option value="offline">Invisible</option>
        </select>
      </div>
      <ul className="flex flex-col gap-1">
        {members.map((member) => {
          const status = presenceByUser.get(member.userId)?.status ?? "offline";
          const custom = customStatuses.get(member.userId);
          return (
            <li key={member.userId} className="flex items-center gap-2 rounded-pill px-1 py-0.5">
              <span className="relative">
                <Avatar seed={userAvatarSeed(member.userId)} size={24} />
                <span
                  role="status"
                  aria-label={status}
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-pill border-2 border-surface-1",
                    STATUS_COLOR[status],
                  )}
                />
              </span>
              <span className="min-w-0 flex-1">
                <Text size="sm" className="truncate">
                  {member.displayName}
                  {member.isOwner ? " · owner" : ""}
                </Text>
                {custom !== undefined && (
                  <Text size="xs" tone="muted" className="truncate">
                    {custom}
                  </Text>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
