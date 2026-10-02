import { Button, Spinner, Text, usePalette } from "@aulora/ui-native";
import { useQuery } from "convex/react";
import { View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { presenceLabel } from "../../lib/presence";
import { BottomSheet } from "./BottomSheet";
import { ListGroup, ListRow } from "./List";
import { PresenceAvatar } from "./PresenceAvatar";

export interface MemberProfileSheetProps {
  readonly visible: boolean;
  readonly userId: string;
  readonly displayName: string;
  /** Presence status, such as `online`; `offline` when they have no presence row. */
  readonly status: string;
  readonly customStatus: string;
  readonly ownUserId: string;
  readonly onMessage: () => void;
  readonly onNote: () => void;
  /** Present when the viewer may kick, ban or time out this member. */
  readonly onModerate?: (() => void) | undefined;
  readonly onClose: () => void;
}

interface ProfileHeaderProps {
  readonly userId: string;
  readonly displayName: string;
  readonly status: string;
  readonly customStatus: string;
}

function ProfileHeader({ userId, displayName, status, customStatus }: ProfileHeaderProps) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-4">
      <PresenceAvatar userId={userId} status={status} size={64} surface={palette["surface-1"]} />
      <View className="min-w-0 flex-1">
        <Text size="lg" className="font-semibold" numberOfLines={1} accessibilityRole="header">
          {displayName}
        </Text>
        <Text size="sm" tone="muted" numberOfLines={2}>
          {customStatus.length > 0 ? customStatus : presenceLabel(status)}
        </Text>
      </View>
    </View>
  );
}

interface ProfileAboutProps {
  readonly bio: string;
  /** Shown only for someone who is offline. */
  readonly lastOnlineAt: number | null;
}

function ProfileAbout({ bio, lastOnlineAt }: ProfileAboutProps) {
  return (
    <View className="gap-1 rounded-card bg-surface-2 p-4">
      <Text size="sm" tone="muted" className="font-semibold">
        About
      </Text>
      <Text tone={bio.length > 0 ? "default" : "muted"}>
        {bio.length > 0 ? bio : "No bio yet."}
      </Text>
      {lastOnlineAt !== null && (
        <Text tone="muted" size="xs" className="pt-1">
          Last online {new Date(lastOnlineAt).toLocaleString()}
        </Text>
      )}
    </View>
  );
}

interface ProfileActionsProps {
  readonly onNote: () => void;
  readonly onModerate: (() => void) | undefined;
}

function ProfileActions({ onNote, onModerate }: ProfileActionsProps) {
  return (
    <ListGroup>
      <ListRow icon="note" title="Private note" subtitle="Only you can see it" onPress={onNote} />
      {onModerate !== undefined && (
        <ListRow
          icon="shield"
          title="Moderate"
          subtitle="Time out, kick or ban"
          onPress={onModerate}
        />
      )}
    </ListGroup>
  );
}

export function MemberProfileSheet(props: MemberProfileSheetProps) {
  const { visible, userId, displayName, status } = props;
  const profile = useQuery(api.members.profile, visible ? { userId } : "skip");
  return (
    <BottomSheet
      visible={visible}
      title={displayName}
      onClose={props.onClose}
      header={
        <ProfileHeader
          userId={userId}
          displayName={displayName}
          status={status}
          customStatus={props.customStatus}
        />
      }
    >
      {profile === undefined ? (
        <View className="items-center py-6">
          <Spinner label="Loading profile" />
        </View>
      ) : profile === null ? (
        <Text tone="muted">This person is no longer in the workspace.</Text>
      ) : (
        <>
          <ProfileAbout
            bio={profile.bio ?? ""}
            lastOnlineAt={status === "offline" ? profile.lastOnlineAt : null}
          />
          {userId !== props.ownUserId && <Button onPress={props.onMessage}>Message</Button>}
          <ProfileActions onNote={props.onNote} onModerate={props.onModerate} />
        </>
      )}
    </BottomSheet>
  );
}
