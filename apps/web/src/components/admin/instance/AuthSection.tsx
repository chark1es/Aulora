/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Card, Switch, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { Callback } from "../callbacks";
import { SaveRow } from "../SettingsSaveRow";
import { SettingsSectionHeader } from "../SettingsSection";
import type { Overview } from "./InstanceSections";

type AuthProvider = Overview["auth"]["availableProviders"][number];

function providersPayload(
  toggles: Record<string, boolean | undefined>,
): Record<string, boolean | undefined> {
  return {
    ...(toggles.github !== undefined ? { github: toggles.github } : {}),
    ...(toggles.google !== undefined ? { google: toggles.google } : {}),
    ...(toggles.microsoft !== undefined ? { microsoft: toggles.microsoft } : {}),
    ...(toggles.apple !== undefined ? { apple: toggles.apple } : {}),
    ...(toggles.oidc !== undefined ? { oidc: toggles.oidc } : {}),
  };
}

/**
 * Auth provider toggles. Credentials come from the Environment section or the
 * deployment; this only switches a configured provider on or off, with a single
 * save row at the bottom.
 */
export function AuthSection({ overview }: { readonly overview: Overview }) {
  const updateAuthProviders = useMutation(api.instance.updateAuthProviders);
  const stored = (overview.auth.providersConfigured ?? {}) as Record<string, boolean | undefined>;
  const [toggles, setToggles] = useState<Record<string, boolean | undefined>>(stored);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  function save(): void {
    setError(null);
    setSaved(false);
    setBusy(true);
    void updateAuthProviders({ providers: providersPayload(toggles) })
      .then(() => {
        setSaved(true);
        setDirty(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not save providers.");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="instance-auth"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <SettingsSectionHeader
        icon="users"
        title="Auth providers"
        description="Credentials come from the deployment environment or from overrides saved in the Environment section; a provider is offered only when it is both configured and switched on here."
      />
      <Card className="flex flex-col gap-1">
        <Text size="sm">
          Local email/password: {overview.auth.local.enabled ? "enabled" : "disabled"} · signup{" "}
          {overview.auth.local.signup ? "open" : "closed"}
        </Text>
      </Card>
      <AuthProviderList
        providers={overview.auth.availableProviders}
        toggles={toggles}
        onToggle={(providerId, value) => {
          setToggles((current) => ({ ...current, [providerId]: value }));
          setSaved(false);
          setDirty(true);
        }}
      />
      {overview.auth.oidc !== null && <OidcSummary oidc={overview.auth.oidc} />}
      <SaveRow busy={busy} dirty={dirty} saved={saved} error={error} />
    </form>
  );
}

function toggleEnabled(
  toggles: Record<string, boolean | undefined>,
  provider: AuthProvider,
): boolean {
  return new Map(Object.entries(toggles)).get(provider.id) ?? provider.enabled;
}

function AuthProviderList({
  providers,
  toggles,
  onToggle,
}: {
  readonly providers: readonly AuthProvider[];
  readonly toggles: Record<string, boolean | undefined>;
  readonly onToggle: Callback<[providerId: string, value: boolean]>;
}) {
  return (
    <ul className="flex flex-col gap-1" data-testid="instance-auth-providers">
      {providers.map((provider) => (
        <AuthProviderToggle
          key={provider.id}
          provider={provider}
          enabled={toggleEnabled(toggles, provider)}
          onToggle={(value) => {
            onToggle(provider.id, value);
          }}
        />
      ))}
    </ul>
  );
}

function AuthProviderToggle({
  provider,
  enabled,
  onToggle,
}: {
  readonly provider: AuthProvider;
  readonly enabled: boolean;
  readonly onToggle: Callback<[value: boolean]>;
}) {
  const descriptionProps = provider.configured
    ? {}
    : {
        description:
          "Not configured — set credentials in the Environment section or the deployment environment.",
      };
  return (
    <li className="rounded-input border border-border bg-surface-2 px-3 py-2">
      <Switch
        checked={enabled}
        disabled={!provider.configured}
        onChange={onToggle}
        label={provider.displayName}
        {...descriptionProps}
      />
    </li>
  );
}

/** OIDC summary that never renders environment-sourced values. */
function OidcSummary({ oidc }: { readonly oidc: NonNullable<Overview["auth"]["oidc"]> }) {
  if (oidc.source === "environment") {
    return (
      <Card className="flex flex-col gap-1">
        <Text size="sm">OIDC: configured from the deployment environment</Text>
        <Text size="xs" tone="muted">
          Its values are hidden here. Replace or adjust it in the Environment section.
        </Text>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-1">
      <Text size="sm">OIDC: {oidc.displayName}</Text>
      <Text size="xs" tone="muted" mono>
        {oidc.discoveryUrl}
      </Text>
      <Text size="xs" tone="muted">
        scopes: {oidc.scopes.join(" ")}
      </Text>
    </Card>
  );
}
