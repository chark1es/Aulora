import { userAvatarSeed } from "@aulora/avatars";
import { NativeAvatar } from "@aulora/avatars/native";
import { useAvatarUrls } from "../../providers/AvatarProvider";

/** A person, using this workspace's picture when they have set one. */
export function MemberAvatar({
  userId,
  size = 32,
  roleColor,
  title,
}: {
  readonly userId: string;
  readonly size?: number;
  readonly roleColor?: string | null;
  readonly title?: string;
}) {
  const avatarUrls = useAvatarUrls();
  const src = avatarUrls.get(userId);
  return (
    <NativeAvatar
      seed={userAvatarSeed(userId)}
      size={size}
      {...(src !== undefined ? { src } : {})}
      {...(roleColor !== null && roleColor !== undefined && roleColor.length > 0
        ? { roleColor }
        : {})}
      {...(title !== undefined ? { title } : {})}
    />
  );
}
