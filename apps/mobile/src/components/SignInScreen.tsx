import { NativeAvatar } from "@aulora/avatars/native";
import type { ServerProfile } from "@aulora/core";
import { Button, Heading, Input, Text } from "@aulora/ui-native";
import { useQuery } from "convex/react";
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
} from "react-native";
import { api } from "../../../../packages/convex/convex/_generated/api";
import {
  type AuloraAuthClient,
  authActionsFromClient,
  startProviderSignIn,
} from "../lib/auth-client";
import type { CookieStore } from "../lib/cookie-fetch";
import { useEntrance, useReduceMotion } from "../lib/use-entrance";
import { AuthScaffold } from "./AuthScaffold";
import { ThresholdAura } from "./ThresholdAura";

export interface SignInScreenProps {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
  readonly cookieStore: CookieStore;
  /** Opens the workspace switcher; omitted when no switcher is available. */
  readonly onOpenWorkspaces?: () => void;
  /** Leaves this server and returns to the connect screen. */
  readonly onConnectDifferentServer?: () => void;
}

/** The host (with port) of a profile's base URL, for the quiet server caption. */
function profileHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * Sign-in driven entirely by the server's well-known `auth` block: the local
 * form appears only when `auth.local.enabled`, a sign-up toggle only when
 * `auth.local.signup`, and one button per `auth.providers` entry. OAuth/OIDC
 * providers open Authorization Code + PKCE in the system browser and return via
 * `aulora://auth/callback`.
 */
export function SignInScreen({
  profile,
  authClient,
  cookieStore,
  onOpenWorkspaces,
  onConnectDifferentServer,
}: SignInScreenProps) {
  const local = profile.auth.local;
  const providers = profile.auth.providers;
  const actions = authActionsFromClient(authClient);
  const config = useQuery(api.server.publicConfig, {});
  const workspaceDescription = config?.description ?? "";
  const workspaceLogo = config?.logoUrl ?? null;
  const signupEnabled = config?.signupEnabled ?? local.signup;
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReduceMotion();
  const { animatedStyle } = useEntrance(reduceMotion);
  const { width } = useWindowDimensions();
  const compact = width < 480;
  const host = profileHost(profile.baseUrl);

  async function run(key: string, task: () => Promise<{ error: { message?: string } | null }>) {
    setError(null);
    setPending(key);
    try {
      const result = await task();
      if (result.error !== null) {
        setError(result.error.message ?? "That did not work. Check your details and try again.");
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPending(null);
    }
  }

  async function submitLocal() {
    if (mode === "sign-up") {
      await run("local", () => actions.signUpEmail({ email, password, name }));
    } else {
      await run("local", () => actions.signInEmail({ email, password }));
    }
  }

  async function signInWithProvider(providerId: string, type: "oauth" | "oidc") {
    setError(null);
    setPending(providerId);
    try {
      const result = await startProviderSignIn(authClient, cookieStore, providerId, type);
      if (result.status === "error") {
        setError(result.message);
      }
    } catch {
      setError("Could not open the sign-in browser.");
    } finally {
      setPending(null);
    }
  }

  const hasProviders = providers.length > 0;

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
          aura={
            workspaceLogo !== null ? (
              <Image
                source={{ uri: workspaceLogo }}
                accessibilityLabel={`${profile.name} logo`}
                style={{ width: compact ? 96 : 108, height: compact ? 96 : 108, borderRadius: 20 }}
              />
            ) : (
              <ThresholdAura size={compact ? 96 : 108} breathing>
                <NativeAvatar seed={profile.iconSeed} size={40} shape="squircle" />
              </ThresholdAura>
            )
          }
        >
          <Animated.View className="gap-2" style={animatedStyle}>
            <Heading level={1}>Sign in to {profile.name}</Heading>
            <Text size="base" tone="muted" className="leading-relaxed">
              {workspaceDescription.length > 0
                ? workspaceDescription
                : hasProviders || local.enabled
                  ? "Use one of the methods this server allows."
                  : "This server has no sign-in methods enabled yet."}
            </Text>
            {onOpenWorkspaces !== undefined ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Switch workspace, current ${profile.name}`}
                onPress={onOpenWorkspaces}
                className="flex-row items-center gap-1"
              >
                <Text size="xs" tone="muted" mono numberOfLines={1} ellipsizeMode="tail">
                  {host}
                </Text>
                <Text size="xs" tone="muted">
                  ⌄
                </Text>
              </Pressable>
            ) : (
              <Text size="xs" tone="muted" mono numberOfLines={1} ellipsizeMode="tail">
                {host}
              </Text>
            )}
          </Animated.View>

          {error !== null && (
            <Text size="sm" tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          )}

          {providers.map((provider) => (
            <Button
              key={provider.id}
              variant="secondary"
              size="lg"
              loading={pending === provider.id}
              disabled={pending !== null && pending !== provider.id}
              onPress={() => void signInWithProvider(provider.id, provider.type)}
            >
              Continue with {provider.displayName}
            </Button>
          ))}

          {hasProviders && local.enabled && (
            <Text size="xs" tone="muted" className="text-center">
              or
            </Text>
          )}

          {local.enabled && (
            <Animated.View className="gap-4" style={animatedStyle}>
              {mode === "sign-up" && (
                <Input
                  size="lg"
                  label="Name"
                  autoComplete="name"
                  value={name}
                  onChangeText={setName}
                />
              )}
              <Input
                size="lg"
                label="Email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
              <Input
                size="lg"
                label="Password"
                secureTextEntry
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                value={password}
                onChangeText={setPassword}
              />
              <Button
                size="lg"
                loading={pending === "local"}
                disabled={pending !== null}
                onPress={() => void submitLocal()}
              >
                {mode === "sign-up" ? "Create account" : "Sign in"}
              </Button>
              {signupEnabled && (
                <Button
                  variant="ghost"
                  disabled={pending !== null}
                  onPress={() => {
                    setError(null);
                    setMode(mode === "sign-up" ? "sign-in" : "sign-up");
                  }}
                >
                  {mode === "sign-up" ? "Already have an account? Sign in" : "Create an account"}
                </Button>
              )}
            </Animated.View>
          )}

          {onConnectDifferentServer !== undefined && (
            <Button variant="ghost" disabled={pending !== null} onPress={onConnectDifferentServer}>
              Use a different server
            </Button>
          )}
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
