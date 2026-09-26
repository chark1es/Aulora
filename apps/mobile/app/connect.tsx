import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConnectScreen } from "../src/components/ConnectScreen";
import { useProfiles } from "../src/providers/ProfileProvider";

/** Add another server; returns home once the profile is saved. */
export default function ConnectRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ server?: string }>();
  const { refresh } = useProfiles();
  const initialHost = typeof params.server === "string" ? params.server : undefined;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-1">
        <ConnectScreen
          {...(initialHost !== undefined ? { initialHost } : {})}
          onConnected={() => {
            void refresh();
            router.back();
          }}
        />
      </View>
    </SafeAreaView>
  );
}
