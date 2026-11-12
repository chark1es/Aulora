/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { EVERYONE_ROLE_ID, roleColorCss } from "@aulora/core";
import { Button, Icon, Text } from "@aulora/ui-web";
import { useEffect, useState } from "react";
import {
  canManageRoleUi,
  type MemberView,
  memberDisplayName,
  type RoleView,
  roleRef,
} from "../../lib/workspace-admin";
import { Combobox, type ComboboxOption } from "./Combobox";
import type { Callback } from "./callbacks";
import { MemberActionsSection } from "./MemberActions";
import type { MemberManagerProps, MemberManagerViewer } from "./MemberManager";
import { MemberNote } from "./MemberNote";

export interface MemberDetailProps {
  readonly member: MemberView;
  readonly roles: readonly RoleView[];
  readonly viewer: MemberManagerViewer;
  readonly ownerIds: readonly string[];
  readonly canManageOwners: boolean;
  readonly permissions: MemberManagerProps["permissions"];
  readonly moderatable: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onPromoteOwner: () => void;
  readonly onDemoteOwner: () => void;
  readonly onAssignRole: Callback<[roleId: string]>;
  readonly onRemoveRole: Callback<[roleId: string]>;
  readonly onNickname: Callback<[nickname: string]>;
  readonly onTimeout: Callback<[until: number | undefined]>;
  readonly onKick: () => void;
  readonly onBan: Callback<[durationMs?: number, reason?: string]>;
}

interface MemberDetailModel {
  readonly member: MemberView;
  readonly roles: readonly RoleView[];
  readonly viewer: MemberManagerViewer;
  readonly nickname: string;
  readonly onNicknameChange: (value: string) => void;
  readonly displayName: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly isOwner: boolean;
  readonly isLastOwner: boolean;
  readonly isBot: boolean;
  readonly canManageOwners: boolean;
  readonly timedOut: boolean;
  readonly canEditNickname: boolean;
  readonly canAssignRoles: boolean;
  readonly canTimeout: boolean;
  readonly canKick: boolean;
  readonly canBan: boolean;
  readonly actionCount: number;
  readonly onNickname: Callback<[nickname: string]>;
  readonly onTimeout: Callback<[until: number | undefined]>;
  readonly onKick: () => void;
  readonly onBan: Callback<[durationMs?: number, reason?: string]>;
  readonly onPromoteOwner: () => void;
  readonly onDemoteOwner: () => void;
  readonly onAssignRole: Callback<[roleId: string]>;
  readonly onRemoveRole: Callback<[roleId: string]>;
}

function useMemberDetailModel(props: MemberDetailProps): MemberDetailModel {
  const {
    member,
    roles,
    viewer,
    ownerIds,
    canManageOwners,
    permissions,
    moderatable,
    busy,
    error,
  } = props;
  const [nickname, setNickname] = useState(member.nickname ?? "");

  useEffect(() => {
    setNickname(member.nickname ?? "");
  }, [member.nickname]);

  const { isSelf, displayName, timedOut, isOwner } = memberFlags(member, viewer, ownerIds);
  const { canEditNickname, canAssignRoles, canTimeout, canKick, canBan } = memberActions(
    permissions,
    viewer,
    moderatable,
    isSelf,
  );
  const actionCount = [canEditNickname, canAssignRoles, canTimeout, canKick, canBan].filter(
    Boolean,
  ).length;

  return {
    member,
    roles,
    viewer,
    nickname,
    onNicknameChange: setNickname,
    displayName,
    busy,
    error,
    isOwner,
    isLastOwner: isOwner && ownerIds.length <= 1,
    isBot: member.isBot === true,
    canManageOwners,
    timedOut,
    canEditNickname,
    canAssignRoles,
    canTimeout,
    canKick,
    canBan,
    actionCount,
    onNickname: props.onNickname,
    onTimeout: props.onTimeout,
    onKick: props.onKick,
    onBan: props.onBan,
    onPromoteOwner: props.onPromoteOwner,
    onDemoteOwner: props.onDemoteOwner,
    onAssignRole: props.onAssignRole,
    onRemoveRole: props.onRemoveRole,
  };
}

function memberFlags(
  member: MemberView,
  viewer: MemberManagerViewer,
  ownerIds: readonly string[],
): {
  readonly isSelf: boolean;
  readonly displayName: string;
  readonly timedOut: boolean;
  readonly isOwner: boolean;
} {
  return {
    isSelf: member.userId === viewer.userId,
    displayName: memberDisplayName(member, member.userId),
    timedOut: member.timeoutUntil !== null && member.timeoutUntil > Date.now(),
    isOwner: ownerIds.includes(member.userId),
  };
}

export function MemberDetail(props: MemberDetailProps) {
  return <MemberDetailView model={useMemberDetailModel(props)} />;
}

function MemberDetailView({ model }: { readonly model: MemberDetailModel }) {
  return (
    <div className="flex flex-col gap-4" data-testid={`member-detail-${model.member.userId}`}>
      <MemberBadges isOwner={model.isOwner} timedOut={model.timedOut} />

      <MemberError error={model.error} />

      {model.canManageOwners && !model.isBot && (
        <OwnerSection
          isOwner={model.isOwner}
          isLastOwner={model.isLastOwner}
          displayName={model.displayName}
          busy={model.busy}
          onPromote={model.onPromoteOwner}
          onDemote={model.onDemoteOwner}
        />
      )}

      <MemberRolesSection
        member={model.member}
        roles={model.roles}
        viewer={model.viewer}
        displayName={model.displayName}
        canAssignRoles={model.canAssignRoles}
        busy={model.busy}
        onAssignRole={model.onAssignRole}
        onRemoveRole={model.onRemoveRole}
      />

      {model.actionCount > 0 && (
        <MemberActionsSection
          member={model.member}
          nickname={model.nickname}
          onNicknameChange={model.onNicknameChange}
          displayName={model.displayName}
          busy={model.busy}
          timedOut={model.timedOut}
          canEditNickname={model.canEditNickname}
          canTimeout={model.canTimeout}
          canKick={model.canKick}
          canBan={model.canBan}
          onNickname={model.onNickname}
          onTimeout={model.onTimeout}
          onKick={model.onKick}
          onBan={model.onBan}
        />
      )}

      <MemberNote userId={model.member.userId} />
    </div>
  );
}

function memberActions(
  permissions: MemberManagerProps["permissions"],
  viewer: MemberManagerViewer,
  moderatable: boolean,
  isSelf: boolean,
): {
  readonly canEditNickname: boolean;
  readonly canAssignRoles: boolean;
  readonly canTimeout: boolean;
  readonly canKick: boolean;
  readonly canBan: boolean;
} {
  return {
    canEditNickname: isSelf
      ? permissions.changeOwnNickname || permissions.manageNicknames || viewer.isOwner
      : permissions.manageNicknames && moderatable,
    canAssignRoles: permissions.manageRoles && moderatable,
    canTimeout: permissions.timeout && moderatable,
    canKick: permissions.kick && moderatable,
    canBan: permissions.ban && moderatable && !isSelf,
  };
}

function MemberError({ error }: { readonly error: string | null }) {
  if (error === null) {
    return null;
  }
  return (
    <Text tone="danger" size="sm" role="alert">
      {error}
    </Text>
  );
}

interface OwnerSectionProps {
  readonly isOwner: boolean;
  readonly isLastOwner: boolean;
  readonly displayName: string;
  readonly busy: boolean;
  readonly onPromote: () => void;
  readonly onDemote: () => void;
}

/**
 * Owner access for one member. Owners are peers with full workspace and
 * instance authority, so promotion is deliberately a separate, confirmed
 * action rather than part of the role picker.
 */
function OwnerSection(props: OwnerSectionProps) {
  const { isOwner, isLastOwner, displayName, busy, onPromote, onDemote } = props;
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <Text as="h4" size="xs" tone="muted" className="font-semibold">
        Owner access
      </Text>
      <Text size="sm" tone="muted" className="leading-relaxed">
        {isOwner
          ? `${displayName} is an owner: full control over roles, members, instance settings and environment credentials.`
          : `Owners are peers with full control over roles, members, instance settings and environment credentials.`}
      </Text>
      {isLastOwner ? (
        <Text size="xs" tone="muted">
          This is the last owner. Make another member an owner before removing this role.
        </Text>
      ) : (
        <div>
          <Button
            variant={isOwner ? "secondary" : "primary"}
            size="sm"
            disabled={busy}
            onClick={isOwner ? onDemote : onPromote}
          >
            {isOwner ? "Remove owner" : "Make owner"}
          </Button>
        </div>
      )}
    </section>
  );
}

function MemberBadges({
  isOwner,
  timedOut,
}: {
  readonly isOwner: boolean;
  readonly timedOut: boolean;
}) {
  if (!isOwner && !timedOut) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isOwner && (
        <span className="rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[12px] font-semibold uppercase text-accent-text">
          Owner
        </span>
      )}
      {timedOut && (
        <span className="rounded-[5px] bg-danger/10 px-1.5 py-0.5 text-[12px] font-semibold uppercase text-danger-text">
          Timed out
        </span>
      )}
    </div>
  );
}

interface MemberRolesSectionProps {
  readonly member: MemberView;
  readonly roles: readonly RoleView[];
  readonly viewer: MemberManagerViewer;
  readonly displayName: string;
  readonly canAssignRoles: boolean;
  readonly busy: boolean;
  readonly onAssignRole: Callback<[roleId: string]>;
  readonly onRemoveRole: Callback<[roleId: string]>;
}

function MemberRolesSection(props: MemberRolesSectionProps) {
  const { member, roles, viewer, displayName, canAssignRoles, busy, onAssignRole, onRemoveRole } =
    props;
  const heldRefs = new Set(member.roleIds);
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
      roleColorCss(role.color) !== null ? (
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 rounded-full border border-border"
          style={{ backgroundColor: roleColorCss(role.color) ?? undefined }}
        />
      ) : (
        <Icon name="shield" size={13} />
      ),
  }));

  return (
    <section className="flex flex-col gap-2.5">
      <Text as="h4" size="xs" tone="muted" className="font-semibold">
        Roles
      </Text>
      <div className="flex flex-wrap items-center gap-1.5">
        {member.roleIds.map((ref) => {
          const role = roles.find((entry) => roleRef(entry) === ref);
          const label = role?.name ?? ref;
          const isEveryone = ref === EVERYONE_ROLE_ID;
          const tint = isEveryone ? null : roleColorCss(role?.color);
          return (
            <span
              key={ref}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-3 py-0.5 pl-2 pr-1 text-[11px] font-medium"
              style={tint !== null ? { color: tint } : undefined}
            >
              {tint !== null && (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: tint }}
                />
              )}
              <span className={isEveryone ? "text-text-muted" : undefined}>{label}</span>
              {canAssignRoles && !isEveryone && role !== undefined && (
                <button
                  type="button"
                  aria-label={`Remove role ${label}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition hover:bg-danger/15 hover:text-danger-text"
                  disabled={busy}
                  onClick={() => {
                    onRemoveRole(role.id);
                  }}
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
  );
}
