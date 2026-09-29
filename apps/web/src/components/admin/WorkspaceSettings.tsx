import { Button, Icon, Input, SegmentedControl, Switch, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { SettingsSectionHeader } from "./SettingsSection";

export interface WorkspaceSettingsProps {
  readonly canManageWorkspace: boolean;
}

/** Parses free text into a trimmed, de-duplicated domain list. */
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

type JoinMode = "anyone" | "invite";

/*
 * One "How people join" choice maps onto the two stored booleans like this:
 *   Anyone can join -> { signupEnabled: true,  inviteOnly: false }
 *   Invite only     -> { signupEnabled: true,  inviteOnly: true  }
 * Sign-up stays enabled in both modes because invited people still have to
 * create their account; `inviteOnly` is what additionally requires an invite.
 */
const JOIN_MODE_VALUES: Record<JoinMode, { signupEnabled: boolean; inviteOnly: boolean }> = {
  anyone: { signupEnabled: true, inviteOnly: false },
  invite: { signupEnabled: true, inviteOnly: true },
};

function sameDomains(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(b);
  return a.every((entry) => set.has(entry));
}

/**
 * Workspace access policy: how people join and which email domains may join.
 * The joining mode and its domain allow-list live in one surface so the policy
 * reads as a single control; save state is reflected inline rather than by a
 * page-level banner.
 */
export function WorkspaceSettings({ canManageWorkspace }: WorkspaceSettingsProps) {
  const server = useQuery(api.server.settings, canManageWorkspace ? {} : "skip");
  const updateSettings = useMutation(api.server.updateSettings);

  const [joinMode, setJoinMode] = useState<JoinMode>("anyone");
  const [domains, setDomains] = useState<readonly string[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenShareEnabled, setScreenShareEnabled] = useState(true);
  const [maxParticipants, setMaxParticipants] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (server === undefined) {
      return;
    }
    setJoinMode(server.settings.inviteOnly ? "invite" : "anyone");
    setDomains(server.settings.allowedEmailDomains);
    setVoiceEnabled(server.settings.voiceEnabled ?? true);
    setVideoEnabled(server.settings.videoEnabled ?? true);
    setScreenShareEnabled(server.settings.screenShareEnabled ?? true);
    setMaxParticipants(server.settings.maxCallParticipants ?? 10);
  }, [server]);

  useEffect(() => {
    if (!saved) {
      return;
    }
    const timeout = setTimeout(() => setSaved(false), 1800);
    return () => clearTimeout(timeout);
  }, [saved]);

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

  const storedMode: JoinMode = server.settings.inviteOnly ? "invite" : "anyone";
  const dirty =
    joinMode !== storedMode ||
    !sameDomains(domains, server.settings.allowedEmailDomains) ||
    voiceEnabled !== (server.settings.voiceEnabled ?? true) ||
    videoEnabled !== (server.settings.videoEnabled ?? true) ||
    screenShareEnabled !== (server.settings.screenShareEnabled ?? true) ||
    maxParticipants !== (server.settings.maxCallParticipants ?? 10);

  function addDomains() {
    const parsed = parseDomains(domainInput);
    if (parsed.length === 0) {
      return;
    }
    setDomains((current) => [...new Set([...current, ...parsed])]);
    setDomainInput("");
    setSaved(false);
  }

  return (
    <form
      className="flex max-w-[600px] flex-col gap-5"
      data-testid="workspace-settings"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        setBusy(true);
        void updateSettings({
          ...JOIN_MODE_VALUES[joinMode],
          allowedEmailDomains: [...domains],
          voiceEnabled,
          videoEnabled,
          screenShareEnabled,
          maxCallParticipants: maxParticipants,
        })
          .then(() => setSaved(true))
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Could not save settings."),
          )
          .finally(() => setBusy(false));
      }}
    >
      <SettingsSectionHeader
        icon="user-plus"
        title="Joining"
        description={`Who can become a member of ${server.name}, and how they get in.`}
      />

      <div className="overflow-hidden rounded-[14px] border border-border bg-surface-2">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0">
            <span className="block text-[13px] font-medium text-text">
              {joinMode === "anyone" ? "Open to anyone" : "Invite only"}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">
              {joinMode === "anyone"
                ? "People with an allowed email domain can create an account."
                : "New members must redeem an invite before they can join."}
            </span>
          </div>
          <SegmentedControl<JoinMode>
            label="How people join"
            value={joinMode}
            onChange={(value) => {
              setJoinMode(value);
              setSaved(false);
            }}
            options={[
              { value: "anyone", label: "Anyone" },
              { value: "invite", label: "Invite only" },
            ]}
          />
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-3 px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-text">Allowed email domains</span>
            <span className="text-[11px] text-text-muted">
              Restrict sign-ups to specific domains, or leave empty to allow any.
            </span>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Add a domain"
                placeholder="example.com"
                value={domainInput}
                onChange={(event) => setDomainInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addDomains();
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={addDomains}
              disabled={domainInput.trim().length === 0}
            >
              Add
            </Button>
          </div>

          {domains.length === 0 ? (
            <span className="text-[12px] text-text-muted">Any email domain can join.</span>
          ) : (
            <ul className="flex flex-wrap gap-1.5" data-testid="domain-list">
              {domains.map((domain) => (
                <li
                  key={domain}
                  className="flex animate-pop-in items-center gap-1.5 rounded-full border border-border bg-surface-3 py-0.5 pl-2.5 pr-1 text-[11px] text-text-muted"
                >
                  <span className="font-mono">@{domain}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${domain}`}
                    onClick={() => {
                      setDomains((current) => current.filter((entry) => entry !== domain));
                      setSaved(false);
                    }}
                    className="flex h-4 w-4 items-center justify-center rounded-full transition hover:bg-danger/15 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Icon name="x" size={10} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <SettingsSectionHeader
        icon="volume"
        title="Voice &amp; video"
        description="Turn calling on or off, and choose which parts members can use."
      />

      <div className="overflow-hidden rounded-[14px] border border-border bg-surface-2">
        <div className="px-4 py-2.5">
          <Switch
            checked={voiceEnabled}
            onChange={(value) => {
              setVoiceEnabled(value);
              setSaved(false);
            }}
            label="Enable voice and video calling"
            description="Adds voice channels and call buttons. When off, no one can place a call."
          />
        </div>
        <div className="h-px bg-border" />
        <div className="px-4 py-2.5">
          <Switch
            checked={videoEnabled}
            onChange={(value) => {
              setVideoEnabled(value);
              setSaved(false);
            }}
            label="Allow video"
            description="Members can turn on their cameras in calls."
            disabled={!voiceEnabled}
          />
        </div>
        <div className="h-px bg-border" />
        <div className="px-4 py-2.5">
          <Switch
            checked={screenShareEnabled}
            onChange={(value) => {
              setScreenShareEnabled(value);
              setSaved(false);
            }}
            label="Allow screen sharing"
            description="Members can stream a screen, window or application into a call."
            disabled={!voiceEnabled}
          />
        </div>
        <div className="h-px bg-border" />
        <div className="px-4 py-3.5">
          <Input
            label="Maximum call participants"
            type="number"
            min={2}
            max={50}
            value={String(maxParticipants)}
            onChange={(event) => {
              setMaxParticipants(Number(event.currentTarget.value) || 2);
              setSaved(false);
            }}
            hint="Calls are peer-to-peer; keep this modest for reliable quality."
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={busy} disabled={busy || !dirty}>
          Save changes
        </Button>
        {saved && (
          <span
            className="flex animate-fade-in items-center gap-1 text-[12px] font-medium text-secondary"
            role="status"
          >
            <Icon name="check" size={13} />
            Saved
          </span>
        )}
        {!saved && dirty && !busy && (
          <Text size="xs" tone="muted">
            Unsaved changes
          </Text>
        )}
        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}
      </div>
    </form>
  );
}
