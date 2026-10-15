import {
  resolveSignInMethods,
  type ServerProfile,
  type SignInMethods,
  type WellKnownProvider,
} from "@aulora/core";
import { Button, Icon, IconButton, Text } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { type FocusEvent, type FormEvent, useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import type { AuthActions } from "../lib/auth-client";
import {
  AuthButton,
  AuthDivider,
  AuthField,
  AuthFrame,
  AuthHeading,
  AuthLink,
  AuthStage,
} from "./AuthFrame";
import { BlobatarHero } from "./BlobatarHero";

export interface SignInScreenProps {
  readonly profile: ServerProfile;
  readonly actions: AuthActions;
  /** Returns to the connect screen to enter a different server. */
  readonly onSwitchServer?: () => void;
}

/** Where the hero's eyes are pointed: a focused field, `"rest"`, or nothing. */
type Watch = Element | "rest" | null;

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function callbackUrl(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

interface FormState {
  readonly mode: "sign-in" | "sign-up";
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

/** The form state and submit handlers behind {@link SignInScreen}. */
function useSignInForm(actions: AuthActions) {
  const [state, setState] = useState<FormState>(INITIAL);
  const patch = (next: Partial<FormState>) => {
    setState((current) => ({ ...current, ...next }));
  };

  async function run(key: string, task: () => Promise<{ error: { message?: string } | null }>) {
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

  async function submit() {
    if (state.mode === "sign-up") {
      await run("local", () =>
        actions.signUpEmail({ email: state.email, password: state.password, name: state.name }),
      );
      return;
    }
    await run("local", () => actions.signInEmail({ email: state.email, password: state.password }));
  }

  function provider(providerId: string, type: "oauth" | "oidc") {
    return () => {
      void run(providerId, () =>
        type === "oauth"
          ? actions.signInSocial({ provider: providerId, callbackURL: callbackUrl() })
          : actions.signInOAuth2({ providerId, callbackURL: callbackUrl() }),
      );
    };
  }

  return { state, patch, submit, provider };
}

function ProviderBadge({ name }: { readonly name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className="grid h-6 w-6 place-items-center rounded-[7px] bg-surface-3 text-[12px] font-semibold text-text"
    >
      {initial}
    </span>
  );
}

interface ProviderStackProps {
  readonly providers: readonly WellKnownProvider[];
  readonly pending: string | null;
  readonly onProvider: (providerId: string, type: "oauth" | "oidc") => () => void;
}

function ProviderStack({ providers, pending, onProvider }: ProviderStackProps) {
  return (
    <div className="flex flex-col gap-2.5">
      {providers.map((provider) => (
        <Button
          key={provider.id}
          size="lg"
          variant="secondary"
          className="!h-12 !rounded-full !bg-transparent hover:!bg-surface-2"
          aria-label={`Continue with ${provider.displayName}`}
          leading={<ProviderBadge name={provider.displayName} />}
          loading={pending === provider.id}
          disabled={pending !== null && pending !== provider.id}
          onClick={onProvider(provider.id, provider.type)}
        >
          {provider.displayName}
        </Button>
      ))}
    </div>
  );
}

const MODES = [
  { value: "sign-in", label: "Sign in" },
  { value: "sign-up", label: "Create an account" },
] as const;

/** Underlined local-auth mode tabs; the active one is not a button. */
function ModeSwitch({
  mode,
  onToggle,
}: {
  readonly mode: FormState["mode"];
  readonly onToggle: () => void;
}) {
  return (
    <div className="flex gap-6 border-b border-border">
      {MODES.map((option) =>
        option.value === mode ? (
          <span
            key={option.value}
            className="-mb-px border-b-2 border-accent pb-2.5 text-[14px] font-semibold text-text"
          >
            {option.label}
          </span>
        ) : (
          <button
            key={option.value}
            type="button"
            onClick={onToggle}
            className="pb-2.5 text-[14px] font-medium text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {option.label}
          </button>
        ),
      )}
    </div>
  );
}

function PasswordField({
  value,
  signUp,
  onWatch,
  onChange,
}: {
  readonly value: string;
  readonly signUp: boolean;
  readonly onWatch: (target: Watch) => void;
  readonly onChange: (value: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <AuthField
      label="Password"
      type={show ? "text" : "password"}
      autoComplete={signUp ? "new-password" : "current-password"}
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      onFocus={() => {
        // A password field is the one place the creature should pointedly look
        // away: eyes that follow a field being revealed read as a gag, not help.
        onWatch("rest");
      }}
      onBlur={() => {
        onWatch(null);
      }}
      trailing={
        <IconButton
          label={show ? "Hide password" : "Show password"}
          size="sm"
          onClick={() => {
            setShow((current) => !current);
          }}
        >
          <Icon name={show ? "eye-off" : "eye"} size={18} />
        </IconButton>
      }
    />
  );
}

interface LocalFormProps {
  readonly state: FormState;
  readonly signup: boolean;
  readonly onPatch: (next: Partial<FormState>) => void;
  readonly onWatch: (target: Watch) => void;
  readonly onSubmit: () => void;
  readonly onToggleMode: () => void;
}

function LocalForm({ state, signup, onPatch, onWatch, onSubmit, onToggleMode }: LocalFormProps) {
  const signUp = state.mode === "sign-up";
  const watchSelf = (event: FocusEvent<HTMLInputElement>) => {
    onWatch(event.currentTarget);
  };
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
      noValidate
    >
      {signup && <ModeSwitch mode={state.mode} onToggle={onToggleMode} />}
      {signUp && (
        <AuthField
          label="Name"
          autoComplete="name"
          value={state.name}
          onFocus={watchSelf}
          onBlur={() => {
            onWatch(null);
          }}
          onChange={(event) => {
            onPatch({ name: event.currentTarget.value });
          }}
        />
      )}
      <AuthField
        label="Email"
        type="email"
        placeholder="name@company.com"
        autoComplete="email"
        value={state.email}
        onFocus={watchSelf}
        onBlur={() => {
          onWatch(null);
        }}
        onChange={(event) => {
          onPatch({ email: event.currentTarget.value });
        }}
      />
      <PasswordField
        value={state.password}
        signUp={signUp}
        onWatch={onWatch}
        onChange={(value) => {
          onPatch({ password: value });
        }}
      />
      <AuthButton
        type="submit"
        loading={state.pending === "local"}
        disabled={state.pending !== null}
      >
        {signUp ? "Create account" : "Sign in"}
      </AuthButton>
    </form>
  );
}

interface SignInPanelProps extends LocalFormProps {
  readonly methods: SignInMethods;
  readonly providers: readonly WellKnownProvider[];
  readonly pending: string | null;
  readonly onProvider: (providerId: string, type: "oauth" | "oidc") => () => void;
}

/**
 * The sign-in methods in order of weight: the email form first, then a divider,
 * then the single-sign-on providers beneath it. When local sign-in is off the
 * explanation leads and the providers are the whole form.
 */
function SignInPanel(props: SignInPanelProps) {
  const { methods, providers, state, pending, onProvider, ...formProps } = props;
  return (
    <div className="flex flex-col gap-6">
      {state.error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {state.error}
        </Text>
      )}
      {methods.showLocalForm && <LocalForm {...formProps} state={state} />}
      {!methods.showLocalForm && methods.hasProviders && (
        <Text tone="muted" size="sm" className="leading-relaxed">
          This workspace signs in through its configured provider.
        </Text>
      )}
      {methods.showDivider && <AuthDivider>or continue with</AuthDivider>}
      {methods.hasProviders && (
        <ProviderStack providers={providers} pending={pending} onProvider={onProvider} />
      )}
    </div>
  );
}

function subtitleFor(methods: SignInMethods, signUp: boolean, description: string): string {
  if (description.length > 0) {
    return description;
  }
  if (!methods.hasAnyMethod) {
    return "This server has no sign-in methods enabled yet.";
  }
  return signUp
    ? "Set up your details to join this workspace."
    : "Welcome back. Sign in to continue.";
}

/**
 * Sign-in driven entirely by the server's well-known `auth` block: the local
 * email/password form appears only when `auth.local.enabled`, a sign-up toggle
 * only when `auth.local.signup`, and exactly one button per `auth.providers`
 * entry. No provider is hardcoded here. When local sign-in is off, only the SSO
 * buttons are shown, with a short explanation.
 *
 * The workspace's blobatar is the hero on its own colour panel, drawn from the
 * same seed, so each workspace signs in on its own colours. The form sits
 * directly on the page beside it, with no card.
 */
export function SignInScreen({ profile, actions, onSwitchServer }: SignInScreenProps) {
  const methods = resolveSignInMethods(profile.auth);
  const config = useQuery(api.server.publicConfig, {});
  const { state, patch, submit, provider } = useSignInForm(actions);
  const [watch, setWatch] = useState<Watch>(null);
  const signUp = state.mode === "sign-up";

  return (
    <AuthFrame
      seed={profile.iconSeed}
      stage={
        <AuthStage
          hero={
            <BlobatarHero
              seed={profile.iconSeed}
              size={190}
              watch={watch}
              src={config?.logoUrl ?? null}
            />
          }
          headline={profile.name}
          caption={hostOf(profile.baseUrl)}
        />
      }
    >
      <AuthHeading
        title={signUp ? "Create your account" : `Sign in to ${profile.name}`}
        subtitle={subtitleFor(methods, signUp, config?.description ?? "")}
      />
      <SignInPanel
        methods={methods}
        providers={profile.auth.providers}
        state={state}
        pending={state.pending}
        signup={methods.showSignUp}
        onPatch={patch}
        onWatch={setWatch}
        onProvider={provider}
        onSubmit={() => {
          void submit();
        }}
        onToggleMode={() => {
          patch({ mode: signUp ? "sign-in" : "sign-up", error: null });
        }}
      />
      {onSwitchServer !== undefined && (
        <AuthLink onClick={onSwitchServer} disabled={state.pending !== null}>
          Use a different workspace
        </AuthLink>
      )}
    </AuthFrame>
  );
}
