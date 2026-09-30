import { Avatar } from "@aulora/avatars";
import type { ServerProfile } from "@aulora/core";
import { Button, Input, Text } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import type { AuthActions } from "../lib/auth-client";
import { AuthCard, AuthDivider, AuthFrame, AuthHeader, AuthLink } from "./AuthFrame";

export interface SignInScreenProps {
  readonly profile: ServerProfile;
  readonly actions: AuthActions;
  /** Returns to the connect screen to enter a different server. */
  readonly onSwitchServer?: () => void;
}

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

/**
 * Sign-in driven entirely by the server's well-known `auth` block: the local
 * email/password form appears only when `auth.local.enabled`, a sign-up toggle
 * only when `auth.local.signup`, and exactly one button per `auth.providers`
 * entry. No provider is hardcoded here.
 */
export function SignInScreen({ profile, actions, onSwitchServer }: SignInScreenProps) {
  const local = profile.auth.local;
  const providers = profile.auth.providers;
  const config = useQuery(api.server.publicConfig, {});
  const description = config?.description ?? "";
  const logoUrl = config?.logoUrl ?? null;
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

  async function handleLocalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "sign-up") {
      await run("local", () => actions.signUpEmail({ email, password, name }));
    } else {
      await run("local", () => actions.signInEmail({ email, password }));
    }
  }

  function handleProvider(providerId: string, type: "oauth" | "oidc") {
    return () => {
      void run(providerId, () =>
        type === "oauth"
          ? actions.signInSocial({ provider: providerId, callbackURL: callbackUrl() })
          : actions.signInOAuth2({ providerId, callbackURL: callbackUrl() }),
      );
    };
  }

  const hasProviders = providers.length > 0;
  const subtitle =
    description.length > 0
      ? description
      : hasProviders || local.enabled
        ? mode === "sign-up"
          ? "Set up your details to join this workspace."
          : "Welcome back. Sign in to continue."
        : "This server has no sign-in methods enabled yet.";

  return (
    <AuthFrame>
      <AuthHeader
        mark={
          logoUrl !== null ? (
            <img src={logoUrl} alt="" className="h-16 w-16 object-cover" />
          ) : (
            <Avatar seed={profile.iconSeed} size={64} shape="squircle" />
          )
        }
        title={mode === "sign-up" ? "Create your account" : `Sign in to ${profile.name}`}
        subtitle={subtitle}
        caption={hostOf(profile.baseUrl)}
      />
      <AuthCard>
        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}

        {hasProviders && (
          <div className="flex flex-col gap-2">
            {providers.map((provider) => (
              <Button
                key={provider.id}
                size="lg"
                variant="secondary"
                loading={pending === provider.id}
                disabled={pending !== null && pending !== provider.id}
                onClick={handleProvider(provider.id, provider.type)}
              >
                Continue with {provider.displayName}
              </Button>
            ))}
          </div>
        )}

        {hasProviders && local.enabled && <AuthDivider>or use email</AuthDivider>}

        {local.enabled && (
          <form className="flex flex-col gap-4" onSubmit={handleLocalSubmit} noValidate>
            {mode === "sign-up" && (
              <Input
                label="Name"
                size="lg"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            )}
            <Input
              label="Email"
              size="lg"
              type="email"
              autoComplete="email"
              autoFocus={!hasProviders}
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <Input
              label="Password"
              size="lg"
              type="password"
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            <Button
              size="lg"
              type="submit"
              loading={pending === "local"}
              disabled={pending !== null}
            >
              <span className="text-[15px] font-semibold">
                {mode === "sign-up" ? "Create account" : "Sign in"}
              </span>
            </Button>
          </form>
        )}

        {local.enabled && local.signup && (
          <p className="text-center text-[13px] text-text-muted">
            {mode === "sign-up" ? "Already have an account?" : "New here?"}{" "}
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => {
                setError(null);
                setMode(mode === "sign-up" ? "sign-in" : "sign-up");
              }}
              className="rounded font-medium text-accent transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {mode === "sign-up" ? "Sign in" : "Create an account"}
            </button>
          </p>
        )}
      </AuthCard>
      {onSwitchServer !== undefined && (
        <AuthLink onClick={onSwitchServer} disabled={pending !== null}>
          Use a different server
        </AuthLink>
      )}
    </AuthFrame>
  );
}
