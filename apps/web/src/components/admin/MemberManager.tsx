import { Badge, Button, EmptyState, Icon, Modal, Spinner, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  canModerateUi,
  type MemberView,
  memberDisplayName,
  roleColorFor,
  roleNamesFor,
} from "../../lib/workspace-admin";
import { PersonAvatar } from "../chat/member-avatars";
import { AdminPageHeader } from "./AdminPageHeader";
import { BanList } from "./BanList";
import { MemberDetail } from "./MemberDetail";

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
  /** Opens the Invites page when the viewer may create or delete invites. */
  readonly onOpenInvites?: () => void;
}

const ANY_MANAGE = (p: MemberManagerProps["permissions"]): boolean =>
  p.manageRoles || p.kick || p.ban || p.timeout || p.manageNicknames;

/**
 * Member administration: a compact member index whose rows pop a focused
 * dialog open, plus the ban list as its own pop-out. Controls are hidden by
 * effective permissions + hierarchy; the server enforces the same rules and any
 * rejection shows inline.
 */
export function MemberManager({ viewer, ownerId, permissions, onOpenInvites }: MemberManagerProps) {
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
      <div className="flex flex-col gap-8" data-testid="member-manager">
        <AdminPageHeader
          title="Members"
          description="Review this workspace’s people, their roles and moderation state."
        />
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
    <div className="flex flex-col gap-8" data-testid="member-manager">
      <AdminPageHeader
        title="Members"
        description="Pick a member to moderate in a focused panel, or review the ban list."
      />

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
        <EmptyState
          icon="users"
          size="sm"
          title="No members yet"
          description="Invite someone to join this workspace."
          {...(onOpenInvites !== undefined
            ? {
                action: (
                  <Button variant="secondary" onClick={onOpenInvites}>
                    Open invites
                  </Button>
                ),
              }
            : {})}
        />
      )}

      {members !== undefined && memberList.length > 0 && (
        <ul className="divide-y divide-border/60 border-y border-border/60">
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
                  className="group flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-surface-3/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <PersonAvatar userId={member.userId} size={28} />
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
                      <MemberBadges
                        isOwner={member.userId === ownerId}
                        isBot={member.isBot === true}
                      />
                      {notedUserIds.has(member.userId) && (
                        <Icon name="note" size={12} className="shrink-0 text-text-muted" />
                      )}
                    </span>
                    <Text as="span" size="xs" tone="muted" className="block truncate text-[12px]">
                      {names.length === 0 ? "No roles" : names.join(", ")}
                    </Text>
                  </span>
                  <Icon
                    name="chevron-right"
                    size={14}
                    className="shrink-0 text-text-muted/50 transition group-hover:text-text"
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
          onClick={() => {
            setBansOpen(true);
          }}
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
          onClose={() => {
            setMemberOpen(false);
          }}
          size="md"
          label="Member"
          title={memberDisplayName(selected, selected.userId)}
          description={
            roleNamesFor(selected, roleList).length === 0
              ? "No roles"
              : roleNamesFor(selected, roleList).join(", ")
          }
          icon={<PersonAvatar userId={selected.userId} size={36} />}
          footer={
            <Button
              variant="secondary"
              onClick={() => {
                setMemberOpen(false);
              }}
            >
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
            onAssignRole={(roleId) => {
              void run(() => assignRole({ userId: selected.userId, roleId: roleId as never }));
            }}
            onRemoveRole={(roleId) => {
              void run(() => removeRole({ userId: selected.userId, roleId: roleId as never }));
            }}
            onNickname={(nickname) => {
              void run(() =>
                setNickname({
                  userId: selected.userId,
                  ...(nickname.length > 0 ? { nickname } : {}),
                }),
              );
            }}
            onTimeout={(until) => {
              void run(() =>
                until === undefined
                  ? timeout({ userId: selected.userId })
                  : timeout({ userId: selected.userId, until }),
              );
            }}
            onKick={() => {
              void run(() => kick({ userId: selected.userId })).then(() => {
                setMemberOpen(false);
              });
            }}
            onBan={(durationMs, reason) => {
              void run(() =>
                ban({
                  userId: selected.userId,
                  ...(reason !== undefined && reason.length > 0 ? { reason } : {}),
                  ...(durationMs !== undefined ? { durationMs } : {}),
                }),
              ).then(() => {
                setMemberOpen(false);
              });
            }}
          />
        </Modal>
      )}

      <Modal
        open={bansOpen}
        onClose={() => {
          setBansOpen(false);
        }}
        size="md"
        label="Banned members"
        title="Banned members"
        description="They cannot rejoin until the ban ends or you lift it."
        tone="danger"
        icon={<Icon name="lock" size={18} />}
        footer={
          <Button
            variant="secondary"
            onClick={() => {
              setBansOpen(false);
            }}
          >
            Done
          </Button>
        }
      >
        <section data-testid="ban-list">
          <BanList
            bans={bans ?? []}
            busy={busy}
            onUnban={(userId) => {
              void run(() => unban({ userId }));
            }}
          />
        </section>
      </Modal>
    </div>
  );
}

interface MemberBadgesProps {
  readonly isOwner: boolean;
  readonly isBot: boolean;
}

/** The Owner and BOT chips shown next to a member's name. */
function MemberBadges({ isOwner, isBot }: MemberBadgesProps) {
  return (
    <>
      {isOwner && (
        <Badge size="sm" tone="accent" className="uppercase">
          Owner
        </Badge>
      )}
      {isBot && (
        <Badge size="sm" tone="accent" className="uppercase">
          BOT
        </Badge>
      )}
    </>
  );
}
