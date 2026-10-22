/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Avatar } from "@aulora/avatars";
import {
  createServerProfile,
  fetchWellKnown,
  type ProfileStore,
  type ServerProfile,
  ServerUrlError,
  tryNormalizeServerUrl,
  type WellKnown,
  WellKnownError,
} from "@aulora/core";
import { Icon, IconButton, Spinner, Text } from "@aulora/ui-web";
import { type FormEvent, useEffect, useState } from "react";
import { SUPPORTED_API_VERSION } from "../lib/api-version";
import { AuthButton, AuthField, AuthFrame, AuthHeading, AuthLink, AuthStage } from "./AuthFrame";
import { BlobatarHero } from "./BlobatarHero";

export interface ConnectScreenProps {
  readonly store: ProfileStore;
  readonly onConnected?: (_profile: ServerProfile) => void;
  /** Host prefilled from an `aulora://connect?server=…` deep link. */
  readonly initialHost?: string;
}

interface Preview {
  readonly baseUrl: string;
  readonly wellKnown: WellKnown;
}

type DiscoverResult =
  | { readonly ok: true; readonly preview: Preview }
  | { readonly ok: false; readonly message: string };

/** The seed the connect screen starts on, before any workspace is known. */
const CONNECT_SEED = "aulora:server:connect";
const SELF_HOST_URL =
  "https://github.com/chark1es/Aulora/blob/main/apps/docs/content/self-hosting.md";

function messageForError(error: unknown) {
  if (error instanceof WellKnownError) {
    switch (error.code) {
      case "HTTP_ERROR":
        return "That address answered, but it isn’t an Aulora server.";
      case "INVALID_JSON":
        return "That server returned a response this client could not read.";
      case "SECRET_FIELD":
        return "That server’s configuration isn’t one this client can use.";
      case "NETWORK_ERROR":
        return "Could not reach that server. Check the address and your connection.";
      case "INVALID_SHAPE":
        return "That server’s configuration isn’t in a format this client understands.";
      default:
        return "That server could not be used.";
    }
  }
  if (error instanceof ServerUrlError) {
    return "Enter a valid server address, like chat.acme.com.";
  }
  return "Something went wrong while connecting.";
}

/** The host (with port) of a server’s base URL, for the quiet caption. */
function serverHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * The creature the person is currently conjuring, keyed off what they have
 * typed. Only the first label of the hostname feeds it, so the face settles as
 * soon as they name the server rather than squirming on every keystroke; an
 * empty field falls back to the connect screen's own seed.
 */
function hostSeed(host: string) {
  const label = host
    .trim()
    .toLowerCase()
    .split(".")
    .find((part) => part.length > 0);
  return label === undefined ? CONNECT_SEED : `aulora:server:${label}`;
}

/** Normalizes the typed host and discovers the server, mapping errors to copy. */
async function discoverServer(raw: string): Promise<DiscoverResult> {
  const normalized = tryNormalizeServerUrl(raw);
  if (normalized === null) {
    return { ok: false, message: "Enter a valid server address, like chat.acme.com." };
  }
  try {
    const wellKnown = await fetchWellKnown(normalized);
    if (wellKnown.apiVersion !== SUPPORTED_API_VERSION) {
      return {
        ok: false,
        message: `This server speaks Aulora API v${wellKnown.apiVersion}; this client supports v${SUPPORTED_API_VERSION}.`,
      };
    }
    return { ok: true, preview: { baseUrl: normalized, wellKnown } };
  } catch (caught) {
    return { ok: false, message: messageForError(caught) };
  }
}

/** Loads the saved workspaces once, and keeps them in sync on switch/remove. */
function useRecentProfiles(store: ProfileStore) {
  const [profiles, setProfiles] = useState<readonly ServerProfile[]>([]);
  const refresh = () => {
    void store.list().then(setProfiles);
  };
  useEffect(() => {
    let active = true;
    void store.list().then((list) => {
      if (active) {
        setProfiles(list);
      }
    });
    return () => {
      active = false;
    };
  }, [store]);
  return { profiles, refresh };
}

interface ConnectFormProps {
  readonly host: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly onHostChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onTouch: () => void;
  /** Reports the focused field, or `"pointer"` when nothing is focused. */
  readonly onWatch: (target: Element | "pointer") => void;
}

/** Reads the clipboard into the field; a denied or missing permission is a no-op. */
interface PasteButtonProps {
  readonly onPaste: (text: string) => void;
}

function PasteButton({ onPaste }: PasteButtonProps) {
  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim().length > 0) {
        onPaste(text.trim());
      }
    } catch {
      // Clipboard permission denied or unavailable: leave the field untouched.
    }
  }
  return (
    <button
      type="button"
      onClick={() => void paste()}
      className="rounded-full px-2.5 py-1 text-[13px] font-medium text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      Paste
    </button>
  );
}

function HostField(props: ConnectFormProps) {
  const { host, busy, error, onHostChange, onTouch, onWatch } = props;
  const trailing = busy ? (
    <Spinner size={16} label="Checking" />
  ) : (
    <PasteButton onPaste={onHostChange} />
  );
  return (
    <AuthField
      label="Server address"
      placeholder="chat.acme.com"
      autoComplete="off"
      autoCapitalize="none"
      spellCheck="false"
      inputMode="url"
      autoFocus
      value={host}
      leading={<Icon name="link" size={20} />}
      trailing={trailing}
      onChange={(event) => {
        onHostChange(event.currentTarget.value);
      }}
      onFocus={(event) => {
        onWatch(event.currentTarget);
      }}
      onBlur={() => {
        onWatch("pointer");
        onTouch();
      }}
      error={error}
    />
  );
}

function ConnectForm(props: ConnectFormProps) {
  const { host, busy, onSubmit } = props;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="flex flex-col gap-7" onSubmit={submit} noValidate={true}>
      <HostField {...props} />
      <AuthButton type="submit" loading={busy} disabled={host.trim().length === 0}>
        {busy ? "Checking…" : "Continue"}
      </AuthButton>
    </form>
  );
}

interface RecentListProps {
  readonly profiles: readonly ServerProfile[];
  readonly disabled: boolean;
  readonly onSwitch: (profile: ServerProfile) => void;
  readonly onRemove: (id: string) => void;
}

function RecentList({ profiles, disabled, onSwitch, onRemove }: RecentListProps) {
  if (profiles.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-text-muted">
        Recent workspaces
      </p>
      <ul className="-mx-2.5 flex flex-col">
        {profiles.map((profile) => (
          <li key={profile.id} className="flex items-center gap-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onSwitch(profile);
              }}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-[14px] px-2.5 py-2 text-left transition hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-60"
            >
              <Avatar seed={profile.iconSeed} size={34} shape="squircle" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[14px] font-medium text-text">{profile.name}</span>
                <span className="truncate font-mono text-xs text-text-muted">
                  {serverHost(profile.baseUrl)}
                </span>
              </span>
            </button>
            <IconButton
              label={`Remove ${profile.name}`}
              size="sm"
              disabled={disabled}
              onClick={() => {
                onRemove(profile.id);
              }}
            >
              <Icon name="x" size={16} />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The quiet secondary link under the card. */
function SelfHostLink() {
  return (
    <a
      href={SELF_HOST_URL}
      target="_blank"
      rel="noreferrer"
      className="w-fit rounded-[10px] text-[13px] font-medium text-text-muted underline decoration-border underline-offset-4 transition hover:text-text hover:decoration-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      Learn how to self-host
    </a>
  );
}

interface PreviewProps {
  readonly preview: Preview;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onContinue: () => void;
  readonly onBack: () => void;
}

function PreviewView({ preview, busy, error, onContinue, onBack }: PreviewProps) {
  const { wellKnown } = preview;
  return (
    <AuthFrame
      seed={wellKnown.iconSeed}
      stage={
        <AuthStage
          hero={<BlobatarHero seed={wellKnown.iconSeed} size={190} watch="pointer" />}
          headline="Found it."
          caption={serverHost(preview.baseUrl)}
        />
      }
    >
      <AuthHeading title={wellKnown.name} subtitle="Is this the workspace you’re looking for?" />
      <div className="flex flex-col gap-6">
        <p className="flex items-center justify-between gap-3 border-y border-border py-3 text-[13px] text-text-muted">
          <span className="flex items-center gap-2">
            <Icon name="lock" size={14} />
            Aulora v{wellKnown.version}
          </span>
          <span className="font-mono text-xs">API v{wellKnown.apiVersion}</span>
        </p>
        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}
        <AuthButton onClick={onContinue} loading={busy}>
          Continue
        </AuthButton>
        <AuthLink onClick={onBack} disabled={busy}>
          Use a different server
        </AuthLink>
      </div>
    </AuthFrame>
  );
}

/** State and actions for the connect screen. */
function useConnect(
  store: ProfileStore,
  initialHost: string | undefined,
  onConnected: ((profile: ServerProfile) => void) | undefined,
) {
  const [host, setHost] = useState(initialHost ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [watch, setWatch] = useState<Element | "pointer">("pointer");
  const { profiles, refresh } = useRecentProfiles(store);

  useEffect(() => {
    if (initialHost !== undefined) {
      setHost(initialHost);
    }
  }, [initialHost]);

  async function submit() {
    setError(null);
    setTouched(true);
    setBusy(true);
    const result = await discoverServer(host);
    if (result.ok) {
      setPreview(result.preview);
    } else {
      setError(result.message);
    }
    setBusy(false);
  }

  async function confirm() {
    if (preview === null) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const profile = createServerProfile(preview.baseUrl, preview.wellKnown);
      await store.add(profile);
      await store.setActive(profile.id);
      onConnected?.(profile);
    } catch {
      setError("Could not save this server profile.");
    } finally {
      setBusy(false);
    }
  }

  function switchTo(profile: ServerProfile) {
    void store
      .setActive(profile.id)
      .then(() => {
        onConnected?.(profile);
      })
      .catch(() => {
        setError("Could not open that workspace.");
      });
  }

  function remove(id: string) {
    void store.remove(id).then(refresh);
  }

  const invalid = touched && host.trim().length > 0 && tryNormalizeServerUrl(host) === null;
  const inlineError =
    error ?? (invalid ? "Enter a valid server address, like chat.acme.com." : undefined);

  return {
    host,
    setHost,
    busy,
    error,
    inlineError,
    preview,
    profiles,
    watch,
    watchChange: setWatch,
    touch: () => {
      setTouched(true);
    },
    submit: () => {
      void submit();
    },
    confirm: () => {
      void confirm();
    },
    back: () => {
      setPreview(null);
      setError(null);
    },
    switchTo,
    remove,
  };
}

/**
 * The only entry point on first launch: the person enters a host, the client
 * fetches and validates `/.well-known/aulora.json`, shows the workspace and its
 * blobatar as a live preview, checks the API version, then saves the profile.
 *
 * Until that happens the hero is a placeholder creature derived from what they
 * have typed, so the screen conjures the workspace as they name it.
 */
export function ConnectScreen({ store, onConnected, initialHost }: ConnectScreenProps) {
  const model = useConnect(store, initialHost, onConnected);

  if (model.preview !== null) {
    return (
      <PreviewView
        preview={model.preview}
        busy={model.busy}
        error={model.error}
        onContinue={model.confirm}
        onBack={model.back}
      />
    );
  }

  const seed = hostSeed(model.host);

  return (
    <AuthFrame
      seed={seed}
      stage={
        <AuthStage
          hero={<BlobatarHero seed={seed} size={190} watch={model.watch} />}
          headline="Your team, on your own server."
        />
      }
    >
      <AuthHeading
        title="Connect to your workspace"
        subtitle="Enter the address your team gave you."
      />
      <ConnectForm
        host={model.host}
        busy={model.busy}
        {...(model.inlineError !== undefined ? { error: model.inlineError } : {})}
        onHostChange={model.setHost}
        onSubmit={model.submit}
        onTouch={model.touch}
        onWatch={model.watchChange}
      />
      <RecentList
        profiles={model.profiles}
        disabled={model.busy}
        onSwitch={model.switchTo}
        onRemove={model.remove}
      />
      <SelfHostLink />
    </AuthFrame>
  );
}
