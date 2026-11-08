import type { ClientVersionPolicy } from "@aulora/core";
import { Button, Heading, Text } from "@aulora/ui-native";
import { Linking, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MOBILE_CLIENT_VERSION, MOBILE_STORE_URL } from "../lib/client-version";

/**
 * Blocks a native client older than the server's minimum version. Mobile has no
 * in-app updater, so the action opens the platform's store or beta channel.
 */
export function ClientVersionRequired({ policy }: { readonly policy: ClientVersionPolicy }) {
  const minimum = policy.minClientVersion ?? "a newer release";
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Heading level={2}>Update required</Heading>
        <Text tone="muted" size="base" className="text-center">
          This workspace needs Aulora v{minimum} or newer. You are running{" "}
          {MOBILE_CLIENT_VERSION === "0.0.0-dev"
            ? "a development build"
            : `v${MOBILE_CLIENT_VERSION}`}
          .
        </Text>
        <Text tone="muted" size="sm" className="text-center">
          Install the newer build before signing in so your messages and calls stay compatible with
          the server.
        </Text>
        <Button onPress={() => void Linking.openURL(MOBILE_STORE_URL)}>Open store</Button>
      </View>
    </SafeAreaView>
  );
}
