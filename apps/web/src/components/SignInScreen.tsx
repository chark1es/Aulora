import { Avatar } from "@aulora/avatars";
import type { ServerProfile } from "@aulora/core";
import { Button, Heading, Input, Text } from "@aulora/ui-web";
import { type FormEvent, useState } from "react";
import type { AuthActions } from "../lib/auth-client";
import { AuthCard, AuthColumns, AuthFrame } from "./AuthFrame";

export interface SignInScreenProps {
  readonly profile: ServerProfile;
  readonly actions: AuthActions;
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
export function SignInScreen({ profile, actions }: SignInScreenProps) {
  const local = profile.auth.local;
  const providers = profile.auth.providers;
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

  return (
    <AuthFrame layout="split">
      <AuthColumns keyhole={<Avatar seed={profile.iconSeed} size={72} shape="squircle" />}>
        <AuthCard>
          <div className="flex flex-col gap-1.5">
            <Heading level={1} className="text-[30px] leading-[1.15] sm:text-[32px]">
              {mode === "sign-up" ? "Create your account" : `Sign in to ${profile.name}`}
            </Heading>
            <Text tone="muted" size="md" className="leading-normal">
              {hasProviders || local.enabled
                ? "Use one of the methods this server allows."
                : "This server has no sign-in methods enabled yet."}
            </Text>
          </div>

          {error !== null && (
            <Text tone="danger" size="sm" role="alert">
              {error}
            </Text>
          )}

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
                <span className="text-[17px] font-semibold">
                  {mode === "sign-up" ? "Create account" : "Sign in"}
                </span>
              </Button>
            </form>
          )}

          {hasProviders && local.enabled && (
            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <Text tone="muted" size="xs" mono>
                or
              </Text>
              <span className="h-px flex-1 bg-border" />
            </div>
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

          {local.enabled && local.signup && (
            <Button
              size="lg"
              variant="ghost"
              disabled={pending !== null}
              onClick={() => {
                setError(null);
                setMode(mode === "sign-up" ? "sign-in" : "sign-up");
              }}
            >
              {mode === "sign-up" ? "Already have an account? Sign in" : "Create an account"}
            </Button>
          )}
        </AuthCard>
      </AuthColumns>
    </AuthFrame>
  );
}
