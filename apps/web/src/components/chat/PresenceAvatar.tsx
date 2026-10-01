import type { PresenceRow } from "@aulora/core";
import { cn } from "@aulora/ui-web";
import { PersonAvatar } from "./member-avatars";

export type PresenceStatus = PresenceRow["status"];

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Offline",
};

const DOT_CLASS: Record<PresenceStatus, string> = {
  online: "bg-secondary",
  idle: "bg-idle",
  dnd: "bg-danger",
  offline: "bg-text-muted/60",
};

/** A person's avatar with an optional presence dot in the bottom-right corner. */
export function PresenceAvatar({
  userId,
  size = 36,
  status,
  roleColor,
  ringClassName = "ring-surface-1",
}: {
  readonly userId: string;
  readonly size?: number;
  readonly status?: PresenceStatus | undefined;
  readonly roleColor?: string | null | undefined;
  /** Matches the surface behind the avatar so the dot looks cut out. */
  readonly ringClassName?: string;
}) {
  const dot = Math.max(8, Math.round(size * 0.28));
  return (
    <span className="relative inline-flex shrink-0">
      <PersonAvatar userId={userId} size={size} roleColor={roleColor} />
      {status !== undefined && (
        <span
          role="img"
          aria-label={PRESENCE_LABEL[status]}
          className={cn(
            "absolute bottom-0 right-0 rounded-full ring-2",
            DOT_CLASS[status],
            ringClassName,
          )}
          style={{ width: dot, height: dot }}
        />
      )}
    </span>
  );
}

/** Two overlapping avatars for a group conversation. */
export function GroupAvatar({
  userIds,
  size = 36,
}: {
  readonly userIds: readonly string[];
  readonly size?: number;
}) {
  const inner = Math.round(size * 0.72);
  const [first, second] = userIds;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {first !== undefined && (
        <span className="absolute left-0 top-0">
          <PersonAvatar userId={first} size={inner} />
        </span>
      )}
      {second !== undefined && (
        <span className="absolute -bottom-0.5 -right-0.5 flex rounded-full bg-surface-1 p-0.5">
          <PersonAvatar userId={second} size={inner} />
        </span>
      )}
    </span>
  );
}
