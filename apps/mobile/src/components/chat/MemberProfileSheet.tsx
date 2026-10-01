import { Button, Spinner, Text } from "@aulora/ui-native";
import { useQuery } from "convex/react";
import { ScrollView } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { MemberAvatar } from "./MemberAvatar";
import { Sheet } from "./Sheet";

export function MemberProfileSheet({
  userId,
  displayName,
  ownUserId,
  onMessage,
  onNote,
  onClose,
}: {
  readonly userId: string;
  readonly displayName: string;
  readonly ownUserId: string;
  readonly onMessage: () => void;
  readonly onNote: () => void;
  readonly onClose: () => void;
}) {
  const profile = useQuery(api.members.profile, { userId });
  return (
    <Sheet visible title={displayName} onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <MemberAvatar userId={userId} size={64} title={displayName} />
        {profile === undefined ? (
          <Spinner label="Loading profile" />
        ) : profile === null ? (
          <Text tone="muted">This person is no longer in the workspace.</Text>
        ) : (
          <>
            <Text>{profile.bio || "No bio yet."}</Text>
            {profile.lastOnlineAt !== null && (
              <Text tone="muted" size="sm">
                Last online {new Date(profile.lastOnlineAt).toLocaleString()}
              </Text>
            )}
            {userId !== ownUserId && <Button onPress={onMessage}>Message</Button>}
            <Button variant="secondary" onPress={onNote}>
              Private note
            </Button>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}
