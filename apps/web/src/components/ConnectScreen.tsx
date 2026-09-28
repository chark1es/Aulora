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
import { Button, Heading, Input, Text } from "@aulora/ui-web";
import { type FormEvent, useEffect, useState } from "react";
import { SUPPORTED_API_VERSION } from "../lib/api-version";
import { AuthCard, AuthColumns, AuthFrame } from "./AuthFrame";

export interface ConnectScreenProps {
  readonly store: ProfileStore;
  readonly onConnected?: (profile: ServerProfile) => void;
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
      <AuthFrame layout="split">
        <AuthColumns keyhole={<Avatar seed={wellKnown.iconSeed} size={72} shape="squircle" />}>
          <AuthCard>
            <div className="flex flex-col gap-1.5">
              <Heading level={1} className="text-[30px] leading-[1.15] sm:text-[32px]">
                {wellKnown.name}
              </Heading>
              <Text tone="muted" size="md" className="leading-normal">
                This is the workspace on that server.
              </Text>
            </div>
            <div className="flex flex-col gap-2">
              <Text tone="muted" size="sm" mono className="truncate">
                {preview.baseUrl}
              </Text>
              <div className="flex flex-wrap gap-1.5 text-xs font-medium">
                <span className="rounded-full bg-surface-3 px-2.5 py-1 text-text-muted">
                  Aulora v{wellKnown.version} · API v{wellKnown.apiVersion}
                </span>
              </div>
            </div>
            {error !== null && (
              <Text tone="danger" size="sm" role="alert">
                {error}
              </Text>
            )}
            <div className="flex w-full flex-col gap-2">
              <Button size="lg" onClick={handleContinue} loading={busy}>
                <span className="text-[17px] font-semibold">Continue</span>
              </Button>
              <Button
                size="lg"
                variant="ghost"
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
              >
                Use a different server
              </Button>
            </div>
          </AuthCard>
        </AuthColumns>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame layout="split">
      <AuthColumns>
        <AuthCard>
          <div className="flex flex-col gap-1.5">
            <Heading level={1} className="text-[30px] leading-[1.15] sm:text-[32px]">
              Connect to a server
            </Heading>
            <Text tone="muted" size="md" className="leading-normal">
              Point Aulora at your team's server. Nothing is saved until you confirm.
            </Text>
          </div>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <Input
              label="Server address"
              size="lg"
              placeholder="chat.acme.com"
              hint="Your server's host, e.g. chat.acme.com."
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="url"
              autoFocus
              value={host}
              onChange={(event) => setHost(event.currentTarget.value)}
              {...(error !== null ? { error } : {})}
            />
            <Button size="lg" type="submit" loading={busy} disabled={host.trim().length === 0}>
              <span className="text-[17px] font-semibold">{busy ? "Connecting…" : "Connect"}</span>
            </Button>
          </form>
        </AuthCard>
      </AuthColumns>
    </AuthFrame>
  );
}
