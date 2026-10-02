import { Button, Text } from "@aulora/ui-native";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { Sheet } from "./Sheet";

export interface BannedMembersSheetProps {
  readonly visible: boolean;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly onClose: () => void;
}

function expiryLabel(expiresAt: number | null): string {
  if (expiresAt === null) {
    return "Permanent";
  }
  return `Until ${new Date(expiresAt).toLocaleDateString()}`;
}

/**
 * The workspace ban list, mirroring the web admin panel: only mounted when the
 * viewer holds `Ban`, reads `members.listBans`, and lifts a ban in place.
 */
export function BannedMembersSheet({ visible, memberNames, onClose }: BannedMembersSheetProps) {
  const bans = useQuery(api.members.listBans, visible ? {} : "skip");
  const unban = useMutation(api.members.unban);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = bans ?? [];

  return (
    <Sheet visible={visible} title="Banned members" dismiss="done" onClose={onClose}>
      <View className="flex-1 p-4">
        <Text size="xs" tone="muted" className="mt-1">
          People who cannot rejoin until they are unbanned.
        </Text>
        <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 12 }}>
          {rows.length === 0 && (
            <Text size="sm" tone="muted">
              No banned members.
            </Text>
          )}
          {rows.map((entry) => (
            <View
              key={entry.id}
              className="flex-row items-center gap-3 rounded-input border border-border bg-surface-2 px-3 py-2"
            >
              <View className="min-w-0 flex-1">
                <Text size="sm">{memberNames.get(entry.userId) ?? entry.userId}</Text>
                <Text size="xs" tone="muted">
                  {expiryLabel(entry.expiresAt)}
                  {entry.reason !== null && entry.reason.length > 0 ? ` · ${entry.reason}` : ""}
                </Text>
              </View>
              <Button
                size="sm"
                variant="secondary"
                loading={busyId === entry.id}
                disabled={busyId !== null}
                onPress={() => {
                  setBusyId(entry.id);
                  void Promise.resolve(unban({ userId: entry.userId }))
                    .catch(() => {
                      Alert.alert("Couldn't unban member", "Try again when you are connected.");
                    })
                    .finally(() => {
                      setBusyId(null);
                    });
                }}
              >
                Unban
              </Button>
            </View>
          ))}
        </ScrollView>
      </View>
    </Sheet>
  );
}
