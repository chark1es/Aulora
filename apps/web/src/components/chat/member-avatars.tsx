import { Avatar, userAvatarSeed } from "@aulora/avatars";
import { createContext, type ReactNode, useContext, useMemo } from "react";

const MemberAvatarContext = createContext<ReadonlyMap<string, string>>(new Map());

export function MemberAvatarProvider({
  members,
  children,
}: {
  readonly members: readonly { readonly userId: string; readonly avatarUrl?: string | null }[];
  readonly children: ReactNode;
}) {
  const urls = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      if (
        member.avatarUrl !== undefined &&
        member.avatarUrl !== null &&
        member.avatarUrl.length > 0
      ) {
        map.set(member.userId, member.avatarUrl);
      }
    }
    return map;
  }, [members]);
  return <MemberAvatarContext.Provider value={urls}>{children}</MemberAvatarContext.Provider>;
}

export function useMemberAvatarUrl(userId: string): string | null {
  return useContext(MemberAvatarContext).get(userId) ?? null;
}

/** A person, using this workspace's picture when they have set one. */
export function PersonAvatar({
  userId,
  size = 32,
  roleColor,
  title,
  className,
}: {
  readonly userId: string;
  readonly size?: number;
  readonly roleColor?: string | null | undefined;
  readonly title?: string;
  readonly className?: string;
}) {
  const src = useMemberAvatarUrl(userId);
  return (
    <Avatar
      seed={userAvatarSeed(userId)}
      size={size}
      {...(src !== null ? { src } : {})}
      {...(roleColor !== null && roleColor !== undefined && roleColor.length > 0
        ? { roleColor }
        : {})}
      {...(title !== undefined ? { title } : {})}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
