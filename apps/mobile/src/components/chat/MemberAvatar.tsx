import { userAvatarSeed } from "@aulora/avatars";
import { NativeAvatar } from "@aulora/avatars/native";
import { memo } from "react";
import { useAvatarUrls } from "../../providers/AvatarProvider";

/** A person, using this workspace's picture when they have set one. */
export const MemberAvatar = memo(function MemberAvatar({
  userId,
  size = 32,
  title,
}: {
  readonly userId: string;
  readonly size?: number;
  readonly title?: string;
}) {
  const avatarUrls = useAvatarUrls();
  const src = avatarUrls.get(userId);
  return (
    <NativeAvatar
      seed={userAvatarSeed(userId)}
      size={size}
      {...(src !== undefined ? { src } : {})}
      {...(title !== undefined ? { title } : {})}
    />
  );
});
