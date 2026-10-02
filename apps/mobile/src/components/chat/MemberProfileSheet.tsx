import type { PresenceRow } from "@aulora/core";
import { Button, Spinner, Text, usePalette } from "@aulora/ui-native";
import { useQuery } from "convex/react";
import { View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { presenceLabel } from "../../lib/presence";
import { BottomSheet } from "./BottomSheet";
import { ListGroup, ListRow } from "./List";
import { PresenceAvatar } from "./PresenceAvatar";

export function MemberProfileSheet({
  visible,
  userId,
  displayName,
  presence,
  ownUserId,
  onMessage,
  onNote,
  onModerate,
  onClose,
}: {
  readonly visible: boolean;
  readonly userId: string;
  readonly displayName: string;
  readonly presence: PresenceRow | undefined;
  readonly ownUserId: string;
  readonly onMessage: () => void;
  readonly onNote: () => void;
  /** Present when the viewer may kick, ban or time out this member. */
  readonly onModerate?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const palette = usePalette();
  const profile = useQuery(api.members.profile, visible ? { userId } : "skip");
  const status = presence?.status ?? "offline";
  const custom = presence?.customStatus ?? "";
  return (
    <BottomSheet
      visible={visible}
      title={displayName}
      onClose={onClose}
      header={
        <View className="flex-row items-center gap-4">
          <PresenceAvatar
            userId={userId}
            status={status}
            size={64}
            surface={palette["surface-1"]}
          />
          <View className="min-w-0 flex-1">
            <Text size="lg" className="font-semibold" numberOfLines={1} accessibilityRole="header">
              {displayName}
            </Text>
            <Text size="sm" tone="muted" numberOfLines={2}>
              {custom.length > 0 ? custom : presenceLabel(status)}
            </Text>
          </View>
        </View>
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
          <View className="gap-1 rounded-card bg-surface-2 p-4">
            <Text size="xs" tone="muted" className="font-semibold uppercase tracking-wider">
              About
            </Text>
            <Text tone={profile.bio ? "default" : "muted"}>{profile.bio || "No bio yet."}</Text>
            {status === "offline" && profile.lastOnlineAt !== null && (
              <Text tone="muted" size="xs" className="pt-1">
                Last online {new Date(profile.lastOnlineAt).toLocaleString()}
              </Text>
            )}
          </View>
          {userId !== ownUserId && <Button onPress={onMessage}>Message</Button>}
          <ListGroup>
            <ListRow
              icon="note"
              title="Private note"
              subtitle="Only you can see it"
              onPress={onNote}
            />
            {onModerate !== undefined && (
              <ListRow
                icon="shield"
                title="Moderate"
                subtitle="Time out, kick or ban"
                onPress={onModerate}
              />
            )}
          </ListGroup>
        </>
      )}
    </BottomSheet>
  );
}
