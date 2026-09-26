import { Spinner } from "@aulora/ui-native";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConnectScreen } from "../src/components/ConnectScreen";
import { ServerRail } from "../src/components/ServerRail";
import { ServerSession } from "../src/components/ServerSession";
import { useProfiles } from "../src/providers/ProfileProvider";

/** Home: the server rail plus, for the active server, connect or the session. */
export default function IndexScreen() {
  const { activeProfile, ready, refresh } = useProfiles();
  const router = useRouter();

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <Spinner size={28} label="Loading servers" />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 flex-row bg-bg" edges={["top", "bottom"]}>
      <ServerRail onAddServer={() => router.push("/connect")} />
      <View className="flex-1">
        {activeProfile === undefined ? (
          <ConnectScreen onConnected={() => void refresh()} />
        ) : (
          <ServerSession profile={activeProfile} />
        )}
      </View>
    </SafeAreaView>
  );
}
