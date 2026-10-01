import { Spinner } from "@aulora/ui-native";
import { Redirect, useRouter } from "expo-router";
import { Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReviewDemoScreen } from "../src/components/ReviewDemoScreen";
import { useProfiles } from "../src/providers/ProfileProvider";

/** Review entry is public and documented, but only offered on iOS. */
export default function ReviewDemoRoute() {
  const router = useRouter();
  const { profiles, ready } = useProfiles();
  if (Platform.OS !== "ios" || profiles.length > 0) return <Redirect href="/" />;
  if (!ready)
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg">
        <Spinner label="Loading servers" />
      </SafeAreaView>
    );
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <ReviewDemoScreen
        onExit={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/");
        }}
      />
    </SafeAreaView>
  );
}
