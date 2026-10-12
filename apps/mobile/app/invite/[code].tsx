import { Spinner, Text } from "@aulora/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { setPendingInvite } from "../../src/lib/pending-invite";

/**
 * Deep-link target for `aulora://invite/<code>`. The code is held until the
 * person is signed in; the join screen then offers it ready to accept.
 */
export default function InviteRoute() {
  const params = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();

  useEffect(() => {
    setPendingInvite(typeof params.code === "string" ? params.code : null);
    router.replace("/");
  }, [params.code, router]);

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg">
      <Spinner size={28} label="Opening invite" />
      <Text size="base" tone="muted">
        Opening invite…
      </Text>
    </View>
  );
}
