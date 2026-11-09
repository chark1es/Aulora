/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { assessOwnerPassword, OWNER_PASSWORD_MIN_LENGTH, type ServerProfile } from "@aulora/core";
import { Icon, IconButton, Text } from "@aulora/ui-web";
import { useAction, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import type { AuthActions } from "../lib/auth-client";
import { describeAuthError } from "../lib/auth-errors";
import { AuthButton, AuthField, AuthFrame, AuthHeading, AuthLink, AuthStage } from "./AuthFrame";
import { BlobatarHero } from "./BlobatarHero";

export interface SetupScreenProps {
  readonly profile: ServerProfile;
  readonly actions: AuthActions;
  readonly onSwitchServer?: () => void;
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

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

const STRENGTH_LABELS = ["Empty", "Too short", "Weak", "Good", "Strong"] as const;
const STRENGTH_BAR_KEYS = ["one", "two", "three", "four"] as const;
const STRENGTH_BARS = STRENGTH_BAR_KEYS.length;

/**
 * A quiet strength meter under the password field. The text carries the real
 * meaning for screen readers; the bars are a visual echo, not the only signal.
 */
function PasswordStrength({
  password,
  minLength,
}: {
  readonly password: string;
  readonly minLength: number;
}) {
  const assessment = assessOwnerPassword(password, minLength);
  const filled =
    assessment.score === 0
      ? 0
      : Math.max(1, Math.min(STRENGTH_BARS, Math.ceil((assessment.score / 4) * STRENGTH_BARS)));
  const tone =
    assessment.score >= 3 ? "bg-accent" : assessment.score === 2 ? "bg-text-muted" : "bg-danger";
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex items-center gap-1" aria-hidden="true">
        {STRENGTH_BAR_KEYS.map((bar, index) => (
          <span
            key={bar}
            className={[
              "h-1 flex-1 rounded-full transition-colors",
              index < filled ? tone : "bg-border",
            ].join(" ")}
          />
        ))}
      </div>
      <Text size="xs" tone="muted">
        {password.length === 0
          ? `At least ${minLength} characters. A 16+ character passphrase is strongest.`
          : (assessment.problem ??
            `${STRENGTH_LABELS[assessment.score]} password. Use 16+ characters or mix three character classes.`)}
      </Text>
    </div>
  );
}

function PasswordField({
  value,
  minLength,
  onChange,
}: {
  readonly value: string;
  readonly minLength: number;
  readonly onChange: (value: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <AuthField
        label="Password"
        type={show ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
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
      <PasswordStrength password={value} minLength={minLength} />
    </div>
  );
}

/**
 * First-run claim screen. A fresh instance has no owner, so the person who
 * reaches it with the one-time setup token registers the owner account. The
 * token is printed once in the setup container logs and stored server-side only
 * as a hash; the server re-checks it atomically when the claim is finalized.
 */
export function SetupScreen({ profile, actions, onSwitchServer }: SetupScreenProps) {
  const initialize = useAction(api.setup.initialize);
  const liveConfig = useQuery(api.server.publicConfig, {});
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
      // Sign the new owner in straight away. The setup gate also flips to the
      // normal sign-in screen on its own if this cannot complete.
      const result = await actions.signInEmail({
        email: values.email.trim(),
        password: values.password,
      });
      if (result.error !== null) {
        setError(
          result.error.message === undefined
            ? "The instance is ready. Sign in with the account you just created."
            : describeAuthError(result.error.message),
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
    <AuthFrame
      seed={profile.iconSeed}
      stage={
        <AuthStage
          hero={<BlobatarHero seed={profile.iconSeed} size={190} watch="pointer" />}
          headline="This server is yours."
          caption={hostOf(profile.baseUrl)}
        />
      }
    >
      <AuthHeading
        title="Set up your instance"
        subtitle="Create the first owner account. You can invite everyone else once you’re in."
      />
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}
        {done && error === null && (
          <Text tone="muted" size="sm" role="status">
            Instance ready. Signing you in…
          </Text>
        )}

        <AuthField
          label="Setup token"
          placeholder="From the setup container logs"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck="false"
          autoFocus
          value={values.token}
          leading={<Icon name="key" size={18} />}
          onChange={(event) => {
            patch({ token: event.currentTarget.value });
          }}
        />
        <Text size="xs" tone="muted">
          Printed once on first boot. Run{" "}
          <span className="rounded bg-surface-3 px-1 font-mono text-[11px] text-text">
            docker compose logs setup
          </span>{" "}
          or re-run setup to print a new token.
        </Text>

        <AuthField
          label="Instance name"
          placeholder="Acme"
          autoComplete="organization"
          value={values.workspaceName}
          onChange={(event) => {
            patch({ workspaceName: event.currentTarget.value });
          }}
        />
        <AuthField
          label="Your name"
          placeholder="Ada Lovelace"
          autoComplete="name"
          value={values.name}
          onChange={(event) => {
            patch({ name: event.currentTarget.value });
          }}
        />
        <AuthField
          label="Email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={(event) => {
            patch({ email: event.currentTarget.value });
          }}
        />
        <PasswordField
          value={values.password}
          minLength={minPasswordLength}
          onChange={(value) => {
            patch({ password: value });
          }}
        />

        <AuthButton type="submit" loading={pending} disabled={!canSubmit}>
          {pending ? "Creating your instance…" : "Create owner account"}
        </AuthButton>
      </form>
      {onSwitchServer !== undefined && (
        <AuthLink onClick={onSwitchServer} disabled={pending}>
          Use a different workspace
        </AuthLink>
      )}
    </AuthFrame>
  );
}
