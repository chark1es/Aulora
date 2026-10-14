/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Input, Spinner, Text } from "@aulora/ui-native";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { ViewerProfileData } from "./use-chat-screen-data";

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
  profile,
  onSave,
}: {
  readonly userId: string;
  readonly canChangeNickname: boolean;
  /** A profile an offline surface already holds; when set the editor stays local. */
  readonly profile?: ViewerProfileData | null | undefined;
  /** Persists an offline edit for the life of the surface. */
  readonly onSave?: ((next: ViewerProfileData) => void) | undefined;
}) {
  if (profile != null) {
    return (
      <LocalProfileEditor canChangeNickname={canChangeNickname} initial={profile} onSave={onSave} />
    );
  }
  return <RemoteProfileEditor userId={userId} canChangeNickname={canChangeNickname} />;
}

function RemoteProfileEditor({
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

/** The offline demo's profile: edits stay on the device and never reach a server. */
function LocalProfileEditor({
  canChangeNickname,
  initial,
  onSave,
}: {
  readonly canChangeNickname: boolean;
  readonly initial: ViewerProfileData;
  readonly onSave?: ((next: ViewerProfileData) => void) | undefined;
}) {
  const savedNickname = initial.nickname ?? "";
  const [nickname, setNickname] = useState(savedNickname);
  const [bio, setBio] = useState(initial.bio);
  const [feedback, setFeedback] = useState<string | null>(null);
  const nicknameChanged = canChangeNickname && nickname.trim() !== savedNickname;
  const bioChanged = bio.trim() !== initial.bio;
  return (
    <View className="gap-3">
      {canChangeNickname && (
        <Input
          label="Workspace nickname"
          hint="Leave blank to use your account name."
          value={nickname}
          onChangeText={(value) => {
            setNickname(value);
            setFeedback(null);
          }}
          maxLength={80}
        />
      )}
      <Input
        label="About you"
        hint="Visible to other members in this workspace."
        value={bio}
        onChangeText={(value) => {
          setBio(value);
          setFeedback(null);
        }}
        multiline
        maxLength={500}
      />
      <Button
        disabled={!bioChanged && !nicknameChanged}
        onPress={() => {
          const next: ViewerProfileData = {
            nickname: nickname.trim().length > 0 ? nickname.trim() : null,
            bio: bio.trim(),
          };
          onSave?.(next);
          setFeedback("Saved in this offline demo only.");
        }}
      >
        Save profile
      </Button>
      {feedback !== null && <Text accessibilityLiveRegion="polite">{feedback}</Text>}
    </View>
  );
}
