import { notifyAuthChanged, notifyAuthError } from "@aulora/core";
import { Spinner, Text } from "@aulora/ui-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { ScreenContainer } from "../../src/components/layout/ScreenContainer";
import { ThresholdAura } from "../../src/components/ThresholdAura";
import { completeAuthCallback } from "../../src/lib/auth-callback";
import { createMobileProfileStore } from "../../src/lib/profiles";

/**
 * Deep-link target for `aulora://auth/callback`. The link may carry only a
 * short-lived handoff code; the session is obtained by exchanging it with the
 * verifier this install kept when sign-in started. A session cookie is never
 * accepted from a deep link.
 *
 * The persist step never rejects, so a malformed code or an unreadable store
 * still lands the person back on the sign-in/chat surface instead of leaving
 * this spinner up for good.
 */
export default function AuthCallbackRoute() {
  const params = useLocalSearchParams<{
    code?: string;
    server?: string;
    tx?: string;
    error?: string;
  }>();
  const router = useRouter();
  const code = typeof params.code === "string" ? params.code : undefined;
  const server = typeof params.server === "string" ? params.server : undefined;
  const tx = typeof params.tx === "string" ? params.tx : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  useEffect(() => {
    const state = { cancelled: false };
    void (async () => {
      const active = await createMobileProfileStore(AsyncStorage)
        .getActive()
        .catch(() => undefined);
      await completeAuthCallback(AsyncStorage, {
        code,
        server,
        tx,
        error,
        currentServer: active?.siteUrl,
        initialUrl: () => Linking.getInitialURL(),
      });
      if (!state.cancelled) {
        notifyAuthChanged();
        notifyAuthError();
        router.replace("/");
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, [code, server, tx, error, router]);

  return (
    <ScreenContainer className="flex-1 items-center justify-center gap-4 bg-bg">
      <ThresholdAura size={132} breathing />
      <Spinner size={28} label="Completing sign-in" />
      <Text size="base" tone="muted">
        Completing sign-in…
      </Text>
    </ScreenContainer>
  );
}
