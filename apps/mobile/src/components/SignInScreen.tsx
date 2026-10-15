import { NativeBlobatar } from "@aulora/avatars/native";
import { resolveSignInMethods, type ServerProfile, type SignInMethods } from "@aulora/core";
import { Button, Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Animated, Image, Pressable, useWindowDimensions, View } from "react-native";
import { api } from "../../../../packages/convex/convex/_generated/api";
import {
  type AuloraAuthClient,
  authActionsFromClient,
  startProviderSignIn,
} from "../lib/auth-client";
import type { CookieStore } from "../lib/cookie-fetch";
import { useEntrance, useReduceMotion } from "../lib/use-entrance";
import { AuthScaffold, AuthScroll } from "./AuthScaffold";
import { fieldPatch, type SignInMode, SignInPanel, type SignInPanelProps } from "./SignInForm";
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

type AuthActions = ReturnType<typeof authActionsFromClient>;

interface AuthFailure {
  readonly message?: string;
}

/** What an auth call resolves to: no error on success. */
interface AuthResult {
  readonly error: AuthFailure | null;
}

interface FormState {
  readonly mode: SignInMode;
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly pending: string | null;
  readonly error: string | null;
}

const INITIAL: FormState = {
  mode: "sign-in",
  email: "",
  password: "",
  name: "",
  pending: null,
  error: null,
};

/** The host (with port) of a profile’s base URL, for the quiet server caption. */
function profileHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** Form state and submit handlers for the local and provider sign-in paths. */
function useSignInController(
  actions: AuthActions,
  authClient: AuloraAuthClient,
  cookieStore: CookieStore,
) {
  const [state, setState] = useState<FormState>(INITIAL);
  const patch = (next: Partial<FormState>) => {
    setState((current) => ({ ...current, ...next }));
  };

  async function run(key: string, task: () => Promise<AuthResult>) {
    patch({ error: null, pending: key });
    try {
      const result = await task();
      if (result.error !== null) {
        patch({
          error: result.error.message ?? "That did not work. Check your details and try again.",
        });
      }
    } catch {
      patch({ error: "Could not reach the server. Try again." });
    } finally {
      patch({ pending: null });
    }
  }

  async function submitLocal() {
    if (state.mode === "sign-up") {
      await run("local", () =>
        actions.signUpEmail({ email: state.email, password: state.password, name: state.name }),
      );
      return;
    }
    await run("local", () => actions.signInEmail({ email: state.email, password: state.password }));
  }

  async function signInWithProvider(providerId: string, type: "oauth" | "oidc") {
    patch({ error: null, pending: providerId });
    try {
      const result = await startProviderSignIn(authClient, cookieStore, providerId, type);
      if (result.status === "error") {
        patch({ error: result.message });
      }
    } catch {
      patch({ error: "Could not open the sign-in browser." });
    } finally {
      patch({ pending: null });
    }
  }

  return { state, patch, submitLocal, signInWithProvider };
}

interface WorkspaceMarkProps {
  readonly profile: ServerProfile;
  readonly logoUrl: string | null;
  readonly size: number;
  readonly reduceMotion: boolean | null;
}

/** The hero mark of the sign-in screen: the workspace's own logo or creature. */
function WorkspaceMark({ profile, logoUrl, size, reduceMotion }: WorkspaceMarkProps) {
  if (logoUrl !== null) {
    const source = { uri: logoUrl };
    const frame = { width: size, height: size, borderRadius: 24 };
    return <Image source={source} accessibilityLabel={`${profile.name} logo`} style={frame} />;
  }
  const creatureSize = Math.round(size * 0.72);
  return (
    <ThresholdAura size={size} seed={profile.iconSeed} reduceMotion={reduceMotion}>
      <NativeBlobatar seed={profile.iconSeed} size={creatureSize} title={profile.name} />
    </ThresholdAura>
  );
}

interface IdentityProps {
  readonly profile: ServerProfile;
  readonly subtitle: string;
  readonly host: string;
  readonly onOpenWorkspaces?: () => void;
}

/** The workspace name, its line of welcome copy, and the server address. */
function SignInIdentity({ profile, subtitle, host, onOpenWorkspaces }: IdentityProps) {
  const palette = usePalette();
  return (
    <View className="gap-1.5">
      <Heading level={1}>Sign in to {profile.name}</Heading>
      <Text size="base" tone="muted" className="leading-relaxed">
        {subtitle}
      </Text>
      {onOpenWorkspaces !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Switch workspace, current ${profile.name}`}
          onPress={onOpenWorkspaces}
          className="min-h-11 flex-row items-center gap-1"
        >
          <Text size="xs" tone="muted" mono numberOfLines={1} ellipsizeMode="tail">
            {host}
          </Text>
          <Icon name="chevron-down" size={16} color={palette["text-muted"]} />
        </Pressable>
      ) : (
        <Text size="xs" tone="muted" mono numberOfLines={1} ellipsizeMode="tail">
          {host}
        </Text>
      )}
    </View>
  );
}

function subtitleFor(methods: SignInMethods, description: string): string {
  if (description.length > 0) {
    return description;
  }
  if (!methods.hasAnyMethod) {
    return "This server has no sign-in methods enabled yet.";
  }
  return "Welcome back. Sign in to continue.";
}

type SignInController = ReturnType<typeof useSignInController>;

/** The sign-in panel's view of the form state and the controller's actions. */
function panelFor(
  profile: ServerProfile,
  methods: SignInMethods,
  controller: SignInController,
): SignInPanelProps {
  const { state, patch, submitLocal, signInWithProvider } = controller;
  return {
    methods,
    providers: profile.auth.providers,
    mode: state.mode,
    values: { email: state.email, name: state.name, password: state.password },
    pending: state.pending,
    error: state.error,
    signup: methods.showSignUp,
    onField: (field, value) => {
      patch(fieldPatch(field, value));
    },
    onProvider: (id, type) => {
      void signInWithProvider(id, type);
    },
    onSubmit: () => {
      void submitLocal();
    },
    onToggleMode: () => {
      patch({ mode: state.mode === "sign-up" ? "sign-in" : "sign-up", error: null });
    },
  };
}

/**
 * Sign-in driven entirely by the server’s well-known `auth` block: the local
 * form appears only when `auth.local.enabled`, a sign-up toggle only when
 * `auth.local.signup`, and one button per `auth.providers` entry. OAuth/OIDC
 * providers open Authorization Code + PKCE in the system browser and return via
 * `aulora://auth/callback`.
 *
 * The workspace's own blobatar is the hero, and the field behind it is drawn
 * from the same seed, so each workspace signs in on its own colours.
 */
export function SignInScreen(props: SignInScreenProps) {
  const { profile, authClient, cookieStore, onOpenWorkspaces, onConnectDifferentServer } = props;
  const methods = resolveSignInMethods(profile.auth);
  const actions = authActionsFromClient(authClient);
  const config = useQuery(api.server.publicConfig, {});
  const reduceMotion = useReduceMotion();
  const { animatedStyle } = useEntrance(reduceMotion);
  const { width } = useWindowDimensions();
  const compact = width < 480;
  const controller = useSignInController(actions, authClient, cookieStore);
  const { state } = controller;

  return (
    <AuthScroll>
      <AuthScaffold
        seed={profile.iconSeed}
        reduceMotion={reduceMotion}
        aura={
          <WorkspaceMark
            profile={profile}
            logoUrl={config?.logoUrl ?? null}
            size={compact ? 104 : 124}
            reduceMotion={reduceMotion}
          />
        }
        intro={
          <Animated.View style={animatedStyle}>
            <SignInIdentity
              profile={profile}
              subtitle={subtitleFor(methods, config?.description ?? "")}
              host={profileHost(profile.baseUrl)}
              {...(onOpenWorkspaces !== undefined ? { onOpenWorkspaces } : {})}
            />
          </Animated.View>
        }
      >
        <SignInPanel panel={panelFor(profile, methods, controller)} />
        {onConnectDifferentServer !== undefined && (
          <Button
            variant="ghost"
            className="self-start"
            disabled={state.pending !== null}
            onPress={onConnectDifferentServer}
          >
            Use a different workspace
          </Button>
        )}
      </AuthScaffold>
    </AuthScroll>
  );
}
