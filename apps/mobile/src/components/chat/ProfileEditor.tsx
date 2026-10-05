import { Button, Input, Spinner, Text } from "@aulora/ui-native";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";

function useProfileEditor(userId: string, canChangeNickname: boolean) {
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

  async function save() {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const nicknameChanged = nickname.trim() !== (me?.member?.nickname ?? "");
      if (canChangeNickname && nicknameChanged) {
        await setNickname({
          userId,
          ...(nickname.trim().length > 0 ? { nickname: nickname.trim() } : {}),
        });
      }
      if (bio.trim() !== (profile?.bio ?? "")) {
        await setBio({ bio: bio.trim() });
      }
      setFeedback("Profile saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save your profile. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const nicknameChanged = nickname.trim() !== (me?.member?.nickname ?? "");
  const bioChanged = bio.trim() !== (profile?.bio ?? "");
  return {
    me,
    profile,
    nickname,
    editNickname,
    bio,
    editBio,
    busy,
    feedback,
    error,
    nicknameChanged,
    bioChanged,
    save,
  };
}

export function ProfileEditor({
  userId,
  canChangeNickname,
}: {
  readonly userId: string;
  readonly canChangeNickname: boolean;
}) {
  const editor = useProfileEditor(userId, canChangeNickname);
  if (editor.me === undefined || editor.profile === undefined) {
    return <Spinner label="Loading your profile" />;
  }
  if (editor.me === null || editor.profile === null) {
    return <Text tone="muted">Your workspace profile is unavailable.</Text>;
  }
  return (
    <View className="gap-3">
      {canChangeNickname && (
        <Input
          label="Workspace nickname"
          hint="Leave blank to use your account name."
          value={editor.nickname}
          onChangeText={editor.editNickname}
          maxLength={80}
        />
      )}
      <Input
        label="About you"
        hint="Visible to other members in this workspace."
        value={editor.bio}
        onChangeText={editor.editBio}
        multiline
        maxLength={500}
      />
      <Button
        loading={editor.busy}
        disabled={!editor.bioChanged && !(canChangeNickname && editor.nicknameChanged)}
        onPress={editor.save}
      >
        Save profile
      </Button>
      {editor.error !== null && (
        <Text tone="danger" accessibilityRole="alert">
          {editor.error}
        </Text>
      )}
      {editor.feedback !== null && <Text accessibilityLiveRegion="polite">{editor.feedback}</Text>}
    </View>
  );
}
