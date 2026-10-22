/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Icon } from "@aulora/ui-web";
import { useMemo } from "react";
import { PersonAvatar } from "./member-avatars";
import { type PeopleOption, PeoplePicker } from "./PeoplePicker";

export interface CreateChannelMemberOption {
  readonly userId: string;
  readonly displayName: string;
  readonly roleColor?: string | null;
}

export interface CreateChannelRoleOption {
  readonly id: string;
  readonly name: string;
  readonly color?: string | null;
}

interface PickerProps {
  readonly roles: readonly CreateChannelRoleOption[];
  readonly members: readonly CreateChannelMemberOption[];
  readonly selectedRoles: readonly string[];
  readonly selectedMembers: readonly string[];
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly onToggleRole: (id: string) => void;
  readonly onToggleMember: (userId: string) => void;
}

const ROLE_PREFIX = "role:";

/** A role's picture: its colour as a dot on a tile, or a shield when it has none. */
function RoleSwatch({ color, size }: { readonly color: string | null; readonly size: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-muted"
      style={{ width: size, height: size }}
    >
      {color !== null && color.length > 0 ? (
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      ) : (
        <Icon name="shield" size={Math.round(size * 0.48)} />
      )}
    </span>
  );
}

/** Roles first, then people, as one list of picker rows. */
function useWhitelistOptions(
  roles: readonly CreateChannelRoleOption[],
  members: readonly CreateChannelMemberOption[],
): readonly PeopleOption[] {
  return useMemo(() => {
    const roleRows = roles.map((role) => ({
      id: `${ROLE_PREFIX}${role.id}`,
      label: role.name,
      sublabel: "Role",
      leading: (size: number) => <RoleSwatch color={role.color ?? null} size={size} />,
    }));
    const memberRows = [...members]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((member) => ({
        id: member.userId,
        label: member.displayName,
        leading: (size: number) => (
          <PersonAvatar userId={member.userId} size={size} roleColor={member.roleColor} />
        ),
      }));
    return [...roleRows, ...memberRows];
  }, [roles, members]);
}

/**
 * The private-channel whitelist: the shared people picker over roles and
 * members, with a reminder that nobody else can see the channel.
 */
export function CreateChannelMemberPicker(props: PickerProps) {
  const { roles, members, selectedRoles, selectedMembers, onToggleRole, onToggleMember } = props;
  const options = useWhitelistOptions(roles, members);
  const selected = [...selectedRoles.map((id) => `${ROLE_PREFIX}${id}`), ...selectedMembers];

  return (
    <div className="animate-fade-in flex flex-col gap-2 pl-11">
      <PeoplePicker
        options={options}
        selected={selected}
        onToggle={(id) => {
          if (id.startsWith(ROLE_PREFIX)) {
            onToggleRole(id.slice(ROLE_PREFIX.length));
          } else {
            onToggleMember(id);
          }
        }}
        query={props.query}
        onQueryChange={props.onQueryChange}
        searchLabel="Search roles and people"
        placeholder="Add roles or people"
        emptyText="No roles or people match that search."
        listClassName="max-h-[196px]"
      />
      <p className="text-[12px] leading-snug text-text-muted">
        Everyone else, including @everyone, cannot see this channel.
      </p>
    </div>
  );
}
