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
import { Button, Icon, Input, Logo, Text } from "@aulora/ui-web";
import { type FormEvent, useEffect, useState } from "react";
import { SUPPORTED_API_VERSION } from "../lib/api-version";
import { AuthCard, AuthFrame, AuthHeader, AuthLink } from "./AuthFrame";

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

function messageForError(error: unknown): string {
  if (error instanceof WellKnownError) {
    switch (error.code) {
      case "HTTP_ERROR":
        return "That address answered, but it isn't an Aulora server.";
      case "INVALID_JSON":
        return "That server returned a response this client could not read.";
      case "SECRET_FIELD":
        return "That server's configuration isn't one this client can use.";
      case "NETWORK_ERROR":
        return "Could not reach that server. Check the address and your connection.";
      case "INVALID_SHAPE":
        return "That server's configuration isn't in a format this client understands.";
      default:
        return "That server could not be used.";
    }
  }
  if (error instanceof ServerUrlError) {
    return "Enter a valid server address, like chat.acme.com.";
  }
  return "Something went wrong while connecting.";
}

/** The host (with port) of a server's base URL, for the quiet caption. */
function serverHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * The only entry point on first launch: the person enters a host, the client
 * fetches and validates `/.well-known/aulora.json`, shows the workspace and
 * checks the API version, then saves the server profile.
 */
export function ConnectScreen({ store, onConnected, initialHost }: ConnectScreenProps) {
  const [host, setHost] = useState(initialHost ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    if (initialHost !== undefined) {
      setHost(initialHost);
    }
  }, [initialHost]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalized = tryNormalizeServerUrl(host);
    if (normalized === null) {
      setError("Enter a valid server address, like chat.acme.com.");
      return;
    }
    setBusy(true);
    try {
      const wellKnown = await fetchWellKnown(normalized);
      if (wellKnown.apiVersion !== SUPPORTED_API_VERSION) {
        setError(
          `This server speaks Aulora API v${wellKnown.apiVersion}; this client supports v${SUPPORTED_API_VERSION}.`,
        );
        return;
      }
      setPreview({ baseUrl: normalized, wellKnown });
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleContinue() {
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

  if (preview !== null) {
    const { wellKnown } = preview;
    return (
      <AuthFrame>
        <AuthHeader
          mark={<Avatar seed={wellKnown.iconSeed} size={64} shape="squircle" />}
          title={wellKnown.name}
          subtitle="Is this the workspace you're looking for?"
          caption={serverHost(preview.baseUrl)}
        />
        <AuthCard>
          <div className="flex items-center justify-between gap-3 rounded-[10px] bg-surface-3 px-3 py-2.5 text-xs text-text-muted">
            <span className="flex items-center gap-1.5">
              <Icon name="lock" size={13} />
              Aulora v{wellKnown.version}
            </span>
            <span className="font-mono">API v{wellKnown.apiVersion}</span>
          </div>
          {error !== null && (
            <Text tone="danger" size="sm" role="alert">
              {error}
            </Text>
          )}
          <Button
            size="lg"
            onClick={() => {
              void handleContinue();
            }}
            loading={busy}
          >
            <span className="text-[15px] font-semibold">Continue</span>
          </Button>
        </AuthCard>
        <AuthLink
          onClick={() => {
            setPreview(null);
            setError(null);
          }}
        >
          Use a different server
        </AuthLink>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <AuthHeader
        mark={<Logo size={64} />}
        title="Connect to your server"
        subtitle="Enter the address your team gave you. Nothing is saved until you confirm."
      />
      <AuthCard>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          noValidate
        >
          <Input
            label="Server address"
            size="lg"
            placeholder="chat.acme.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            autoFocus
            value={host}
            onChange={(event) => {
              setHost(event.currentTarget.value);
            }}
            {...(error !== null ? { error } : {})}
          />
          <Button size="lg" type="submit" loading={busy} disabled={host.trim().length === 0}>
            <span className="text-[15px] font-semibold">{busy ? "Connecting…" : "Connect"}</span>
          </Button>
        </form>
      </AuthCard>
    </AuthFrame>
  );
}
