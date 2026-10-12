/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { PermissionName } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useMemo, useState } from "react";
import {
  type OverrideLevel,
  type OverrideView,
  overrideLevel,
  PERMISSION_LABELS,
  setOverrideLevel,
} from "../../lib/workspace-admin";
import { OverrideTriState } from "../admin/OverrideTriState";
import {
  CHANNEL_PERMISSION_GROUPS,
  type ChannelPermissionGroup,
  type ChannelRoleOption,
} from "./channel-role-overrides";

const PERMISSION_LABELS_BY_NAME = new Map<string, string>(Object.entries(PERMISSION_LABELS));

function permissionLabel(name: PermissionName): string {
  return PERMISSION_LABELS_BY_NAME.get(name) ?? name;
}

interface RoleCounts {
  readonly allow: number;
  readonly deny: number;
}

interface RoleTarget {
  readonly targetId: string;
  readonly targetType: "role";
}

function roleTarget(roleId: string): RoleTarget {
  return { targetId: roleId, targetType: "role" };
}

function countRoleOverrides(overrides: readonly OverrideView[], target: RoleTarget): RoleCounts {
  let allow = 0;
  let deny = 0;
  for (const group of CHANNEL_PERMISSION_GROUPS) {
    for (const name of group.permissions) {
      const level = overrideLevel(overrides, target, name);
      if (level === "allow") {
        allow += 1;
      } else if (level === "deny") {
        deny += 1;
      }
    }
  }
  return { allow, deny };
}

export interface ChannelRoleOverridesProps {
  readonly roles: readonly ChannelRoleOption[];
  readonly overrides: readonly OverrideView[];
  readonly onChange: (next: readonly OverrideView[]) => void;
  readonly disabled?: boolean;
}

/**
 * The channel edit dialog's role permissions editor: pick a role, then set each
 * channel-scoped permission to inherit, allow or deny. Only role-target
 * overrides are produced here; the caller merges them with the channel's
 * member overrides before saving.
 */
export function ChannelRoleOverrides({
  roles,
  overrides,
  onChange,
  disabled = false,
}: ChannelRoleOverridesProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sorted = useMemo(() => [...roles].sort((a, b) => b.position - a.position), [roles]);

  const setLevel = (roleId: string, name: PermissionName, level: OverrideLevel) => {
    onChange(setOverrideLevel(overrides, roleTarget(roleId), name, level));
  };

  const clearRole = (roleId: string) => {
    onChange(
      overrides.filter(
        (override) => !(override.targetType === "role" && override.targetId === roleId),
      ),
    );
  };

  const toggle = (roleId: string) => {
    setExpandedId((current) => (current === roleId ? null : roleId));
  };

  return (
    <section
      data-testid="channel-role-overrides"
      className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface-1 p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-text-muted">Role permissions</span>
        <span className="flex items-center gap-1 text-[11px] text-text-muted">
          <Icon name="shield" size={12} />
          Per channel
        </span>
      </header>

      <RoleList
        roles={sorted}
        overrides={overrides}
        disabled={disabled}
        expandedId={expandedId}
        onToggle={toggle}
        onSetLevel={setLevel}
        onClear={clearRole}
      />

      <p className="text-[11px] leading-snug text-text-muted">
        Inherit uses the workspace and category defaults; allow and deny change this channel only.
      </p>
    </section>
  );
}

interface RoleListProps {
  readonly roles: readonly ChannelRoleOption[];
  readonly overrides: readonly OverrideView[];
  readonly disabled: boolean;
  readonly expandedId: string | null;
  readonly onToggle: (roleId: string) => void;
  readonly onSetLevel: (roleId: string, name: PermissionName, level: OverrideLevel) => void;
  readonly onClear: (roleId: string) => void;
}

function RoleList(props: RoleListProps) {
  const { roles, overrides, disabled, expandedId, onToggle, onSetLevel, onClear } = props;
  if (roles.length === 0) {
    return (
      <p className="text-[11px] leading-snug text-text-muted">
        You cannot manage any roles here. Roles above your highest role stay unchanged.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {roles.map((role) => (
        <RolePermissionRow
          key={role.id}
          role={role}
          overrides={overrides}
          disabled={disabled}
          expanded={expandedId === role.id}
          onToggle={() => {
            onToggle(role.id);
          }}
          onSetLevel={onSetLevel}
          onClear={onClear}
        />
      ))}
    </ul>
  );
}

interface RolePermissionRowProps {
  readonly role: ChannelRoleOption;
  readonly overrides: readonly OverrideView[];
  readonly disabled: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onSetLevel: (roleId: string, name: PermissionName, level: OverrideLevel) => void;
  readonly onClear: (roleId: string) => void;
}

function RolePermissionRow(props: RolePermissionRowProps) {
  const { role, overrides, disabled, expanded, onToggle, onSetLevel, onClear } = props;
  const target = roleTarget(role.id);
  const counts = countRoleOverrides(overrides, target);
  const hasColor = role.color !== undefined && role.color !== null && role.color.length > 0;

  return (
    <li className="overflow-clip rounded-[9px] border border-border bg-surface-2">
      <button
        type="button"
        aria-expanded={expanded}
        data-testid={`role-override-${role.id}`}
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition hover:bg-surface-3"
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[9px] font-semibold text-text-muted",
            hasColor && "border-transparent",
          )}
          style={hasColor ? { backgroundColor: role.color ?? undefined } : undefined}
        >
          {!hasColor && (role.name.charAt(0).toUpperCase() || "?")}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-text">{role.name}</span>
        {role.isEveryone === true && (
          <span className="shrink-0 rounded-[5px] border border-border px-1 py-px text-[10px] uppercase tracking-wide text-text-muted">
            Everyone
          </span>
        )}
        <RoleCountPills counts={counts} />
        <Icon
          name="chevron-down"
          size={14}
          className={cn("shrink-0 text-text-muted transition-transform", expanded && "rotate-180")}
        />
      </button>

      {expanded && (
        <RoleExpandedPermissions
          role={role}
          overrides={overrides}
          target={target}
          disabled={disabled}
          onSetLevel={onSetLevel}
          onClear={onClear}
        />
      )}
    </li>
  );
}

interface RoleExpandedPermissionsProps {
  readonly role: ChannelRoleOption;
  readonly overrides: readonly OverrideView[];
  readonly target: RoleTarget;
  readonly disabled: boolean;
  readonly onSetLevel: (roleId: string, name: PermissionName, level: OverrideLevel) => void;
  readonly onClear: (roleId: string) => void;
}

function RoleExpandedPermissions(props: RoleExpandedPermissionsProps) {
  const { role, overrides, target, disabled, onSetLevel, onClear } = props;
  const counts = countRoleOverrides(overrides, target);
  return (
    <div className="animate-fade-in flex flex-col gap-2 border-t border-border p-2.5">
      <div className="flex max-h-[240px] flex-col gap-2 overflow-y-auto pr-0.5">
        {CHANNEL_PERMISSION_GROUPS.map((group) => (
          <RolePermissionGroup
            key={group.label}
            group={group}
            overrides={overrides}
            target={target}
            disabled={disabled}
            onSetLevel={onSetLevel}
            roleId={role.id}
          />
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || (counts.allow === 0 && counts.deny === 0)}
        onClick={() => {
          onClear(role.id);
        }}
        className="self-start rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium text-text-muted transition hover:bg-surface-3 hover:text-danger disabled:pointer-events-none disabled:opacity-40"
      >
        Clear role overrides
      </button>
    </div>
  );
}

interface RolePermissionGroupProps {
  readonly group: ChannelPermissionGroup;
  readonly overrides: readonly OverrideView[];
  readonly target: RoleTarget;
  readonly disabled: boolean;
  readonly roleId: string;
  readonly onSetLevel: (roleId: string, name: PermissionName, level: OverrideLevel) => void;
}

function RolePermissionGroup(props: RolePermissionGroupProps) {
  const { group, overrides, target, disabled, roleId, onSetLevel } = props;
  return (
    <section className="overflow-clip rounded-[8px] border border-border bg-surface-1">
      <h4 className="border-b border-border bg-surface-2/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        {group.label}
      </h4>
      <div className="divide-y divide-border">
        {group.permissions.map((name) => {
          const label = permissionLabel(name);
          return (
            <div key={name} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
              <span className="min-w-0 truncate text-[12px] text-text">{label}</span>
              <OverrideTriState
                label={label}
                value={overrideLevel(overrides, target, name)}
                disabled={disabled}
                onChange={(next) => {
                  onSetLevel(roleId, name, next);
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RoleCountPills({ counts }: { readonly counts: RoleCounts }) {
  if (counts.allow === 0 && counts.deny === 0) {
    return (
      <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-muted">
        inherit
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      {counts.allow > 0 && (
        <span className="rounded-full bg-secondary/15 px-1.5 py-0.5 text-[10px] font-medium text-secondary">
          {counts.allow}
        </span>
      )}
      {counts.deny > 0 && (
        <span className="rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
          {counts.deny}
        </span>
      )}
    </span>
  );
}
