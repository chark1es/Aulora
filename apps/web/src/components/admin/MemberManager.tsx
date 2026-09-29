import { Avatar, userAvatarSeed } from "@aulora/avatars";
import { EVERYONE_ROLE_ID } from "@aulora/core";
import { Button, Heading, Icon, Input, Modal, Spinner, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  canManageRoleUi,
  canModerateUi,
  type MemberView,
  memberDisplayName,
  type RoleView,
  roleColorFor,
  roleNamesFor,
  roleRef,
} from "../../lib/workspace-admin";
import { Combobox, type ComboboxOption } from "./Combobox";

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

/** Ban durations; `null` means permanent. */
const BAN_DURATIONS: readonly { readonly label: string; readonly ms: number | null }[] = [
  { label: "60 seconds", ms: 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "1 day", ms: 24 * 60 * 60_000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60_000 },
  { label: "30 days", ms: 30 * 24 * 60 * 60_000 },
  { label: "Permanent", ms: null },
];

const ANY_MANAGE = (p: MemberManagerProps["permissions"]): boolean =>
  p.manageRoles || p.kick || p.ban || p.timeout || p.manageNicknames;

/**
 * Member administration: a compact member index whose rows pop a focused
 * dialog open, plus the ban list as its own pop-out. Controls are hidden by
 * effective permissions + hierarchy; the server enforces the same rules and any
 * rejection shows inline.
 */
export function MemberManager({ viewer, ownerId, permissions }: MemberManagerProps) {
  const members = useQuery(api.members.list, {});
  const roles = useQuery(api.roles.list, {});
  const bans = useQuery(api.members.listBans, permissions.ban ? {} : "skip");
  const notes = useQuery(api.notes.list, {});

  const assignRole = useMutation(api.members.assignRole);
  const removeRole = useMutation(api.members.removeRole);
  const setNickname = useMutation(api.members.setNickname);
  const timeout = useMutation(api.members.timeout);
  const kick = useMutation(api.members.kick);
  const ban = useMutation(api.members.ban);
  const unban = useMutation(api.members.unban);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const [bansOpen, setBansOpen] = useState(false);

  if (!ANY_MANAGE(permissions)) {
    return (
      <div data-testid="member-manager">
        <Text tone="muted" size="sm" data-testid="member-manager-locked">
          You do not have permission to manage members.
        </Text>
      </div>
    );
  }

  const roleList = roles ?? [];
  const memberList = members ?? [];
  const selected = memberList.find((entry) => entry.userId === selectedId) ?? null;
  const notedUserIds = new Set(
    (notes ?? [])
      .filter((entry) => entry.body.trim().length > 0)
      .map((entry) => entry.targetUserId),
  );

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
      <header className="flex flex-col gap-1">
        <Heading level={3}>Members</Heading>
        <Text size="sm" tone="muted">
          Pick a member to moderate in a focused panel, or review the ban list.
        </Text>
      </header>

      {error !== null && !memberOpen && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}

      {members === undefined && (
        <div className="flex justify-center py-8">
          <Spinner size={22} label="Loading members" />
        </div>
      )}

      {members !== undefined && memberList.length === 0 && (
        <Text tone="muted" size="sm">
          No members yet.
        </Text>
      )}

      {members !== undefined && (
        <ul className="flex flex-col gap-2">
          {memberList.map((member) => {
            const displayName = memberDisplayName(member, member.userId);
            const color = roleColorFor(member, roleList);
            const names = roleNamesFor(member, roleList);
            return (
              <li key={member.userId}>
                <button
                  type="button"
                  data-testid={`member-row-${member.userId}`}
                  onClick={() => {
                    setSelectedId(member.userId);
                    setError(null);
                    setMemberOpen(true);
                  }}
                  className="flex w-full items-center gap-3 rounded-[12px] border border-border bg-surface-2 p-3 text-left transition hover:border-text-muted/30 hover:bg-surface-3/60"
                >
                  <Avatar
                    seed={userAvatarSeed(member.userId)}
                    size={34}
                    {...(color !== null && color.length > 0 ? { roleColor: color } : {})}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <Text
                        as="span"
                        size="sm"
                        className="truncate font-medium"
                        style={color !== null ? { color } : undefined}
                      >
                        {displayName}
                      </Text>
                      {member.userId === ownerId && (
                        <span className="rounded-[5px] bg-accent-soft px-1 text-[10px] font-semibold uppercase text-accent">
                          Owner
                        </span>
                      )}
                      {notedUserIds.has(member.userId) && (
                        <Icon name="note" size={12} className="shrink-0 text-text-muted" />
                      )}
                    </span>
                    <Text as="span" size="xs" tone="muted" className="block truncate">
                      {names.length === 0 ? "No roles" : names.join(", ")}
                    </Text>
                  </span>
                  <Icon
                    name="chevron-right"
                    size={14}
                    className="shrink-0 text-text-muted/50"
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {permissions.ban && (
        <button
          type="button"
          onClick={() => setBansOpen(true)}
          className="group flex items-center gap-1.5 self-start rounded-[8px] px-2 py-1 text-[12px] font-medium text-text-muted transition hover:bg-surface-2 hover:text-text"
        >
          <Icon name="lock" size={13} />
          Banned members ({(bans ?? []).length})
          <Icon name="chevron-right" size={13} className="transition group-hover:translate-x-0.5" />
        </button>
      )}

      {selected !== null && (
        <Modal
          open={memberOpen}
          onClose={() => setMemberOpen(false)}
          size="md"
          label="Member"
          title={memberDisplayName(selected, selected.userId)}
          description={
            roleNamesFor(selected, roleList).length === 0
              ? "No roles"
              : roleNamesFor(selected, roleList).join(", ")
          }
          icon={<Avatar seed={userAvatarSeed(selected.userId)} size={36} />}
          footer={
            <Button variant="secondary" onClick={() => setMemberOpen(false)}>
              Done
            </Button>
          }
        >
          <MemberDetail
            key={selected.userId}
            member={selected}
            roles={roleList}
            viewer={viewer}
            ownerId={ownerId}
            permissions={permissions}
            moderatable={canModerate(selected)}
            busy={busy}
            error={error}
            onAssignRole={(roleId) =>
              void run(() => assignRole({ userId: selected.userId, roleId: roleId as never }))
            }
            onRemoveRole={(roleId) =>
              void run(() => removeRole({ userId: selected.userId, roleId: roleId as never }))
            }
            onNickname={(nickname) =>
              void run(() =>
                setNickname({
                  userId: selected.userId,
                  ...(nickname.length > 0 ? { nickname } : {}),
                }),
              )
            }
            onTimeout={(until) =>
              void run(() =>
                until === undefined
                  ? timeout({ userId: selected.userId })
                  : timeout({ userId: selected.userId, until }),
              )
            }
            onKick={() =>
              void run(() => kick({ userId: selected.userId })).then(() => setMemberOpen(false))
            }
            onBan={(durationMs, reason) =>
              void run(() =>
                ban({
                  userId: selected.userId,
                  ...(reason !== undefined && reason.length > 0 ? { reason } : {}),
                  ...(durationMs !== undefined ? { durationMs } : {}),
                }),
              ).then(() => setMemberOpen(false))
            }
          />
        </Modal>
      )}

      <Modal
        open={bansOpen}
        onClose={() => setBansOpen(false)}
        size="md"
        label="Banned members"
        title="Banned members"
        description="People who cannot rejoin until they are unbanned."
        icon={
          <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-danger/10 text-danger">
            <Icon name="lock" size={18} />
          </span>
        }
        footer={
          <Button variant="secondary" onClick={() => setBansOpen(false)}>
            Done
          </Button>
        }
      >
        <section className="flex flex-col gap-2" data-testid="ban-list">
          {(bans ?? []).length === 0 ? (
            <Text tone="muted" size="sm">
              No banned members.
            </Text>
          ) : (
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-[10px] border border-border">
              {(bans ?? []).map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 bg-surface-1 px-3 py-2"
                >
                  <span className="min-w-0">
                    <Text size="sm" mono className="block truncate">
                      {entry.userId}
                    </Text>
                    {entry.reason !== null && entry.reason.length > 0 && (
                      <Text size="xs" tone="muted" className="block truncate">
                        {entry.reason}
                      </Text>
                    )}
                    <Text size="xs" tone="muted" className="block truncate">
                      {(entry.expiresAt ?? null) === null
                        ? "Permanent"
                        : `Expires ${new Date(entry.expiresAt as number).toLocaleString()}`}
                    </Text>
                  </span>
                  <ActionButton
                    disabled={busy}
                    onClick={() => void run(() => unban({ userId: entry.userId }))}
                  >
                    Unban
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Modal>
    </div>
  );
}

interface MemberDetailProps {
  readonly member: MemberView;
  readonly roles: readonly RoleView[];
  readonly viewer: MemberManagerViewer;
  readonly ownerId: string | null;
  readonly permissions: MemberManagerProps["permissions"];
  readonly moderatable: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  onAssignRole(roleId: string): void;
  onRemoveRole(roleId: string): void;
  onNickname(nickname: string): void;
  onTimeout(until: number | undefined): void;
  onKick(): void;
  onBan(durationMs?: number, reason?: string): void;
}

function MemberDetail({
  member,
  roles,
  viewer,
  ownerId,
  permissions,
  moderatable,
  busy,
  error,
  onAssignRole,
  onRemoveRole,
  onNickname,
  onTimeout,
  onKick,
  onBan,
}: MemberDetailProps) {
  const [nickname, setNickname] = useState(member.nickname ?? "");

  useEffect(() => {
    setNickname(member.nickname ?? "");
  }, [member.nickname]);

  const isSelf = member.userId === viewer.userId;
  const displayName = memberDisplayName(member, member.userId);
  const heldRefs = new Set(member.roleIds);
  const timedOut = member.timeoutUntil !== null && member.timeoutUntil > Date.now();
  const isOwner = member.userId === ownerId;

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

  const addRoleOptions: readonly ComboboxOption[] = assignable.map((role) => ({
    value: role.id,
    label: role.name,
    keywords: roleRef(role),
    leading:
      role.color !== null && role.color.length > 0 ? (
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 rounded-full border border-border"
          style={{ backgroundColor: role.color }}
        />
      ) : (
        <Icon name="shield" size={13} />
      ),
  }));

  const actionCount = [canEditNickname, canAssignRoles, canTimeout, canKick, canBan].filter(
    Boolean,
  ).length;

  return (
    <div className="flex flex-col gap-4" data-testid={`member-detail-${member.userId}`}>
      {(isOwner || timedOut) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {isOwner && (
            <span className="rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">
              Owner
            </span>
          )}
          {timedOut && (
            <span className="rounded-[5px] bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger">
              Timed out
            </span>
          )}
        </div>
      )}

      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}

      <section className="flex flex-col gap-2.5">
        <Text as="h4" size="xs" tone="muted" className="font-semibold uppercase tracking-[0.06em]">
          Roles
        </Text>
        <div className="flex flex-wrap items-center gap-1.5">
          {member.roleIds.map((ref) => {
            const role = roles.find((entry) => roleRef(entry) === ref);
            const label = role?.name ?? ref;
            const isEveryone = ref === EVERYONE_ROLE_ID;
            return (
              <span
                key={ref}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-3 py-0.5 pl-2 pr-1 text-[11px] font-medium"
                style={
                  !isEveryone && role?.color !== null && role?.color !== undefined
                    ? { color: role.color }
                    : undefined
                }
              >
                {!isEveryone && role?.color !== null && role?.color !== undefined && (
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                )}
                <span className={isEveryone ? "text-text-muted" : undefined}>{label}</span>
                {canAssignRoles && !isEveryone && role !== undefined && (
                  <button
                    type="button"
                    aria-label={`Remove role ${label}`}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition hover:bg-danger/15 hover:text-danger"
                    disabled={busy}
                    onClick={() => onRemoveRole(role.id)}
                  >
                    <Icon name="x" size={10} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
        {canAssignRoles && assignable.length > 0 && (
          <Combobox
            className="max-w-[220px]"
            aria-label={`Add role to ${displayName}`}
            value=""
            options={addRoleOptions}
            placeholder="Add role…"
            searchPlaceholder="Search roles…"
            emptyMessage="No roles to add."
            onChange={(roleId) => {
              if (roleId.length > 0) {
                onAssignRole(roleId);
              }
            }}
          />
        )}
      </section>

      {actionCount > 0 && (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          {canEditNickname && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Nickname"
                  value={nickname}
                  placeholder={displayName}
                  onChange={(event) => setNickname(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      onNickname(nickname.trim());
                    }
                  }}
                />
              </div>
              <ActionButton
                disabled={busy || nickname === (member.nickname ?? "")}
                onClick={() => onNickname(nickname.trim())}
              >
                Save nickname
              </ActionButton>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {canTimeout &&
              (timedOut ? (
                <ActionButton disabled={busy} onClick={() => onTimeout(undefined)}>
                  Clear timeout
                </ActionButton>
              ) : (
                <TimeoutMenu disabled={busy} onPick={(until) => onTimeout(until)} />
              ))}

            <span className="flex-1" />

            {canKick && (
              <ActionButton danger disabled={busy} onClick={onKick}>
                Kick
              </ActionButton>
            )}
            {canBan && <BanMenu disabled={busy} onPick={onBan} />}
          </div>
        </section>
      )}

      <MemberNote userId={member.userId} />
    </div>
  );
}

function MemberNote({ userId }: { readonly userId: string }) {
  const note = useQuery(api.notes.get, { targetUserId: userId });
  const upsert = useMutation(api.notes.upsert);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBody(note?.body ?? "");
  }, [note?.body]);

  const dirty = body !== (note?.body ?? "");

  return (
    <section
      className="flex flex-col gap-2 border-t border-border pt-4"
      data-testid={`member-note-${userId}`}
    >
      <div className="flex items-center gap-1.5">
        <Icon name="note" size={14} className="text-text-muted" />
        <Text as="h4" size="xs" tone="muted" className="font-semibold uppercase tracking-[0.06em]">
          Private note
        </Text>
        {(note?.body ?? "").trim().length > 0 && (
          <span className="flex h-1.5 w-1.5 rounded-full bg-accent" title="Note saved" />
        )}
      </div>
      <textarea
        aria-label="Private note"
        rows={3}
        value={body}
        maxLength={1000}
        placeholder="Only you can see this note about this member."
        onChange={(event) => {
          setBody(event.currentTarget.value);
          setSaved(false);
        }}
        className="resize-none rounded-[8px] border border-border bg-surface-1 px-2.5 py-2 text-[13px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <ActionButton
          disabled={busy || !dirty}
          onClick={() => {
            setError(null);
            setBusy(true);
            void upsert({ targetUserId: userId, body: body.trim() })
              .then(() => setSaved(true))
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : "Could not save the note."),
              )
              .finally(() => setBusy(false));
          }}
        >
          Save note
        </ActionButton>
        {saved && !dirty && (
          <Text size="xs" tone="secondary">
            Saved
          </Text>
        )}
        {error !== null && (
          <Text size="xs" tone="danger" role="alert">
            {error}
          </Text>
        )}
      </div>
    </section>
  );
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={danger ? "danger" : "secondary"}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function BanMenu({
  disabled,
  onPick,
}: {
  readonly disabled: boolean;
  readonly onPick: (durationMs?: number, reason?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="relative">
      <ActionButton danger disabled={disabled} onClick={() => setOpen((value) => !value)}>
        Ban…
      </ActionButton>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-1 w-[220px] animate-pop-in rounded-[9px] border border-border bg-surface-2 p-1.5 shadow-2xl shadow-black/25">
          <input
            aria-label="Ban reason"
            value={reason}
            maxLength={200}
            placeholder="Reason (optional)"
            onChange={(event) => setReason(event.target.value)}
            className="mb-1 h-8 w-full rounded-[7px] border border-border bg-surface-1 px-2 text-[12px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          {BAN_DURATIONS.map((duration) => (
            <button
              key={duration.label}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(
                  duration.ms ?? undefined,
                  reason.trim().length > 0 ? reason.trim() : undefined,
                );
              }}
              className="flex w-full items-center rounded-[7px] px-2.5 py-1.5 text-left text-[12px] text-danger transition hover:bg-danger/10"
            >
              {duration.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeoutMenu({
  disabled,
  onPick,
}: {
  readonly disabled: boolean;
  readonly onPick: (until: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <ActionButton disabled={disabled} onClick={() => setOpen((value) => !value)}>
        Time out…
      </ActionButton>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 min-w-[140px] animate-pop-in rounded-[9px] border border-border bg-surface-2 p-1 shadow-2xl shadow-black/25">
          {TIMEOUTS.map((duration) => (
            <button
              key={duration.label}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(Date.now() + duration.ms);
              }}
              className="flex w-full items-center rounded-[7px] px-2.5 py-1.5 text-left text-[12px] text-text transition hover:bg-surface-3"
            >
              {duration.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
