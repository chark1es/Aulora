/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import {
  recordDebugFailure,
  resolveSignInMethods,
  type ServerProfile,
  type SignInMethods,
  subscribeAuthError,
  type WellKnownProvider,
} from "@aulora/core";
import { providerBrand, providerButtonLabel } from "@aulora/tokens";
import {
  Button,
  CapText,
  ChoiceList,
  type ChoiceOption,
  cn,
  Icon,
  IconButton,
  Modal,
  ProviderIcon,
  Text,
  usePrefersReducedMotion,
} from "@aulora/ui-web";
import { useQuery } from "convex/react";
import {
  type CSSProperties,
  type FocusEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { createAccountScope } from "../lib/account-scope";
import type { AuthActions } from "../lib/auth-client";
import { authFailureDetail, describeAuthError, takeAuthErrorFromUrl } from "../lib/auth-errors";
import { isDesktop } from "../lib/desktop";
import {
  beginOAuth,
  clearStoredAuthHandoffError,
  DESKTOP_AUTH_RETURN,
  type OAuthDelivery,
  type OAuthProviderRef,
  oauthStartUrl,
  prepareOAuthStart,
  takeStoredAuthHandoffError,
  webAuthReturnUrl,
} from "../lib/oauth-start";
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
  /**
   * Soft, non-blocking message shown above the form (for example when the
   * server config query is not answering). Sign-in itself stays usable.
   */
  readonly notice?: string | undefined;
  /** Retry action offered next to {@link notice}. */
  readonly onRetryNotice?: (() => void) | undefined;
  /**
   * Runs a provider sign-in through the supplied actions instead of opening
   * the OAuth bridge. Used by the development preview harness.
   */
  readonly onStartProvider?: (providerId: string, type: "oauth" | "oidc") => Promise<AuthResult>;
}

/** Where the hero’s eyes are pointed: a focused field, the pointer, `"rest"`, or nothing. */
type Watch = Element | "pointer" | "rest" | null;

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

interface AuthFailure {
  readonly message?: string;
}

/** What an auth call resolves to: no error on success. */
interface AuthResult {
  readonly error: AuthFailure | null;
}

type FormMode = "sign-in" | "sign-up";

interface FormState {
  readonly mode: FormMode;
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
function useSignInForm(actions: AuthActions, siteUrl: string) {
  const [state, setState] = useState<FormState>(() => {
    const storedHandoff = takeStoredAuthHandoffError(siteUrl);
    return {
      ...INITIAL,
      error:
        takeAuthErrorFromUrl() ??
        (storedHandoff === null ? null : describeAuthError(storedHandoff)),
    };
  });
  // Each operation captures the screen/workspace lifetime it started in.
  const scopeRef = useRef(createAccountScope(recordDebugFailure));
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity changes must close in-flight work even though the effect only creates its lifetime.
  useEffect(() => {
    const scope = createAccountScope(recordDebugFailure);
    scopeRef.current = scope;
    return () => scope.close();
  }, [actions, siteUrl]);

  const patch = (next: Partial<FormState>) => {
    setState((current) => ({ ...current, ...next }));
  };

  // A desktop error deep link can be accepted after this screen is already
  // mounted. Consume the stored message once when the bridge says it arrived.
  useEffect(
    () =>
      subscribeAuthError(() => {
        const stored = takeStoredAuthHandoffError(siteUrl);
        if (stored !== null) {
          recordDebugFailure("auth.callback", stored);
          setState((current) => ({ ...current, error: describeAuthError(stored) }));
        }
      }),
    [siteUrl],
  );

  async function run(key: string, task: () => Promise<AuthResult>) {
    const scope = scopeRef.current;
    if (!scope.active) return;
    patch({ error: null, pending: key });
    try {
      const result = await task();
      if (!scope.active) return;
      if (result.error !== null) {
        scope.record("auth.signin", authFailureDetail(result.error));
        patch({
          error:
            result.error.message === undefined
              ? "That did not work. Check your details and try again."
              : describeAuthError(result.error.message),
        });
      } else {
        clearStoredAuthHandoffError();
      }
    } catch (error) {
      if (!scope.active) return;
      scope.record("auth.signin", authFailureDetail(error));
      patch({ error: "Could not reach the workspace. Try again." });
    } finally {
      if (scope.active) patch({ pending: null });
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

  return { state, patch, submit, run, scopeRef };
}

interface ProviderStackProps {
  readonly providers: readonly WellKnownProvider[];
  readonly pending: string | null;
  readonly onProvider: (providerId: string, type: "oauth" | "oidc") => () => void;
}

/**
 * One button per configured provider. A real brand mark is shown when the
 * provider has one; a provider without a mark is text only. Several providers
 * share a compact responsive grid so the screen stays short, while a single
 * provider keeps the full-width call to action.
 */
function ProviderStack({ providers, pending, onProvider }: ProviderStackProps) {
  if (providers.length === 0) {
    return null;
  }
  const compact = providers.length > 1;
  const columns =
    providers.length === 1
      ? "grid-cols-1"
      : providers.length === 2
        ? "grid-cols-2"
        : "grid-cols-2 sm:grid-cols-3";
  return (
    <div className={cn("grid gap-2.5", columns)}>
      {providers.map((provider) => {
        const brand = providerBrand(provider.id, provider.displayName);
        return (
          <Button
            key={provider.id}
            size={compact ? "md" : "lg"}
            variant="secondary"
            className={cn(
              "!h-12 !min-w-0 !rounded-full !bg-transparent hover:!bg-surface-2",
              compact ? "!gap-2 !px-3" : "",
              // An odd provider count would leave the last one half-width and
              // orphaned; let it span the row (two-column layout only).
              providers.length > 2 && "last:odd:col-span-2 sm:last:odd:col-span-1",
            )}
            aria-label={`Continue with ${provider.displayName}`}
            title={provider.displayName}
            leading={
              brand === null ? undefined : <ProviderIcon brand={brand} size={compact ? 17 : 18} />
            }
            loading={pending === provider.id}
            disabled={pending !== null && pending !== provider.id}
            onClick={onProvider(provider.id, provider.type)}
          >
            <span className="min-w-0 truncate">
              {providerButtonLabel(provider.id, provider.displayName)}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

const MODES = [
  { value: "sign-in", label: "Sign in" },
  { value: "sign-up", label: "Create an account" },
] as const;

interface ModeSwitchProps {
  readonly mode: FormMode;
  readonly onToggle: () => void;
}

/**
 * The local-auth tabs with a sliding active indicator. The strip is a real tab
 * list: arrow keys move between tabs, and each tab names the panel below.
 */
function ModeSwitch({ mode, onToggle }: ModeSwitchProps) {
  const reducedMotion = usePrefersReducedMotion();
  const activeIndex = mode === "sign-up" ? 1 : 0;
  return (
    <div
      role="tablist"
      aria-label="Account mode"
      className="relative grid grid-cols-2 border-b border-border"
    >
      {MODES.map((option, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={`auth-tab-${option.value}`}
            aria-selected={active}
            aria-controls="auth-mode-panel"
            tabIndex={active ? 0 : -1}
            onClick={() => {
              if (!active) {
                onToggle();
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                return;
              }
              event.preventDefault();
              onToggle();
            }}
            className={cn(
              "relative z-10 flex h-10 items-center justify-center text-[14px] transition-colors",
              "rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              active ? "font-semibold text-text" : "font-medium text-text-muted hover:text-text",
            )}
          >
            <CapText>{option.label}</CapText>
          </button>
        );
      })}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -bottom-px left-0 h-0.5 w-1/2 rounded-full bg-accent",
          !reducedMotion && "transition-transform duration-[240ms] ease-out",
        )}
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />
    </div>
  );
}

interface AnimatedModePanelProps {
  readonly mode: FormMode;
  readonly children: ReactNode;
}

/**
 * Cross-fades and slides the fields in from the direction of travel, and moves
 * the container to the new content height so the page does not jump when the
 * name field appears. Both are disabled by reduced-motion.
 */
function AnimatedModePanel({ mode, children }: AnimatedModePanelProps) {
  const reducedMotion = usePrefersReducedMotion();
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    // Re-measure after the keyed panel swaps; the mode itself is not read, but
    // it is the signal that the content (and therefore the height) changed.
    void mode;
    const node = inner.current;
    if (node === null) {
      return undefined;
    }
    const update = () => {
      setHeight(node.getBoundingClientRect().height);
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [mode]);
  return (
    <div
      className={cn("relative", !reducedMotion && "transition-[height] duration-[240ms] ease-out")}
      style={height === undefined ? undefined : { height }}
    >
      <div
        key={mode}
        ref={inner}
        id="auth-mode-panel"
        role="tabpanel"
        className={reducedMotion ? "" : "animate-auth-form-in"}
        style={
          {
            "--auth-form-shift": mode === "sign-up" ? "10px" : "-10px",
          } as CSSProperties
        }
      >
        {children}
      </div>
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
        onWatch("pointer");
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
      <AnimatedModePanel mode={signup ? state.mode : "sign-in"}>
        <div className="flex flex-col gap-6">
          {signUp && (
            <AuthField
              label="Name"
              autoComplete="name"
              value={state.name}
              onFocus={watchSelf}
              onBlur={() => {
                onWatch("pointer");
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
              onWatch("pointer");
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
        </div>
      </AnimatedModePanel>
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

type DeliveryOption = OAuthDelivery;

const DELIVERY_OPTIONS: ReadonlyArray<ChoiceOption<DeliveryOption>> = [
  {
    value: "in-app",
    title: "Sign in in app",
    description: "Finish in the Aulora window without leaving the app.",
    leading: <Icon name="desktop" size={16} />,
  },
  {
    value: "external",
    title: "Open in browser",
    description: "Use your default browser, then return here automatically.",
    leading: <Icon name="link" size={16} />,
  },
];

interface ProviderChoice {
  readonly provider: OAuthProviderRef;
  readonly name: string;
}

function subtitleFor(methods: SignInMethods, signUp: boolean, description: string): string {
  if (description.length > 0) {
    return description;
  }
  if (!methods.hasAnyMethod) {
    return "This workspace has no sign-in methods enabled yet.";
  }
  return signUp
    ? "Set up your details to join this workspace."
    : "Welcome back. Sign in to continue.";
}

/**
 * Sign-in driven entirely by the server’s live `auth` block (the same shape as well-known): the local
 * email/password form appears only when `auth.local.enabled`, a sign-up toggle
 * only when `auth.local.signup`, and exactly one button per `auth.providers`
 * entry. No provider is hardcoded here. When local sign-in is off, only the SSO
 * buttons are shown, with a short explanation.
 *
 * Provider sign-in always starts on the workspace’s own origin: that is the
 * context that receives the callback, so Better Auth’s state cookie is present.
 * The desktop shell also offers a choice between its own window and the system
 * browser; both finish by deep link.
 *
 * The workspace’s blobatar is the hero on its own colour panel, drawn from the
 * same seed, so each workspace signs in on its own colours. The form sits
 * directly on the page beside it, with no card.
 */
export function SignInScreen({
  profile,
  actions,
  onSwitchServer,
  notice,
  onRetryNotice,
  onStartProvider,
}: SignInScreenProps) {
  const config = useQuery(api.server.publicConfig, {});
  // The stored profile’s `auth` is a snapshot from when the workspace was added,
  // so a provider enabled later would never get a button. The live public config
  // is authoritative once it loads; the snapshot only covers the first paint.
  const auth = config?.auth ?? profile.auth;
  const methods = resolveSignInMethods(auth);
  const { state, patch, submit, run, scopeRef } = useSignInForm(actions, profile.siteUrl);
  const [watch, setWatch] = useState<Watch>("pointer");
  const [choice, setChoice] = useState<ProviderChoice | null>(null);
  const [delivery, setDelivery] = useState<DeliveryOption>("in-app");
  const signUp = state.mode === "sign-up";

  const startProvider = (provider: OAuthProviderRef, name: string) => {
    patch({ error: null });
    if (onStartProvider !== undefined) {
      void run(provider.id, () => onStartProvider(provider.id, provider.type));
      return;
    }
    if (isDesktop()) {
      setDelivery("in-app");
      setChoice({ provider, name });
      return;
    }
    const returnUrl = webAuthReturnUrl();
    const scope = scopeRef.current;
    void prepareOAuthStart(profile.siteUrl, returnUrl)
      .then(({ challenge, tx }) => {
        if (!scope.active) return;
        beginOAuth(oauthStartUrl(profile.siteUrl, provider, returnUrl, challenge, tx), "in-app");
      })
      .catch((error: unknown) => scope.record("auth.provider", authFailureDetail(error)));
  };

  const confirmChoice = () => {
    if (choice === null) {
      return;
    }
    const returnUrl = delivery === "external" ? DESKTOP_AUTH_RETURN : webAuthReturnUrl();
    const scope = scopeRef.current;
    void prepareOAuthStart(profile.siteUrl, returnUrl)
      .then(({ challenge, tx }) => {
        if (!scope.active) return;
        beginOAuth(
          oauthStartUrl(profile.siteUrl, choice.provider, returnUrl, challenge, tx),
          delivery,
        );
        setChoice(null);
      })
      .catch((error: unknown) => scope.record("auth.provider", authFailureDetail(error)));
  };

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
      {notice !== undefined && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-[8px] border border-border bg-surface-2 px-3 py-2"
        >
          <Text tone="muted" size="sm">
            {notice}
          </Text>
          {onRetryNotice !== undefined && (
            <Button variant="ghost" size="sm" onClick={onRetryNotice}>
              Try again
            </Button>
          )}
        </div>
      )}
      <SignInPanel
        methods={methods}
        providers={auth.providers}
        state={state}
        pending={state.pending}
        signup={methods.showSignUp}
        onPatch={patch}
        onWatch={setWatch}
        onProvider={(providerId, type) => () => {
          const provider = auth.providers.find((entry) => entry.id === providerId);
          startProvider({ id: providerId, type }, provider?.displayName ?? providerId);
        }}
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
      <Modal
        open={choice !== null}
        onClose={() => {
          setChoice(null);
        }}
        size="sm"
        label="Where to finish sign-in"
        title={choice === null ? "Where to finish sign-in" : `Continue with ${choice.name}`}
        description="Both options finish signing you in and return to Aulora."
        icon={<Icon name="key" size={18} />}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setChoice(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={confirmChoice}>Continue</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-medium text-text">Choose how to finish</span>
          <ChoiceList
            label="Where to finish sign-in"
            value={delivery}
            options={DELIVERY_OPTIONS}
            onChange={setDelivery}
          />
        </div>
      </Modal>
    </AuthFrame>
  );
}
