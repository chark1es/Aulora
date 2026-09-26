import { Avatar, userAvatarSeed } from "@aulora/avatars";
import { EVERYONE_ROLE_ID } from "@aulora/core";
import { Button, Heading, Input, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  canManageRoleUi,
  canModerateUi,
  type MemberView,
  memberDisplayName,
  type RoleView,
  roleColorFor,
  roleRef,
} from "../../lib/workspace-admin";

export interface MemberManagerViewer {
  readonly userId: string;
  readonly isOwner: boolean;
  readonly roleIds: readonly string[];
  readonly topPosition: number;
}

export interface MemberManagerProps {
  readonly viewer: MemberManagerViewer;
  readonly ownerId: string | null;
  readonly permissions: {
    readonly manageRoles: boolean;
    readonly kick: boolean;
    readonly ban: boolean;
    readonly timeout: boolean;
    readonly manageNicknames: boolean;
    readonly changeOwnNickname: boolean;
  };
}

const TIMEOUTS: readonly { readonly label: string; readonly ms: number }[] = [
  { label: "60s", ms: 60_000 },
  { label: "5m", ms: 5 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
  { label: "1d", ms: 24 * 60 * 60_000 },
];

const ANY_MANAGE = (p: MemberManagerProps["permissions"]): boolean =>
  p.manageRoles || p.kick || p.ban || p.timeout || p.manageNicknames;

/**
 * Member administration: role assignment, nicknames, timeouts, kick/ban and the
 * ban list. Controls are hidden by effective permissions + hierarchy; the
 * server enforces the same rules and any rejection shows inline.
 */
export function MemberManager({ viewer, ownerId, permissions }: MemberManagerProps) {
  const members = useQuery(api.members.list, {});
  const roles = useQuery(api.roles.list, {});
  const bans = useQuery(api.members.listBans, permissions.ban ? {} : "skip");

  const assignRole = useMutation(api.members.assignRole);
  const removeRole = useMutation(api.members.removeRole);
  const setNickname = useMutation(api.members.setNickname);
  const timeout = useMutation(api.members.timeout);
  const kick = useMutation(api.members.kick);
  const ban = useMutation(api.members.ban);
  const unban = useMutation(api.members.unban);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ANY_MANAGE(permissions)) {
    return (
      <Text tone="muted" size="sm" data-testid="member-manager-locked">
        You do not have permission to manage members.
      </Text>
    );
  }

  const roleList = roles ?? [];
  const memberList = members ?? [];

  async function run(task: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  function canModerate(target: MemberView): boolean {
    return canModerateUi({
      viewer: { userId: viewer.userId, isOwner: viewer.isOwner, roleIds: viewer.roleIds },
      target: {
        userId: target.userId,
        isOwner: target.userId === ownerId,
        roleIds: target.roleIds,
      },
      roles: roleList,
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="member-manager">
      <Heading level={3}>Members</Heading>
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      <ul className="flex flex-col gap-2">
        {memberList.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            roles={roleList}
            viewer={viewer}
            ownerId={ownerId}
            permissions={permissions}
            moderatable={canModerate(member)}
            busy={busy}
            onAssignRole={(roleId) =>
              run(() => assignRole({ userId: member.userId, roleId: roleId as never }))
            }
            onRemoveRole={(roleId) =>
              run(() => removeRole({ userId: member.userId, roleId: roleId as never }))
            }
            onNickname={(nickname) =>
              run(() =>
                setNickname({
                  userId: member.userId,
                  ...(nickname.length > 0 ? { nickname } : {}),
                }),
              )
            }
            onTimeout={(until) =>
              run(() =>
                until === undefined
                  ? timeout({ userId: member.userId })
                  : timeout({ userId: member.userId, until }),
              )
            }
            onKick={() => run(() => kick({ userId: member.userId }))}
            onBan={() => run(() => ban({ userId: member.userId }))}
          />
        ))}
      </ul>

      {permissions.ban && (
        <section className="flex flex-col gap-2" data-testid="ban-list">
          <Heading level={3}>Bans</Heading>
          {(bans ?? []).length === 0 ? (
            <Text tone="muted" size="sm">
              No banned members.
            </Text>
          ) : (
            <ul className="flex flex-col gap-1">
              {(bans ?? []).map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-input border border-border bg-surface-2 px-3 py-2"
                >
                  <Text size="sm" mono>
                    {entry.userId}
                    {entry.reason !== null ? ` · ${entry.reason}` : ""}
                  </Text>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => unban({ userId: entry.userId }))}
                  >
                    Unban
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

interface MemberRowProps {
  readonly member: MemberView;
  readonly roles: readonly RoleView[];
  readonly viewer: MemberManagerViewer;
  readonly ownerId: string | null;
  readonly permissions: MemberManagerProps["permissions"];
  readonly moderatable: boolean;
  readonly busy: boolean;
  onAssignRole(roleId: string): void;
  onRemoveRole(roleId: string): void;
  onNickname(nickname: string): void;
  onTimeout(until: number | undefined): void;
  onKick(): void;
  onBan(): void;
}

function MemberRow({
  member,
  roles,
  viewer,
  ownerId,
  permissions,
  moderatable,
  busy,
  onAssignRole,
  onRemoveRole,
  onNickname,
  onTimeout,
  onKick,
  onBan,
}: MemberRowProps) {
  const [nickname, setNickname] = useState(member.nickname ?? "");
  const [roleToAdd, setRoleToAdd] = useState("");

  const isSelf = member.userId === viewer.userId;
  const displayName = memberDisplayName(member, member.userId);
  const color = roleColorFor(member, roles);
  const heldRefs = new Set(member.roleIds);

  const canEditNickname = isSelf
    ? permissions.changeOwnNickname || permissions.manageNicknames || viewer.isOwner
    : permissions.manageNicknames && moderatable;
  const canAssignRoles = permissions.manageRoles && moderatable;
  const canTimeout = permissions.timeout && moderatable;
  const canKick = permissions.kick && moderatable;
  const canBan = permissions.ban && moderatable && !isSelf;

  const assignable = roles.filter(
    (role) =>
      canManageRoleUi(viewer, role) &&
      !role.isEveryone &&
      !heldRefs.has(roleRef(role)) &&
      (viewer.isOwner || roleRef(role) !== EVERYONE_ROLE_ID),
  );

  return (
    <li
      className="flex flex-col gap-3 rounded-card border border-border bg-surface-2 p-3"
      data-testid={`member-row-${member.userId}`}
    >
      <div className="flex items-center gap-3">
        <Avatar
          seed={userAvatarSeed(member.userId)}
          size={32}
          {...(color !== null && color.length > 0 ? { roleColor: color } : {})}
        />
        <div className="min-w-0 flex-1">
          <Text
            size="sm"
            className="truncate font-medium"
            style={color !== null ? { color } : undefined}
          >
            {displayName}
            {member.userId === ownerId ? " · owner" : ""}
            {member.timeoutUntil !== null && member.timeoutUntil > Date.now() ? " · timed out" : ""}
          </Text>
          <Text size="xs" tone="muted" mono className="truncate">
            {member.userId}
          </Text>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {member.roleIds.map((ref) => {
          const role = roles.find((entry) => roleRef(entry) === ref);
          const label = role?.name ?? ref;
          if (ref === EVERYONE_ROLE_ID) {
            return (
              <span
                key={ref}
                className="rounded-pill border border-border bg-surface-3 px-2 py-0.5 text-xs text-text-muted"
              >
                {label}
              </span>
            );
          }
          return (
            <span
              key={ref}
              className="inline-flex items-center gap-1 rounded-pill border border-border bg-surface-3 px-2 py-0.5 text-xs"
              style={
                role?.color !== null && role?.color !== undefined
                  ? { color: role.color }
                  : undefined
              }
            >
              {label}
              {canAssignRoles && role !== undefined && (
                <button
                  type="button"
                  aria-label={`Remove role ${label}`}
                  className="text-text-muted hover:text-danger"
                  disabled={busy}
                  onClick={() => onRemoveRole(role.id)}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>

      {canAssignRoles && assignable.length > 0 && (
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Add role
            <select
              aria-label={`Add role to ${displayName}`}
              className="h-8 rounded-input border border-border bg-surface-3 px-2 text-sm text-text"
              value={roleToAdd}
              onChange={(event) => setRoleToAdd(event.currentTarget.value)}
            >
              <option value="">Select a role…</option>
              {assignable.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            disabled={busy || roleToAdd.length === 0}
            onClick={() => {
              onAssignRole(roleToAdd);
              setRoleToAdd("");
            }}
          >
            Add
          </Button>
        </div>
      )}

      {canEditNickname && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Nickname"
              value={nickname}
              onChange={(event) => setNickname(event.currentTarget.value)}
            />
          </div>
          <Button size="sm" disabled={busy} onClick={() => onNickname(nickname.trim())}>
            Save
          </Button>
        </div>
      )}

      {(canTimeout || canKick || canBan) && (
        <div className="flex flex-wrap items-center gap-2">
          {canTimeout &&
            (member.timeoutUntil !== null && member.timeoutUntil > Date.now() ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => onTimeout(undefined)}
              >
                Clear timeout
              </Button>
            ) : (
              TIMEOUTS.map((duration) => (
                <Button
                  key={duration.label}
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onTimeout(Date.now() + duration.ms)}
                >
                  Timeout {duration.label}
                </Button>
              ))
            ))}
          {canKick && (
            <Button size="sm" variant="danger" disabled={busy} onClick={onKick}>
              Kick
            </Button>
          )}
          {canBan && (
            <Button size="sm" variant="danger" disabled={busy} onClick={onBan}>
              Ban
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
