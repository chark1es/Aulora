import { NativeAvatar } from "@aulora/avatars/native";
import { fetchWellKnown, type WellKnown, WellKnownError } from "@aulora/core";
import { Button, Heading, Input, Text } from "@aulora/ui-native";
import { ConvexReactClient } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { SUPPORTED_API_VERSION } from "../lib/api-version";
import { isReviewDemoAddress } from "../lib/review-demo";
import { useEntrance, useReduceMotion } from "../lib/use-entrance";
import { useProfiles } from "../providers/ProfileProvider";
import { AuthScaffold } from "./AuthScaffold";
import { ThresholdAura } from "./ThresholdAura";

function messageForError(error: unknown): string {
  if (error instanceof WellKnownError) {
    switch (error.code) {
      case "HTTP_ERROR":
        return "That server answered, but did not serve an Aulora well-known document.";
      case "SECRET_FIELD":
        return "That server's well-known document contained a field Aulora refuses to use.";
      case "NETWORK_ERROR":
        return "Could not reach that server. Check the address and your connection.";
      default:
        return "That server could not be used.";
    }
  }
  return "Enter a valid server address, like chat.acme.com.";
}

interface Preview {
  readonly baseUrl: string;
  readonly wellKnown: WellKnown;
}

interface Branding {
  readonly description: string;
  readonly logoUrl: string | null;
}

/** Best-effort branding (description/logo) read from the server's public config. */
async function fetchBranding(convexUrl: string): Promise<Branding> {
  const client = new ConvexReactClient(convexUrl);
  try {
    const config = await client.query(api.server.publicConfig, {});
    return { description: config.description ?? "", logoUrl: config.logoUrl ?? null };
  } catch {
    return { description: "", logoUrl: null };
  } finally {
    client.close();
  }
}

/**
 * First-launch entry point: enter a host, read `/.well-known/aulora.json`,
 * confirm the workspace and API version, then save the server profile.
 */
export function ConnectScreen({
  onConnected,
  initialHost,
}: {
  readonly onConnected: () => void;
  /** Host prefilled from an `aulora://connect?server=…` deep link. */
  readonly initialHost?: string;
}) {
  const { addProfile, profiles } = useProfiles();
  const router = useRouter();
  const [host, setHost] = useState(initialHost ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const reduceMotion = useReduceMotion();
  const { animatedStyle } = useEntrance(reduceMotion);
  const { width } = useWindowDimensions();
  const compact = width < 480;

  async function connect() {
    setError(null);
    if (host.trim().length === 0) {
      return;
    }
    // App Review reaches the offline demo by address; there is no visible entry.
    if (Platform.OS === "ios" && profiles.length === 0 && isReviewDemoAddress(host)) {
      router.push("/review-demo");
      return;
    }
    setBusy(true);
    try {
      const wellKnown = await fetchWellKnown(host);
      if (wellKnown.apiVersion !== SUPPORTED_API_VERSION) {
        setError(
          `This server speaks Aulora API v${wellKnown.apiVersion}; this client supports v${SUPPORTED_API_VERSION}.`,
        );
        return;
      }
      setPreview({ baseUrl: host, wellKnown });
      setBranding(null);
      void fetchBranding(wellKnown.convexUrl).then(setBranding);
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (preview === null) {
      return;
    }
    setBusy(true);
    try {
      await addProfile(preview.baseUrl, preview.wellKnown);
      onConnected();
    } catch {
      setError("Could not save this server profile.");
    } finally {
      setBusy(false);
    }
  }

  if (preview !== null) {
    return (
      <AuthScaffold
        aura={
          branding?.logoUrl != null ? (
            <Image
              source={{ uri: branding.logoUrl }}
              accessibilityLabel={`${preview.wellKnown.name} logo`}
              style={{
                width: compact ? 124 : 140,
                height: compact ? 124 : 140,
                borderRadius: 24,
              }}
            />
          ) : (
            <ThresholdAura size={compact ? 124 : 140} breathing>
              <NativeAvatar
                seed={preview.wellKnown.iconSeed}
                size={56}
                title={preview.wellKnown.name}
              />
            </ThresholdAura>
          )
        }
      >
        <View className="items-center gap-1.5">
          <Heading level={1} className="text-center">
            {preview.wellKnown.name}
          </Heading>
          {branding !== null && branding.description.length > 0 && (
            <Text size="sm" tone="muted" className="text-center">
              {branding.description}
            </Text>
          )}
          <Text size="sm" tone="muted" mono className="text-center">
            {preview.baseUrl}
          </Text>
          <Text size="sm" tone="muted" className="text-center">
            Aulora v{preview.wellKnown.version} · API v{preview.wellKnown.apiVersion}
          </Text>
        </View>
        {error !== null && (
          <Text size="sm" tone="danger" accessibilityRole="alert" className="text-center">
            {error}
          </Text>
        )}
        <View className="w-full gap-3">
          <Button size="lg" loading={busy} onPress={() => void save()}>
            Continue
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setPreview(null);
              setError(null);
            }}
          >
            Use a different server
          </Button>
        </View>
      </AuthScaffold>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AuthScaffold aura={<ThresholdAura size={compact ? 124 : 140} breathing />}>
          <Animated.View className="gap-2" style={animatedStyle}>
            <Heading level={1}>Connect to a server</Heading>
            <Text size="base" tone="muted" className="leading-relaxed">
              Point Aulora at your team's server to open the hall.
            </Text>
          </Animated.View>
          <Animated.View className="gap-4" style={animatedStyle}>
            <Input
              size="lg"
              label="Server address"
              hint="Your server's host, e.g. chat.acme.com."
              placeholder="chat.acme.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={host}
              onChangeText={setHost}
              onSubmitEditing={() => void connect()}
              returnKeyType="go"
              {...(error !== null ? { error } : {})}
            />
            <Button
              size="lg"
              loading={busy}
              disabled={host.trim().length === 0}
              onPress={() => void connect()}
            >
              Connect
            </Button>
          </Animated.View>
        </AuthScaffold>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
});
