import { Spinner, Text } from "@aulora/ui-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { ThresholdAura } from "../../src/components/ThresholdAura";
import { completeAuthCallback } from "../../src/lib/auth-callback";

/**
 * Deep-link target for `aulora://auth/callback`. Better Auth appends the
 * freshly minted session cookie to the redirect; persist it, then return home
 * so the session query picks it up.
 *
 * The persist step never rejects, so a malformed cookie or an unreadable store
 * still lands the person back on the sign-in/chat surface instead of leaving
 * this spinner up for good.
 */
export default function AuthCallbackRoute() {
  const params = useLocalSearchParams<{ cookie?: string }>();
  const router = useRouter();
  const cookie = typeof params.cookie === "string" ? params.cookie : undefined;

  useEffect(() => {
    const state = { cancelled: false };
    void (async () => {
      await completeAuthCallback(AsyncStorage, {
        cookie,
        initialUrl: () => Linking.getInitialURL(),
      });
      if (!state.cancelled) {
        router.replace("/");
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, [cookie, router]);

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg">
      <ThresholdAura size={132} breathing />
      <Spinner size={28} label="Completing sign-in" />
      <Text size="base" tone="muted">
        Completing sign-in…
      </Text>
    </View>
  );
}
