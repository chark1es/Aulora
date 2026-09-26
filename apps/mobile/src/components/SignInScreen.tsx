import type { ServerProfile } from "@aulora/core";
import { Button, Card, Heading, Input, Text } from "@aulora/ui-native";
import { useState } from "react";
import { View } from "react-native";
import {
  type AuloraAuthClient,
  authActionsFromClient,
  startProviderSignIn,
} from "../lib/auth-client";
import type { CookieStore } from "../lib/cookie-fetch";

export interface SignInScreenProps {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
  readonly cookieStore: CookieStore;
}

/**
 * Sign-in driven entirely by the server's well-known `auth` block: the local
 * form appears only when `auth.local.enabled`, a sign-up toggle only when
 * `auth.local.signup`, and one button per `auth.providers` entry. OAuth/OIDC
 * providers open Authorization Code + PKCE in the system browser and return via
 * `aulora://auth/callback`.
 */
export function SignInScreen({ profile, authClient, cookieStore }: SignInScreenProps) {
  const local = profile.auth.local;
  const providers = profile.auth.providers;
  const actions = authActionsFromClient(authClient);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <View className="flex-1 justify-center p-6">
      <Card className="gap-5">
        <View className="gap-1">
          <Heading level={2}>Sign in to {profile.name}</Heading>
          <Text size="sm" tone="muted">
            {hasProviders || local.enabled
              ? "Use one of the methods this server allows."
              : "This server has no sign-in methods enabled yet."}
          </Text>
        </View>

        {error !== null && (
          <Text size="sm" tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        )}

        {providers.map((provider) => (
          <Button
            key={provider.id}
            variant="secondary"
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
          <View className="gap-4">
            {mode === "sign-up" && (
              <Input label="Name" autoComplete="name" value={name} onChangeText={setName} />
            )}
            <Input
              label="Email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />
            <Input
              label="Password"
              secureTextEntry
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              value={password}
              onChangeText={setPassword}
            />
            <Button
              loading={pending === "local"}
              disabled={pending !== null}
              onPress={() => void submitLocal()}
            >
              {mode === "sign-up" ? "Create account" : "Sign in"}
            </Button>
            {local.signup && (
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
          </View>
        )}
      </Card>
    </View>
  );
}
