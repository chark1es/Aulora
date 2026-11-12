import { Spinner } from "@aulora/ui-native";
import { Redirect, useRouter } from "expo-router";
import { ScreenContainer } from "../src/components/layout/ScreenContainer";
import { ReviewDemoScreen } from "../src/components/ReviewDemoScreen";
import { useProfiles } from "../src/providers/ProfileProvider";

/** Reached by entering the review demo address on Connect; no saved servers, iOS or Android. */
export default function ReviewDemoRoute() {
  const router = useRouter();
  const { profiles, ready } = useProfiles();
  if (profiles.length > 0) return <Redirect href="/" />;
  if (!ready)
    return (
      <ScreenContainer className="flex-1 items-center justify-center bg-bg">
        <Spinner label="Loading servers" />
      </ScreenContainer>
    );
  return (
    <ReviewDemoScreen
      onExit={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/");
      }}
    />
  );
}
