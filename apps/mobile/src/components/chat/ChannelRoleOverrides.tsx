import { cn, Icon, Text, usePalette } from "@aulora/ui-native";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import {
  CHANNEL_PERMISSION_GROUPS,
  type ChannelPermission,
  type ChannelPermissionGroup,
  type ChannelRoleOption,
  type OverrideLevel,
  type OverrideView,
  overrideLevel,
  setOverrideLevel,
} from "../../lib/channel-role-overrides";

const SEGMENTS: readonly OverrideLevel[] = ["inherit", "allow", "deny"];
const SEGMENT_LABELS = new Map<OverrideLevel, string>([
  ["inherit", "Inherit"],
  ["allow", "Allow"],
  ["deny", "Deny"],
]);

interface RoleTarget {
  readonly targetId: string;
  readonly targetType: "role";
}

function roleTarget(roleId: string): RoleTarget {
  return { targetId: roleId, targetType: "role" };
}

export interface ChannelRoleOverridesProps {
  readonly roles: readonly ChannelRoleOption[];
  readonly overrides: readonly OverrideView[];
  readonly onChange: (next: readonly OverrideView[]) => void;
  readonly disabled?: boolean;
}

/**
 * The mobile channel-edit role permissions editor: expand a role, then set each
 * channel-scoped permission to inherit, allow or deny. Only role-target
 * overrides are produced; the caller merges them with the channel's member
 * overrides before saving.
 */
export function ChannelRoleOverrides(props: ChannelRoleOverridesProps) {
  const { roles, overrides, onChange, disabled = false } = props;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sorted = useMemo(() => [...roles].sort((a, b) => b.position - a.position), [roles]);

  function toggle(roleId: string) {
    setExpandedId((current) => (current === roleId ? null : roleId));
  }

  function setLevel(roleId: string, name: ChannelPermission["name"], level: OverrideLevel) {
    onChange(setOverrideLevel(overrides, roleTarget(roleId), name, level));
  }

  function clearRole(roleId: string) {
    onChange(
      overrides.filter(
        (override) => !(override.targetType === "role" && override.targetId === roleId),
      ),
    );
  }

  return (
    <View
      testID="channel-role-overrides"
      className="gap-2.5 rounded-input border border-border bg-surface-2 p-3"
    >
      <View className="flex-row items-center justify-between">
        <Text size="xs" tone="muted" className="font-medium">
          Role permissions
        </Text>
        <Text size="xs" tone="muted">
          Per channel
        </Text>
      </View>

      <RoleList
        roles={sorted}
        overrides={overrides}
        disabled={disabled}
        expandedId={expandedId}
        onToggle={toggle}
        onSetLevel={setLevel}
        onClear={clearRole}
      />

      <Text size="xs" tone="muted">
        Inherit uses the workspace and category defaults; allow and deny change this channel only.
      </Text>
    </View>
  );
}

interface RoleListProps {
  readonly roles: readonly ChannelRoleOption[];
  readonly overrides: readonly OverrideView[];
  readonly disabled: boolean;
  readonly expandedId: string | null;
  readonly onToggle: (roleId: string) => void;
  readonly onSetLevel: (
    roleId: string,
    name: ChannelPermission["name"],
    level: OverrideLevel,
  ) => void;
  readonly onClear: (roleId: string) => void;
}

function RoleList(props: RoleListProps) {
  const { roles, overrides, disabled, expandedId, onToggle, onSetLevel, onClear } = props;
  if (roles.length === 0) {
    return (
      <Text size="xs" tone="muted">
        You cannot manage any roles here. Roles above your highest role stay unchanged.
      </Text>
    );
  }
  return (
    <>
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
    </>
  );
}

interface RolePermissionRowProps {
  readonly role: ChannelRoleOption;
  readonly overrides: readonly OverrideView[];
  readonly disabled: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onSetLevel: (
    roleId: string,
    name: ChannelPermission["name"],
    level: OverrideLevel,
  ) => void;
  readonly onClear: (roleId: string) => void;
}

function RolePermissionRow(props: RolePermissionRowProps) {
  const { role, overrides, disabled, expanded, onToggle, onSetLevel, onClear } = props;
  const palette = usePalette();
  const target = roleTarget(role.id);
  const hasColor = role.color !== null && role.color !== undefined && role.color.length > 0;

  return (
    <View className="overflow-hidden rounded-input border border-border bg-surface-1">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        testID={`role-override-${role.id}`}
        className="min-h-12 flex-row items-center gap-2.5 px-2.5 py-2"
        onPress={onToggle}
      >
        <View
          className="h-5 w-5 items-center justify-center rounded-pill border border-border"
          style={hasColor ? { backgroundColor: role.color ?? undefined } : undefined}
        >
          {!hasColor && (
            <Text size="xs" tone="muted" className="font-semibold">
              {(role.name.charAt(0) || "?").toUpperCase()}
            </Text>
          )}
        </View>
        <Text size="sm" className="min-w-0 flex-1" numberOfLines={1}>
          {role.name}
        </Text>
        <Icon name="chevron-down" size={14} color={palette["text-muted"]} />
      </Pressable>

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
    </View>
  );
}

interface RoleExpandedPermissionsProps {
  readonly role: ChannelRoleOption;
  readonly overrides: readonly OverrideView[];
  readonly target: RoleTarget;
  readonly disabled: boolean;
  readonly onSetLevel: (
    roleId: string,
    name: ChannelPermission["name"],
    level: OverrideLevel,
  ) => void;
  readonly onClear: (roleId: string) => void;
}

function RoleExpandedPermissions(props: RoleExpandedPermissionsProps) {
  const { role, overrides, target, disabled, onSetLevel, onClear } = props;
  return (
    <View className="gap-2 border-t border-border p-2.5">
      {CHANNEL_PERMISSION_GROUPS.map((group) => (
        <PermissionGroupCard
          key={group.label}
          group={group}
          overrides={overrides}
          target={target}
          roleId={role.id}
          disabled={disabled}
          onSetLevel={onSetLevel}
        />
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        className={cn("self-start rounded-input px-2 py-1", disabled && "opacity-40")}
        onPress={() => {
          onClear(role.id);
        }}
      >
        <Text size="xs" tone="danger">
          Clear role overrides
        </Text>
      </Pressable>
    </View>
  );
}

interface PermissionGroupCardProps {
  readonly group: ChannelPermissionGroup;
  readonly overrides: readonly OverrideView[];
  readonly target: RoleTarget;
  readonly roleId: string;
  readonly disabled: boolean;
  readonly onSetLevel: (
    roleId: string,
    name: ChannelPermission["name"],
    level: OverrideLevel,
  ) => void;
}

function PermissionGroupCard(props: PermissionGroupCardProps) {
  const { group, overrides, target, roleId, disabled, onSetLevel } = props;
  return (
    <View className="overflow-hidden rounded-input border border-border bg-surface-2">
      <Text
        size="xs"
        tone="muted"
        className="border-b border-border bg-surface-3 px-2.5 py-1 font-semibold uppercase"
      >
        {group.label}
      </Text>
      {group.permissions.map((permission) => (
        <View
          key={permission.name}
          className="flex-row items-center justify-between gap-2 border-b border-border px-2.5 py-1.5"
        >
          <Text size="sm" className="min-w-0 flex-1" numberOfLines={1}>
            {permission.label}
          </Text>
          <RoleTriState
            label={permission.label}
            value={overrideLevel(overrides, target, permission.name)}
            disabled={disabled}
            onChange={(level) => {
              onSetLevel(roleId, permission.name, level);
            }}
          />
        </View>
      ))}
    </View>
  );
}

function RoleTriState({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: OverrideLevel;
  readonly disabled: boolean;
  readonly onChange: (level: OverrideLevel) => void;
}) {
  const palette = usePalette();
  return (
    <View className={cn("flex-row items-center gap-0.5", disabled && "opacity-50")}>
      {SEGMENTS.map((segment) => {
        const active = segment === value;
        const activeColor =
          segment === "allow"
            ? palette.secondary
            : segment === "deny"
              ? palette.danger
              : palette["text-muted"];
        return (
          <Pressable
            key={segment}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label} ${segment}`}
            disabled={disabled}
            className="h-9 min-w-9 items-center justify-center rounded-input border"
            style={{
              borderColor: active ? activeColor : palette.border,
              backgroundColor: active ? `${activeColor}26` : palette["surface-3"],
            }}
            onPress={() => {
              onChange(segment);
            }}
          >
            <Text size="xs" style={{ color: active ? activeColor : palette["text-muted"] }}>
              {SEGMENT_LABELS.get(segment) ?? segment}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
