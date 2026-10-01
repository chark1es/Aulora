import { Button, Input, Spinner, Text } from "@aulora/ui-native";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";

export function ProfileEditor({
  userId,
  canChangeNickname,
}: {
  readonly userId: string;
  readonly canChangeNickname: boolean;
}) {
  const me = useQuery(api.members.me, {});
  const profile = useQuery(api.members.profile, { userId });
  const setNickname = useMutation(api.members.setNickname);
  const setBio = useMutation(api.members.setBio);
  const [nickname, editNickname] = useState("");
  const [bio, editBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    editNickname(me?.member?.nickname ?? "");
  }, [me?.member?.nickname]);
  useEffect(() => {
    editBio(profile?.bio ?? "");
  }, [profile?.bio]);
  if (me === undefined || profile === undefined) return <Spinner label="Loading your profile" />;
  if (me === null || profile === null)
    return <Text tone="muted">Your workspace profile is unavailable.</Text>;
  const nicknameChanged = nickname.trim() !== (me.member?.nickname ?? "");
  const bioChanged = bio.trim() !== (profile.bio ?? "");
  return (
    <View className="gap-3">
      {canChangeNickname && (
        <Input
          label="Workspace nickname"
          hint="Leave blank to use your account name."
          value={nickname}
          onChangeText={editNickname}
          maxLength={80}
        />
      )}
      <Input
        label="About you"
        hint="Visible to other members in this workspace."
        value={bio}
        onChangeText={editBio}
        multiline
        maxLength={500}
      />
      <Button
        loading={busy}
        disabled={!bioChanged && !(canChangeNickname && nicknameChanged)}
        onPress={() => {
          setBusy(true);
          setError(null);
          setFeedback(null);
          void (async () => {
            if (canChangeNickname && nicknameChanged)
              await setNickname({
                userId,
                ...(nickname.trim().length > 0 ? { nickname: nickname.trim() } : {}),
              });
            if (bioChanged) await setBio({ bio: bio.trim() });
            setFeedback("Profile saved.");
          })()
            .catch((cause: unknown) =>
              setError(
                cause instanceof Error ? cause.message : "Couldn't save your profile. Try again.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        Save profile
      </Button>
      {error !== null && (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
      {feedback !== null && <Text accessibilityLiveRegion="polite">{feedback}</Text>}
    </View>
  );
}
