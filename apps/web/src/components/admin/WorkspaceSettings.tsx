import { Button, Heading, Input, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";

export interface WorkspaceSettingsProps {
  readonly canManageWorkspace: boolean;
}

/** Parses the textarea into a trimmed, de-duplicated domain list. */
export function parseDomains(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
        .filter((entry) => entry.length > 0),
    ),
  ];
}

/** Workspace access policy: signup, invite-only and allowed email domains. */
export function WorkspaceSettings({ canManageWorkspace }: WorkspaceSettingsProps) {
  const server = useQuery(api.server.settings, canManageWorkspace ? {} : "skip");
  const updateSettings = useMutation(api.server.updateSettings);

  const [signupEnabled, setSignupEnabled] = useState(true);
  const [inviteOnly, setInviteOnly] = useState(false);
  const [domains, setDomains] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (server === undefined) {
      return;
    }
    setSignupEnabled(server.settings.signupEnabled);
    setInviteOnly(server.settings.inviteOnly);
    setDomains(server.settings.allowedEmailDomains.join(", "));
  }, [server]);

  if (!canManageWorkspace) {
    return (
      <Text tone="muted" size="sm" data-testid="workspace-settings-locked">
        You need the Manage workspace permission to change these settings.
      </Text>
    );
  }

  if (server === undefined) {
    return (
      <Text tone="muted" size="sm">
        Loading settings…
      </Text>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="workspace-settings"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        setBusy(true);
        void updateSettings({
          signupEnabled,
          inviteOnly,
          allowedEmailDomains: parseDomains(domains),
        })
          .then(() => setSaved(true))
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Could not save settings."),
          )
          .finally(() => setBusy(false));
      }}
    >
      <Heading level={3}>Workspace settings</Heading>
      <Text tone="muted" size="sm">
        {server.name}
      </Text>
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      {saved && (
        <Text tone="secondary" size="sm" role="status">
          Settings saved.
        </Text>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={signupEnabled}
          onChange={(event) => setSignupEnabled(event.currentTarget.checked)}
        />
        Allow new accounts to sign up
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={inviteOnly}
          onChange={(event) => setInviteOnly(event.currentTarget.checked)}
        />
        Invite only
      </label>
      <Input
        label="Allowed email domains"
        hint="Comma separated; empty allows any domain."
        value={domains}
        onChange={(event) => setDomains(event.currentTarget.value)}
      />
      <div>
        <Button type="submit" loading={busy}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
