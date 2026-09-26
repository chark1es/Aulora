import { useRouter } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConnectScreen } from "../src/components/ConnectScreen";
import { useProfiles } from "../src/providers/ProfileProvider";

/** Add another server; returns home once the profile is saved. */
export default function ConnectRoute() {
  const router = useRouter();
  const { refresh } = useProfiles();

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-1">
        <ConnectScreen
          onConnected={() => {
            void refresh();
            router.back();
          }}
        />
      </View>
    </SafeAreaView>
  );
}
