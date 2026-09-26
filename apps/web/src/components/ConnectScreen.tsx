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
import { Button, Card, Heading, Input, Spinner, Text } from "@aulora/ui-web";
import { type FormEvent, useEffect, useState } from "react";
import { SUPPORTED_API_VERSION } from "../lib/api-version";

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
        return "That server answered, but did not serve an Aulora well-known document.";
      case "INVALID_JSON":
        return "That server returned a response this client could not read.";
      case "SECRET_FIELD":
        return "That server's well-known document contained a field Aulora refuses to use.";
      case "NETWORK_ERROR":
        return "Could not reach that server. Check the address and your connection.";
      case "INVALID_SHAPE":
        return "That server's well-known document has an unexpected shape.";
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
      <div className="mx-auto w-full max-w-md p-6">
        <Card className="flex flex-col items-center gap-4 text-center">
          <Avatar seed={wellKnown.iconSeed} size={72} title={wellKnown.name} />
          <div className="flex flex-col gap-1">
            <Heading level={2}>{wellKnown.name}</Heading>
            <Text tone="muted" size="sm" mono>
              {preview.baseUrl}
            </Text>
            <Text tone="secondary" size="sm">
              Aulora v{wellKnown.version} · API v{wellKnown.apiVersion}
            </Text>
          </div>
          {error !== null && (
            <Text tone="danger" size="sm" role="alert">
              {error}
            </Text>
          )}
          <div className="flex w-full flex-col gap-2">
            <Button onClick={handleContinue} loading={busy}>
              Continue
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(null);
                setError(null);
              }}
            >
              Use a different server
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md p-6">
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <Heading level={1}>Connect to a server</Heading>
          <Text tone="muted" size="sm">
            Enter the host your team gave you. Aulora reads its well-known document to find the
            workspace and sign-in methods.
          </Text>
        </div>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <Input
            label="Server address"
            placeholder="chat.acme.com"
            autoComplete="off"
            autoCapitalize="none"
            value={host}
            onChange={(event) => setHost(event.currentTarget.value)}
            {...(error !== null ? { error } : {})}
          />
          <Button type="submit" loading={busy} disabled={host.trim().length === 0}>
            {busy ? "Connecting" : "Connect"}
          </Button>
        </form>
        {busy && (
          <div className="flex items-center justify-center gap-2" aria-hidden="true">
            <Spinner size={16} label="Loading" />
          </div>
        )}
      </Card>
    </div>
  );
}
