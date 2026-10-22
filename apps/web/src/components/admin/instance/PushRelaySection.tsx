/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Input, Switch, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import { SaveRow } from "../SettingsSaveRow";
import { SettingsSection } from "../SettingsSection";
import type { Overview } from "./InstanceSections";

/** Mobile push relay settings: one switch plus two identity fields, one save row. */
export function PushRelaySection({ overview }: { readonly overview: Overview }) {
  const updatePushRelay = useMutation(api.instance.updatePushRelay);
  const [enabled, setEnabled] = useState(overview.pushRelay.enabled);
  const [url, setUrl] = useState(overview.pushRelay.url ?? "");
  const [serverId, setServerId] = useState(overview.pushRelay.serverId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(overview.pushRelay.enabled);
    setUrl(overview.pushRelay.url ?? "");
    setServerId(overview.pushRelay.serverId ?? "");
  }, [overview.pushRelay.enabled, overview.pushRelay.url, overview.pushRelay.serverId]);

  function save(): void {
    setError(null);
    setSaved(false);
    setBusy(true);
    void updatePushRelay({
      enabled,
      url: url.trim().length > 0 ? url.trim() : null,
      serverId: serverId.trim().length > 0 ? serverId.trim() : null,
    })
      .then(() => {
        setSaved(true);
        setDirty(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not save the relay.");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function edit(apply: () => void): void {
    apply();
    setSaved(false);
    setDirty(true);
  }

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="instance-push"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <SettingsSection
        title="Push relay"
        description="Optional relay for store-built mobile apps. The shared token stays in the deployment env (PUSH_RELAY_TOKEN); only its presence is shown."
      />
      <Text size="sm" tone={overview.pushRelay.configured ? "secondary" : "muted"}>
        {overview.pushRelay.configured
          ? "Relay URL and token are set in the environment."
          : "Relay token is not set in the environment."}
      </Text>
      <div className="rounded-input border border-border bg-surface-1 px-3.5">
        <Switch
          checked={enabled}
          onChange={(value) => {
            edit(() => {
              setEnabled(value);
            });
          }}
          label="Enable mobile push relay"
          description="Forward pushes for store-built mobile apps through the relay."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Relay URL"
          hint="Base URL the Convex action calls, e.g. https://relay.example.com."
          value={url}
          onChange={(event) => {
            edit(() => {
              setUrl(event.currentTarget.value);
            });
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <Input
          label="Server id"
          hint="Opaque id echoed in wakeups; defaults to the site URL."
          value={serverId}
          onChange={(event) => {
            edit(() => {
              setServerId(event.currentTarget.value);
            });
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <SaveRow busy={busy} dirty={dirty} saved={saved} error={error} />
    </form>
  );
}
