import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { ConnectScreen } from "../src/components/ConnectScreen";
import { ScreenContainer } from "../src/components/layout/ScreenContainer";
import { useProfiles } from "../src/providers/ProfileProvider";

/** Add another server; returns home once the profile is saved. */
export default function ConnectRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ server?: string }>();
  const { refresh } = useProfiles();
  const initialHost = typeof params.server === "string" ? params.server : undefined;

  return (
    <ScreenContainer className="flex-1 bg-bg">
      <View className="flex-1">
        <ConnectScreen
          {...(initialHost !== undefined ? { initialHost } : {})}
          onConnected={() => {
            void refresh();
            // A deep link can open this route as the only entry, so there may
            // be nothing to go back to.
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/");
            }
          }}
        />
      </View>
    </ScreenContainer>
  );
}
