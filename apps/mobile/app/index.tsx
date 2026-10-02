import { Button, Spinner } from "@aulora/ui-native";
import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConnectScreen } from "../src/components/ConnectScreen";
import { WorkspaceSwitcherSheet } from "../src/components/chat/WorkspaceSwitcherSheet";
import { ServerSession } from "../src/components/ServerSession";
import { useProfiles } from "../src/providers/ProfileProvider";

/**
 * Home: the active server's connect screen or session. The workspace name is
 * the switcher; a compact trigger sits top-right before a session is signed in.
 */
export default function IndexScreen() {
  const { activeProfile, profiles, ready, refresh } = useProfiles();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <Spinner size={28} label="Loading servers" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {activeProfile === undefined ? (
        <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
          {profiles.length > 0 && (
            <View className="items-end px-4 pt-2">
              <Button size="sm" variant="secondary" onPress={() => setSwitcherOpen(true)}>
                Switch workspace
              </Button>
            </View>
          )}
          <ConnectScreen onConnected={() => void refresh()} />
        </SafeAreaView>
      ) : (
        <ServerSession key={activeProfile.id} profile={activeProfile} />
      )}

      <WorkspaceSwitcherSheet visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </View>
  );
}
