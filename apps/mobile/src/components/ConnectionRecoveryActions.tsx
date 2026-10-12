/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button } from "@aulora/ui-native";
import { Alert, View } from "react-native";

export interface ConnectionRecoveryActionsProps {
  /** Named in the removal confirmation; omit when the name is unknown. */
  readonly serverName?: string;
  /** Only saved servers can be removed; absent profiles hide the action. */
  readonly canRemoveServer?: boolean;
  readonly onRetry: () => void;
  readonly onSwitchServer: () => void;
  readonly onRemoveServer?: () => void;
}

/**
 * The recovery stack shown when a server-dependent wait runs too long: retry
 * the connection, remove the saved server, or switch to a different one.
 * Removal confirms first; the caller decides what removal does.
 */
export function ConnectionRecoveryActions(props: ConnectionRecoveryActionsProps) {
  const { serverName, canRemoveServer = false, onRetry, onSwitchServer, onRemoveServer } = props;
  const remove = canRemoveServer ? onRemoveServer : undefined;

  return (
    <View className="items-center gap-2">
      <Button onPress={onRetry}>Try again</Button>
      <Button variant="ghost" onPress={onSwitchServer}>
        Use a different server
      </Button>
      {remove !== undefined && (
        <Button
          variant="ghost"
          onPress={() => {
            confirmRemoveServer(serverName, remove);
          }}
        >
          Remove this server
        </Button>
      )}
    </View>
  );
}

/** Confirms a destructive server removal before the caller acts on it. */
function confirmRemoveServer(serverName: string | undefined, onRemove: () => void): void {
  Alert.alert(
    "Remove this server?",
    serverName !== undefined
      ? `Aulora will forget ${serverName} on this device. You can add it again later.`
      : "Aulora will forget this server on this device. You can add it again later.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          onRemove();
        },
      },
    ],
  );
}
