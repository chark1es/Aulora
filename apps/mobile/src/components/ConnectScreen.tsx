import { NativeAvatar } from "@aulora/avatars/native";
import { fetchWellKnown, type WellKnown, WellKnownError } from "@aulora/core";
import { Button, Card, Heading, Input, Spinner, Text } from "@aulora/ui-native";
import { useState } from "react";
import { View } from "react-native";
import { SUPPORTED_API_VERSION } from "../lib/api-version";
import { useProfiles } from "../providers/ProfileProvider";

function messageForError(error: unknown): string {
  if (error instanceof WellKnownError) {
    switch (error.code) {
      case "HTTP_ERROR":
        return "That server answered, but did not serve an Aulora well-known document.";
      case "SECRET_FIELD":
        return "That server's well-known document contained a field Aulora refuses to use.";
      case "NETWORK_ERROR":
        return "Could not reach that server. Check the address and your connection.";
      default:
        return "That server could not be used.";
    }
  }
  return "Enter a valid server address, like chat.acme.com.";
}

interface Preview {
  readonly baseUrl: string;
  readonly wellKnown: WellKnown;
}

/**
 * First-launch entry point: enter a host, read `/.well-known/aulora.json`,
 * confirm the workspace and API version, then save the server profile.
 */
export function ConnectScreen({ onConnected }: { readonly onConnected: () => void }) {
  const { addProfile } = useProfiles();
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  async function connect() {
    setError(null);
    if (host.trim().length === 0) {
      return;
    }
    setBusy(true);
    try {
      const wellKnown = await fetchWellKnown(host);
      if (wellKnown.apiVersion !== SUPPORTED_API_VERSION) {
        setError(
          `This server speaks Aulora API v${wellKnown.apiVersion}; this client supports v${SUPPORTED_API_VERSION}.`,
        );
        return;
      }
      setPreview({ baseUrl: host, wellKnown });
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (preview === null) {
      return;
    }
    setBusy(true);
    try {
      await addProfile(preview.baseUrl, preview.wellKnown);
      onConnected();
    } catch {
      setError("Could not save this server profile.");
    } finally {
      setBusy(false);
    }
  }

  if (preview !== null) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Card className="w-full items-center gap-4">
          <NativeAvatar
            seed={preview.wellKnown.iconSeed}
            size={72}
            title={preview.wellKnown.name}
          />
          <Heading level={2}>{preview.wellKnown.name}</Heading>
          <Text size="sm" tone="muted" mono>
            {preview.baseUrl}
          </Text>
          <Text size="sm" tone="secondary">
            Aulora v{preview.wellKnown.version} · API v{preview.wellKnown.apiVersion}
          </Text>
          {error !== null && (
            <Text size="sm" tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          )}
          <View className="w-full gap-2">
            <Button loading={busy} onPress={() => void save()}>
              Continue
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onPress={() => {
                setPreview(null);
                setError(null);
              }}
            >
              Use a different server
            </Button>
          </View>
        </Card>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center p-6">
      <Card className="w-full gap-5">
        <View className="gap-1">
          <Heading level={1}>Connect to a server</Heading>
          <Text size="sm" tone="muted">
            Enter the host your team gave you. Aulora reads its well-known document to find the
            workspace and sign-in methods.
          </Text>
        </View>
        <Input
          label="Server address"
          placeholder="chat.acme.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={host}
          onChangeText={setHost}
          onSubmitEditing={() => void connect()}
          returnKeyType="go"
          {...(error !== null ? { error } : {})}
        />
        <Button loading={busy} disabled={host.trim().length === 0} onPress={() => void connect()}>
          Connect
        </Button>
        {busy && (
          <View className="items-center">
            <Spinner size={20} label="Connecting" />
          </View>
        )}
      </Card>
    </View>
  );
}
