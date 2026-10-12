/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { EVERYONE_ROLE_ID } from "./permissions";

/**
 * A role that may render as its own section in the member list. Framework-free:
 * both the web and React Native member panes map their own role views onto this
 * shape and share the grouping below.
 */
export interface MembersGroupingRole {
  /**
   * The reference members store in their `roleIds`: the role's stable key when
   * it has one, otherwise its id.
   */
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly position: number;
  /** Renders this role as its own section when true. */
  readonly hoisted?: boolean;
  /** The workspace-wide `@everyone` role; never hoisted as a section. */
  readonly isEveryone?: boolean;
}

/** The minimum a member needs for grouping: the roles it holds. */
export interface MembersGroupingMember {
  readonly roleIds?: readonly string[];
}

export interface MembersGroupingRoleSection<T> {
  readonly role: MembersGroupingRole;
  readonly members: readonly T[];
}

export interface MembersGroupingResult<T> {
  /**
   * Online members grouped under their highest hoisted role, highest role
   * first. Empty sections are dropped.
   */
  readonly sections: readonly MembersGroupingRoleSection<T>[];
  /** Online members who hold no hoisted role. */
  readonly online: readonly T[];
  /** Every offline member, regardless of role. */
  readonly offline: readonly T[];
}

/** Mutable working shape; the returned sections expose the members read-only. */
interface WorkingSection<T> {
  readonly role: MembersGroupingRole;
  readonly members: T[];
}

/**
 * Splits the member list into hoisted-role sections plus the online/offline
 * remainder the client already renders.
 *
 * Discord behaviour, matching the existing presence split: a hoisted role's
 * section lists only its online members, and offline members of every role
 * collapse into the final offline group rather than the role section. Each
 * member appears under the highest-positioned hoisted role they hold, so a
 * member with several hoisted roles is listed once. `@everyone` never becomes a
 * section, even if its hoist flag is set.
 *
 * Members keep the order they are given, so callers sort once beforehand. The
 * pass is linear in members times their role count.
 */
export function groupMembersByHoistedRole<T extends MembersGroupingMember>(
  members: readonly T[],
  roles: readonly MembersGroupingRole[],
  isOnline: (member: T) => boolean,
): MembersGroupingResult<T> {
  const hoisted = roles
    .filter(
      (role) => role.hoisted === true && role.isEveryone !== true && role.id !== EVERYONE_ROLE_ID,
    )
    .sort((a, b) => b.position - a.position);

  const sections: WorkingSection<T>[] = hoisted.map((role) => ({ role, members: [] }));
  const sectionByRole = new Map(sections.map((section) => [section.role.id, section] as const));

  const online: T[] = [];
  const offline: T[] = [];
  for (const member of members) {
    let best: WorkingSection<T> | null = null;
    for (const roleId of member.roleIds ?? []) {
      const section = sectionByRole.get(roleId);
      if (section !== undefined && (best === null || section.role.position > best.role.position)) {
        best = section;
      }
    }
    if (!isOnline(member)) {
      offline.push(member);
    } else if (best === null) {
      online.push(member);
    } else {
      best.members.push(member);
    }
  }

  return {
    sections: sections.filter((section) => section.members.length > 0),
    online,
    offline,
  };
}
