import { NativeBlobatar } from "@aulora/avatars/native";
import { assessOwnerPassword, OWNER_PASSWORD_MIN_LENGTH, type ServerProfile } from "@aulora/core";
import { Button, Heading, Text, usePalette } from "@aulora/ui-native";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { View } from "react-native";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { type AuloraAuthClient, authActionsFromClient } from "../lib/auth-client";
import { AuthField } from "./AuthField";
import { AuthScaffold, AuthScroll } from "./AuthScaffold";

export interface SetupScreenProps {
  readonly profile: ServerProfile;
  readonly authClient: AuloraAuthClient;
  readonly onConnectDifferentServer?: () => void;
}

interface SetupValues {
  readonly token: string;
  readonly workspaceName: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

function initialValues(profile: ServerProfile): SetupValues {
  return {
    token: "",
    workspaceName: profile.name === "Aulora" ? "" : profile.name,
    name: "",
    email: "",
    password: "",
  };
}

function StrengthMeter({
  password,
  minLength,
}: {
  readonly password: string;
  readonly minLength: number;
}) {
  const palette = usePalette();
  const assessment = assessOwnerPassword(password, minLength);
  const filled =
    assessment.score === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((assessment.score / 4) * 4)));
  const color =
    assessment.score >= 3
      ? palette.accent
      : assessment.score === 2
        ? palette["text-muted"]
        : palette.danger;
  return (
    <View className="gap-1.5" accessibilityLiveRegion="polite">
      <View className="flex-row gap-1" accessibilityElementsHidden importantForAccessibility="no">
        {["one", "two", "three", "four"].map((bar, index) => (
          <View
            key={bar}
            className="h-1 flex-1 rounded-full min-w-0"
            style={{ backgroundColor: index < filled ? color : palette.border }}
          />
        ))}
      </View>
      <Text size="xs" tone="muted">
        {password.length === 0
          ? `At least ${minLength} characters. A 16+ character passphrase is strongest.`
          : (assessment.problem ??
            `${assessment.score >= 3 ? "Strong" : "Usable"} password. Use 16+ characters or mix three character classes.`)}
      </Text>
    </View>
  );
}

/**
 * First-run claim screen for a fresh instance. The one-time setup token is
 * printed by the setup container and stored server-side only as a hash.
 */
export function SetupScreen({ profile, authClient, onConnectDifferentServer }: SetupScreenProps) {
  const initialize = useAction(api.setup.initialize);
  const liveConfig = useQuery(api.server.publicConfig, {});
  const actions = authActionsFromClient(authClient);
  const [values, setValues] = useState<SetupValues>(() => initialValues(profile));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const patch = (next: Partial<SetupValues>) => {
    setValues((current) => ({ ...current, ...next }));
  };
  const minPasswordLength =
    liveConfig?.auth.local.minPasswordLength ??
    profile.auth.local.minPasswordLength ??
    OWNER_PASSWORD_MIN_LENGTH;
  const assessment = assessOwnerPassword(values.password, minPasswordLength);
  const canSubmit =
    values.token.trim().length > 0 &&
    values.workspaceName.trim().length > 0 &&
    values.name.trim().length > 0 &&
    values.email.trim().length > 0 &&
    assessment.valid;

  async function submit() {
    if (!canSubmit || pending) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      await initialize({
        token: values.token.trim(),
        name: values.workspaceName.trim(),
        email: values.email.trim(),
        password: values.password,
        displayName: values.name.trim(),
      });
      setDone(true);
      const result = await actions.signInEmail({
        email: values.email.trim(),
        password: values.password,
      });
      if (result.error !== null) {
        setError(
          result.error.message ??
            "The workspace is ready. Sign in with the account you just created.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "Could not finish setup. Check the token and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthScroll>
      <AuthScaffold
        seed={profile.iconSeed}
        aura={<NativeBlobatar seed={profile.iconSeed} size={104} title={profile.name} />}
        intro={
          <View className="gap-2">
            <Heading level={1}>Set up your workspace</Heading>
            <Text tone="muted" size="sm">
              Create the first owner account. You can invite everyone else once you’re in.
            </Text>
          </View>
        }
      >
        <View className="gap-6">
          {error !== null && (
            <Text tone="danger" size="sm" accessibilityRole="alert">
              {error}
            </Text>
          )}
          {done && error === null && (
            <Text tone="muted" size="sm">
              Instance ready. Signing you in…
            </Text>
          )}

          <AuthField
            label="Setup token"
            placeholder="From the setup container logs"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            value={values.token}
            onChangeText={(token) => {
              patch({ token });
            }}
          />
          <Text size="xs" tone="muted">
            Printed once on first boot. Re-run the setup container to print a new token.
          </Text>

          <AuthField
            label="Workspace name"
            placeholder="Acme"
            value={values.workspaceName}
            onChangeText={(workspaceName) => {
              patch({ workspaceName });
            }}
          />
          <AuthField
            label="Your name"
            placeholder="Ada Lovelace"
            autoComplete="name"
            value={values.name}
            onChangeText={(name) => {
              patch({ name });
            }}
          />
          <AuthField
            label="Email"
            placeholder="you@company.com"
            autoComplete="email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={values.email}
            onChangeText={(email) => {
              patch({ email });
            }}
          />
          <View className="gap-1.5">
            <AuthField
              label="Password"
              placeholder="At least 8 characters"
              secureTextEntry
              autoComplete="new-password"
              value={values.password}
              onChangeText={(password) => {
                patch({ password });
              }}
            />
            <StrengthMeter password={values.password} minLength={minPasswordLength} />
          </View>

          <Button loading={pending} disabled={!canSubmit} onPress={() => void submit()}>
            Create owner account
          </Button>
          {onConnectDifferentServer !== undefined && (
            <Button variant="ghost" onPress={onConnectDifferentServer}>
              Use a different workspace
            </Button>
          )}
        </View>
      </AuthScaffold>
    </AuthScroll>
  );
}
