/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { NativeAvatar, NativeBlobatar } from "@aulora/avatars/native";
import type { ServerProfile } from "@aulora/core";
import { fetchWellKnown, type WellKnown, WellKnownError } from "@aulora/core";
import { Button, Heading, Icon, IconButton, Text, usePalette } from "@aulora/ui-native";
import { ConvexReactClient } from "convex/react";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { SUPPORTED_API_VERSION } from "../lib/api-version";
import { shouldOpenReviewDemo } from "../lib/review-demo";
import { useEntrance, useReduceMotion } from "../lib/use-entrance";
import { useProfiles } from "../providers/ProfileProvider";
import { AuthField } from "./AuthField";
import { AuthScaffold } from "./AuthScaffold";
import { ThresholdAura } from "./ThresholdAura";

interface Preview {
  readonly baseUrl: string;
  readonly wellKnown: WellKnown;
}

interface Branding {
  readonly description: string;
  readonly logoUrl: string | null;
}

interface ConnectOutcome {
  readonly ok: boolean;
  readonly preview: Preview | null;
  readonly message: string;
}

/** A stable seed for the connect screen’s own blob field (no workspace yet). */
const CONNECT_SEED = "aulora:server:connect";

/**
 * The creature the person is currently conjuring, keyed off what they have
 * typed. Only the first label of the hostname feeds it, so the face settles as
 * soon as they name the server rather than squirming on every keystroke.
 */
function hostSeed(host: string): string {
  const label = host
    .trim()
    .toLowerCase()
    .split(".")
    .find((part) => part.length > 0);
  return label === undefined ? CONNECT_SEED : `aulora:server:${label}`;
}

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

/** Fetches and validates the well-known document, mapping errors to copy. */
async function discover(host: string): Promise<ConnectOutcome> {
  try {
    const wellKnown = await fetchWellKnown(host);
    if (wellKnown.apiVersion !== SUPPORTED_API_VERSION) {
      return {
        ok: false,
        preview: null,
        message: `This server speaks Aulora API v${wellKnown.apiVersion}; this client supports v${SUPPORTED_API_VERSION}.`,
      };
    }
    return { ok: true, preview: { baseUrl: host, wellKnown }, message: "" };
  } catch (caught) {
    return { ok: false, preview: null, message: messageForError(caught) };
  }
}

export interface ConnectScreenProps {
  readonly onConnected: () => void;
  /** Host prefilled from an `aulora://connect?server=…` deep link. */
  readonly initialHost?: string;
}

interface ConnectModel {
  readonly host: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly preview: Preview | null;
  readonly branding: Branding | null;
  readonly profiles: readonly ServerProfile[];
  readonly compact: boolean;
  readonly setHost: (value: string) => void;
  readonly connect: () => void;
  readonly save: () => void;
  readonly paste: () => void;
  readonly back: () => void;
  readonly switchTo: (profile: ServerProfile) => void;
  readonly removeProfile: (id: string) => void;
}

/** State and actions for the mobile connect screen. */
function useConnectModel(onConnected: () => void, initialHost: string | undefined): ConnectModel {
  const { addProfile, profiles, setActive, remove } = useProfiles();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [host, setHost] = useState(initialHost ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);

  async function connect() {
    setError(null);
    const value = host.trim();
    if (value.length === 0) {
      setError("Enter your workspace address to continue.");
      return;
    }
    // Store review reaches the offline demo by address on any platform; there is
    // no visible entry, and it closes once a real server profile is saved.
    if (shouldOpenReviewDemo(profiles.length, value)) {
      router.push("/review-demo");
      return;
    }
    setBusy(true);
    const outcome = await discover(value);
    if (outcome.preview !== null) {
      setPreview(outcome.preview);
      setBranding(null);
      void fetchBranding(outcome.preview.wellKnown.convexUrl).then(setBranding);
    } else if (outcome.message.length > 0) {
      setError(outcome.message);
    }
    setBusy(false);
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

  function paste() {
    void Clipboard.getStringAsync()
      .then((text) => {
        const value = text.trim();
        if (value.length > 0) {
          setHost(value);
        }
      })
      .catch(() => undefined);
  }

  function switchTo(profile: ServerProfile) {
    void setActive(profile.id)
      .then(onConnected)
      .catch(() => {
        setError("Could not open that workspace.");
      });
  }

  return {
    host,
    busy,
    error,
    preview,
    branding,
    profiles,
    compact: width < 480,
    setHost,
    connect: () => {
      void connect();
    },
    save: () => {
      void save();
    },
    paste,
    back: () => {
      setPreview(null);
      setError(null);
    },
    switchTo,
    removeProfile: (id) => {
      void remove(id);
    },
  };
}

function previewAura(
  preview: Preview,
  branding: Branding | null,
  size: number,
  reduceMotion: boolean | null,
) {
  if (branding?.logoUrl != null) {
    return (
      <Image
        source={{ uri: branding.logoUrl }}
        accessibilityLabel={`${preview.wellKnown.name} logo`}
        style={{ width: size, height: size, borderRadius: 24 }}
      />
    );
  }
  return (
    <ThresholdAura size={size} seed={preview.wellKnown.iconSeed} reduceMotion={reduceMotion}>
      <NativeBlobatar
        seed={preview.wellKnown.iconSeed}
        size={Math.round(size * 0.72)}
        title={preview.wellKnown.name}
      />
    </ThresholdAura>
  );
}

/** The placeholder hero on the entry step: a creature conjured from the host. */
function EntryAura({
  seed,
  reduceMotion,
}: {
  readonly seed: string;
  readonly reduceMotion: boolean | null;
}) {
  const { width } = useWindowDimensions();
  const size = width < 480 ? 124 : 148;
  return (
    <ThresholdAura size={size} seed={seed} reduceMotion={reduceMotion}>
      <NativeBlobatar seed={seed} size={Math.round(size * 0.74)} />
    </ThresholdAura>
  );
}

function RecentList({ model }: { readonly model: ConnectModel }) {
  const palette = usePalette();
  return (
    <View className="gap-1">
      <Text size="xs" tone="muted" className="font-semibold uppercase tracking-[0.09em]">
        Recent workspaces
      </Text>
      {model.profiles.map((profile) => (
        <View key={profile.id} className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${profile.name}`}
            onPress={() => {
              model.switchTo(profile);
            }}
            className="min-h-11 flex-1 flex-row items-center gap-3"
          >
            <NativeAvatar seed={profile.iconSeed} size={32} shape="squircle" />
            <View className="flex-1">
              <Text size="base" numberOfLines={1}>
                {profile.name}
              </Text>
              <Text size="xs" tone="muted" mono numberOfLines={1}>
                {profile.baseUrl}
              </Text>
            </View>
          </Pressable>
          <IconButton
            label={`Remove ${profile.name}`}
            size="sm"
            onPress={() => {
              model.removeProfile(profile.id);
            }}
          >
            <Icon name="x" color={palette["text-muted"]} />
          </IconButton>
        </View>
      ))}
    </View>
  );
}

function EntryStep({ model }: { readonly model: ConnectModel }) {
  const palette = usePalette();
  const reduceMotion = useReduceMotion();
  const { animatedStyle } = useEntrance(reduceMotion);
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
        <AuthScaffold
          seed={hostSeed(model.host)}
          reduceMotion={reduceMotion}
          aura={<EntryAura seed={hostSeed(model.host)} reduceMotion={reduceMotion} />}
          intro={
            <Animated.View style={animatedStyle}>
              <View className="gap-2">
                <Heading level={1}>Connect to your workspace</Heading>
                <Text size="base" tone="muted" className="leading-relaxed">
                  Enter the address your team gave you.
                </Text>
              </View>
            </Animated.View>
          }
        >
          <AuthField
            label="Server address"
            placeholder="chat.acme.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={model.host}
            onChangeText={model.setHost}
            onSubmitEditing={model.connect}
            returnKeyType="go"
            leading={<Icon name="link" color={palette["text-muted"]} />}
            trailing={
              <Button size="sm" variant="ghost" onPress={model.paste}>
                Paste
              </Button>
            }
            {...(model.error !== null ? { error: model.error } : {})}
          />
          <Button size="lg" loading={model.busy} onPress={model.connect}>
            Continue
          </Button>
          {model.profiles.length > 0 && <RecentList model={model} />}
        </AuthScaffold>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PreviewStep({ model }: { readonly model: ConnectModel }) {
  const reduceMotion = useReduceMotion();
  const { animatedStyle } = useEntrance(reduceMotion);
  const preview = model.preview;
  if (preview === null) {
    return null;
  }
  const { wellKnown } = preview;
  const description = model.branding?.description ?? "";
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
        <AuthScaffold
          seed={wellKnown.iconSeed}
          reduceMotion={reduceMotion}
          aura={previewAura(preview, model.branding, model.compact ? 124 : 148, reduceMotion)}
          intro={
            <Animated.View style={animatedStyle}>
              <View className="gap-1.5">
                <Heading level={1}>{wellKnown.name}</Heading>
                {description.length > 0 && (
                  <Text size="base" tone="muted">
                    {description}
                  </Text>
                )}
                <Text size="sm" tone="muted" mono>
                  {preview.baseUrl}
                </Text>
                <Text size="base" tone="muted">
                  Is this the workspace you’re looking for?
                </Text>
              </View>
            </Animated.View>
          }
        >
          <View className="border-y border-border py-3">
            <Text size="sm" tone="muted">
              Aulora v{wellKnown.version} · API v{wellKnown.apiVersion}
            </Text>
          </View>
          {model.error !== null && (
            <Text size="sm" tone="danger" accessibilityRole="alert">
              {model.error}
            </Text>
          )}
          <Button size="lg" loading={model.busy} onPress={model.save}>
            Continue
          </Button>
          <Button variant="ghost" className="self-start" disabled={model.busy} onPress={model.back}>
            Use a different server
          </Button>
        </AuthScaffold>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * First-launch entry point: enter a host, read `/.well-known/aulora.json`,
 * confirm the workspace and API version against its blobatar, then save the
 * server profile. Recent workspaces are one tap away.
 */
export function ConnectScreen({ onConnected, initialHost }: ConnectScreenProps) {
  const model = useConnectModel(onConnected, initialHost);
  return model.preview !== null ? <PreviewStep model={model} /> : <EntryStep model={model} />;
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
});
