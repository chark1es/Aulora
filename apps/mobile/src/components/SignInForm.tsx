/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { SignInMethods, WellKnownProvider } from "@aulora/core";
import { providerBrand, providerButtonLabel } from "@aulora/tokens";
import { Button, Icon, IconButton, ProviderIcon, Text, usePalette } from "@aulora/ui-native";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import { useReduceMotion } from "../lib/use-entrance";
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

function providerBadge(provider: WellKnownProvider, color: string) {
  const brand = providerBrand(provider.id, provider.displayName);
  return brand === null ? undefined : <ProviderIcon brand={brand} size={17} color={color} />;
}

export interface ProviderStackProps {
  readonly providers: readonly WellKnownProvider[];
  readonly pending: string | null;
  readonly onPress: (providerId: string, type: ProviderKind, displayName: string) => void;
}

/**
 * One button per provider, with its real brand mark when it has one. Several
 * providers share a compact two-column grid; a single provider keeps the full
 * width. A provider without a mark is text only, never a generated initial.
 */
export function ProviderStack({ providers, pending, onPress }: ProviderStackProps) {
  const palette = usePalette();
  if (providers.length === 0) {
    return null;
  }
  const compact = providers.length > 1;
  return (
    <View className="flex-row flex-wrap gap-2.5">
      {providers.map((provider) => (
        <View key={provider.id} className={compact ? "basis-[47%] grow" : "w-full"}>
          <Button
            variant="secondary"
            size={compact ? "md" : "lg"}
            className={compact ? "!px-3" : ""}
            accessibilityLabel={`Continue with ${provider.displayName}`}
            leading={providerBadge(provider, palette.text)}
            loading={pending === provider.id}
            disabled={pending !== null && pending !== provider.id}
            onPress={() => {
              onPress(provider.id, provider.type, provider.displayName);
            }}
          >
            {compact ? (
              <Text size="sm" numberOfLines={1} className="shrink font-medium">
                {providerButtonLabel(provider.id, provider.displayName)}
              </Text>
            ) : (
              providerButtonLabel(provider.id, provider.displayName)
            )}
          </Button>
        </View>
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

/** Underlined local-auth tabs with a sliding active indicator. */
function ModeSwitch({
  mode,
  onToggle,
}: {
  readonly mode: SignInMode;
  readonly onToggle: () => void;
}) {
  const palette = usePalette();
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  const progress = useRef(new Animated.Value(mode === "sign-up" ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion === null) {
      return undefined;
    }
    if (reduceMotion) {
      progress.setValue(mode === "sign-up" ? 1 : 0);
      return undefined;
    }
    const animation = Animated.timing(progress, {
      toValue: mode === "sign-up" ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [mode, progress, reduceMotion]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, width / 2],
  });

  return (
    <View
      className="border-b border-border"
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);
      }}
    >
      <View className="flex-row">
        {MODES.map((option) => {
          const active = option.value === mode;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="tab"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (!active) {
                  onToggle();
                }
              }}
              className="min-h-11 flex-1 items-center justify-center active:opacity-80"
            >
              <Text
                size="sm"
                className={active ? "font-semibold" : "font-medium"}
                style={{ color: active ? palette.text : palette["text-muted"] }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Animated.View
        style={{
          position: "absolute",
          bottom: -1,
          left: 0,
          height: 2,
          width: width / 2,
          borderRadius: 999,
          backgroundColor: palette.accent,
          transform: [{ translateX }],
        }}
      />
    </View>
  );
}

/**
 * Fades and slides the fields from the direction of travel whenever the mode
 * changes. The first mount is shown immediately; reducing motion skips it.
 */
function AnimatedModeContent({
  mode,
  children,
}: {
  readonly mode: SignInMode;
  readonly children: ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const previousMode = useRef(mode);

  useLayoutEffect(() => {
    if (previousMode.current === mode) {
      return undefined;
    }
    previousMode.current = mode;
    if (reduceMotion !== false) {
      progress.setValue(1);
      return undefined;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [mode, progress, reduceMotion]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [mode === "sign-up" ? 10 : -10, 0],
  });

  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateX }] }}>
      {children}
    </Animated.View>
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
  readonly onProvider: (providerId: string, type: ProviderKind, displayName: string) => void;
  readonly onSubmit: () => void;
  readonly onToggleMode: () => void;
}

function LocalForm({ panel }: { readonly panel: SignInPanelProps }) {
  const signUp = panel.mode === "sign-up";
  return (
    <View className="gap-6">
      {panel.signup && <ModeSwitch mode={panel.mode} onToggle={panel.onToggleMode} />}
      <AnimatedModeContent mode={panel.mode}>
        <View className="gap-6">
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
      </AnimatedModeContent>
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
