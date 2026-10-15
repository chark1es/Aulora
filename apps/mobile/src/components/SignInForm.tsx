/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { providerInitial, type SignInMethods, type WellKnownProvider } from "@aulora/core";
import { Button, Icon, IconButton, Text, usePalette } from "@aulora/ui-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AuthField } from "./AuthField";

/**
 * The sign-in card's interior: provider buttons, the divider, and the local
 * email/password form. Split out of the screen so the screen keeps the state and
 * the layout, and this keeps the controls.
 */

export type SignInMode = "sign-in" | "sign-up";

type ProviderKind = "oauth" | "oidc";

export type SignInField = "email" | "name" | "password";

/** The values the local sign-in form collects. */
export interface SignInValues {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

/** The single-field patch for one form field, kept type-safe. */
export function fieldPatch(field: SignInField, value: string): Partial<SignInValues> {
  switch (field) {
    case "email":
      return { email: value };
    case "name":
      return { name: value };
    case "password":
      return { password: value };
  }
}

function ProviderBadge({ name }: { readonly name: string }) {
  return (
    <View className="h-6 w-6 items-center justify-center rounded-[7px] bg-surface-3">
      <Text size="xs" className="font-semibold">
        {providerInitial(name)}
      </Text>
    </View>
  );
}

export interface ProviderStackProps {
  readonly providers: readonly WellKnownProvider[];
  readonly pending: string | null;
  readonly onPress: (providerId: string, type: ProviderKind) => void;
}

export function ProviderStack({ providers, pending, onPress }: ProviderStackProps) {
  return (
    <View className="gap-2.5">
      {providers.map((provider) => (
        <Button
          key={provider.id}
          variant="secondary"
          size="lg"
          accessibilityLabel={`Continue with ${provider.displayName}`}
          leading={<ProviderBadge name={provider.displayName} />}
          loading={pending === provider.id}
          disabled={pending !== null && pending !== provider.id}
          onPress={() => {
            onPress(provider.id, provider.type);
          }}
        >
          {provider.displayName}
        </Button>
      ))}
    </View>
  );
}

/** The SSO-only case: no local form, so the buttons need a word of explanation. */
export function ProviderOnlyNote() {
  return (
    <Text size="sm" tone="muted" className="leading-relaxed">
      This workspace signs in through its configured provider.
    </Text>
  );
}

export function OrDivider() {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-px flex-1 bg-border" />
      <Text size="xs" tone="muted">
        or continue with
      </Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}

const MODES: ReadonlyArray<{ readonly value: SignInMode; readonly label: string }> = [
  { value: "sign-in", label: "Sign in" },
  { value: "sign-up", label: "Create an account" },
];

/** Underlined local-auth mode tabs; the active one is not a button. */
function ModeSwitch({
  mode,
  onToggle,
}: {
  readonly mode: SignInMode;
  readonly onToggle: () => void;
}) {
  return (
    <View className="flex-row gap-6 border-b border-border">
      {MODES.map((option) =>
        option.value === mode ? (
          <View
            key={option.value}
            className="-mb-px min-h-11 justify-center border-b-2 border-accent"
          >
            <Text size="sm" className="font-semibold">
              {option.label}
            </Text>
          </View>
        ) : (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            onPress={onToggle}
            className="min-h-11 justify-center active:opacity-80"
          >
            <Text size="sm" tone="muted" className="font-medium">
              {option.label}
            </Text>
          </Pressable>
        ),
      )}
    </View>
  );
}

function PasswordField({
  value,
  signUp,
  onChange,
}: {
  readonly value: string;
  readonly signUp: boolean;
  readonly onChange: (value: string) => void;
}) {
  const palette = usePalette();
  const [show, setShow] = useState(false);
  return (
    <AuthField
      label="Password"
      secureTextEntry={!show}
      autoComplete={signUp ? "new-password" : "current-password"}
      value={value}
      onChangeText={onChange}
      trailing={
        <IconButton
          label={show ? "Hide password" : "Show password"}
          size="sm"
          onPress={() => {
            setShow((current) => !current);
          }}
        >
          <Icon name={show ? "eye-off" : "eye"} color={palette["text-muted"]} />
        </IconButton>
      }
    />
  );
}

export interface SignInPanelProps {
  readonly methods: SignInMethods;
  readonly providers: readonly WellKnownProvider[];
  readonly mode: SignInMode;
  readonly values: SignInValues;
  /** The key of the request in flight, or `null`. */
  readonly pending: string | null;
  readonly error: string | null;
  /** Whether the sign-up toggle is offered at all. */
  readonly signup: boolean;
  readonly onField: (field: SignInField, value: string) => void;
  readonly onProvider: (providerId: string, type: ProviderKind) => void;
  readonly onSubmit: () => void;
  readonly onToggleMode: () => void;
}

function LocalForm({ panel }: { readonly panel: SignInPanelProps }) {
  const signUp = panel.mode === "sign-up";
  return (
    <View className="gap-6">
      {panel.signup && <ModeSwitch mode={panel.mode} onToggle={panel.onToggleMode} />}
      {signUp && (
        <AuthField
          label="Name"
          autoComplete="name"
          value={panel.values.name}
          onChangeText={(value) => {
            panel.onField("name", value);
          }}
        />
      )}
      <AuthField
        label="Email"
        placeholder="name@company.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        value={panel.values.email}
        onChangeText={(value) => {
          panel.onField("email", value);
        }}
      />
      <PasswordField
        value={panel.values.password}
        signUp={signUp}
        onChange={(value) => {
          panel.onField("password", value);
        }}
      />
      <Button
        size="lg"
        loading={panel.pending === "local"}
        disabled={panel.pending !== null}
        onPress={panel.onSubmit}
      >
        {signUp ? "Create account" : "Sign in"}
      </Button>
    </View>
  );
}

/** Everything inside the sign-in card. */
export function SignInPanel({ panel }: { readonly panel: SignInPanelProps }) {
  const { methods, providers, pending, error, onProvider } = panel;
  return (
    <View className="gap-6">
      {error !== null && (
        <Text size="sm" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      )}
      {methods.showLocalForm && <LocalForm panel={panel} />}
      {!methods.showLocalForm && methods.hasProviders && <ProviderOnlyNote />}
      {methods.showDivider && <OrDivider />}
      {methods.hasProviders && (
        <ProviderStack providers={providers} pending={pending} onPress={onProvider} />
      )}
    </View>
  );
}
