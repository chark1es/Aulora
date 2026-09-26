import { Spinner, Text } from "@aulora/ui-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { AUTH_COOKIE_KEY, storeRedirectCookie } from "../../src/lib/cookie-fetch";

/**
 * Deep-link target for `aulora://auth/callback`. Better Auth appends the
 * freshly minted session cookie to the redirect; persist it, then return home
 * so the session query picks it up.
 */
export default function AuthCallbackRoute() {
  const params = useLocalSearchParams<{ cookie?: string }>();
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      const cookie = typeof params.cookie === "string" ? params.cookie : undefined;
      if (cookie !== undefined && cookie.length > 0) {
        await AsyncStorage.setItem(AUTH_COOKIE_KEY, decodeURIComponent(cookie));
      } else {
        const initial = await Linking.getInitialURL();
        if (initial !== null) {
          await storeRedirectCookie(AsyncStorage, initial);
        }
      }
      router.replace("/");
    })();
  }, [params.cookie, router]);

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-bg">
      <Spinner size={28} label="Completing sign-in" />
      <Text size="sm" tone="muted">
        Completing sign-in…
      </Text>
    </View>
  );
}
