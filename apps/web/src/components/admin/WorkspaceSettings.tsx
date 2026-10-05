import { Button, Icon, Input, SegmentedControl, Spinner, Switch, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Callback } from "./callbacks";
import { SaveRow } from "./SettingsSaveRow";
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

interface ServerSettings {
  readonly inviteOnly: boolean;
  readonly signupEnabled?: boolean | undefined;
  readonly allowedEmailDomains: readonly string[];
  readonly voiceEnabled?: boolean | undefined;
  readonly videoEnabled?: boolean | undefined;
  readonly screenShareEnabled?: boolean | undefined;
  readonly maxCallParticipants?: number | undefined;
}

/*
 * One "How people join" choice maps onto the two stored booleans like this:
 *   Anyone can join -> { signupEnabled: true,  inviteOnly: false }
 *   Invite only     -> { signupEnabled: true,  inviteOnly: true  }
 * Sign-up stays enabled in both modes because invited people still have to
 * create their account; `inviteOnly` is what additionally requires an invite.
 */
function joinModeValues(mode: JoinMode): { signupEnabled: boolean; inviteOnly: boolean } {
  return mode === "invite"
    ? { signupEnabled: true, inviteOnly: true }
    : { signupEnabled: true, inviteOnly: false };
}

function sameDomains(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(b);
  return a.every((entry) => set.has(entry));
}

interface SettingsPayload {
  readonly signupEnabled: boolean;
  readonly inviteOnly: boolean;
  readonly allowedEmailDomains: string[];
  readonly voiceEnabled: boolean;
  readonly videoEnabled: boolean;
  readonly screenShareEnabled: boolean;
  readonly maxCallParticipants: number;
}

interface ServerSettingsState {
  readonly joinMode: JoinMode;
  readonly setJoinMode: Callback<[mode: JoinMode]>;
  readonly signupEnabled: boolean;
  readonly setSignupEnabled: Callback<[enabled: boolean]>;
  readonly domains: readonly string[];
  readonly setDomains: Dispatch<SetStateAction<readonly string[]>>;
  readonly domainInput: string;
  readonly setDomainInput: Callback<[value: string]>;
  readonly voiceEnabled: boolean;
  readonly setVoiceEnabled: Callback<[enabled: boolean]>;
  readonly videoEnabled: boolean;
  readonly setVideoEnabled: Callback<[enabled: boolean]>;
  readonly screenShareEnabled: boolean;
  readonly setScreenShareEnabled: Callback<[enabled: boolean]>;
  readonly maxParticipants: number;
  readonly setMaxParticipants: Callback<[value: number]>;
}

function useServerSettings(server: { readonly settings: ServerSettings } | undefined) {
  const [joinMode, setJoinMode] = useState<JoinMode>("anyone");
  const [signupEnabled, setSignupEnabled] = useState(true);
  const [domains, setDomains] = useState<readonly string[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenShareEnabled, setScreenShareEnabled] = useState(true);
  const [maxParticipants, setMaxParticipants] = useState(10);

  useEffect(() => {
    if (server === undefined) {
      return;
    }
    setJoinMode(server.settings.inviteOnly ? "invite" : "anyone");
    setSignupEnabled(server.settings.signupEnabled ?? true);
    setDomains(server.settings.allowedEmailDomains);
    setVoiceEnabled(server.settings.voiceEnabled ?? true);
    setVideoEnabled(server.settings.videoEnabled ?? true);
    setScreenShareEnabled(server.settings.screenShareEnabled ?? true);
    setMaxParticipants(server.settings.maxCallParticipants ?? 10);
  }, [server]);

  return {
    joinMode,
    setJoinMode,
    signupEnabled,
    setSignupEnabled,
    domains,
    setDomains,
    domainInput,
    setDomainInput,
    voiceEnabled,
    setVoiceEnabled,
    videoEnabled,
    setVideoEnabled,
    screenShareEnabled,
    setScreenShareEnabled,
    maxParticipants,
    setMaxParticipants,
  };
}

interface SettingsSaver {
  readonly error: string | null;
  readonly saved: boolean;
  readonly busy: boolean;
  readonly save: Callback<[payload: SettingsPayload]>;
  readonly markEdited: () => void;
}

function useSettingsSaver(
  updateSettings: Callback<[payload: SettingsPayload], Promise<unknown>>,
): SettingsSaver {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!saved) {
      return;
    }
    const timeout = setTimeout(() => {
      setSaved(false);
    }, 1800);
    return () => {
      clearTimeout(timeout);
    };
  }, [saved]);

  function save(payload: SettingsPayload) {
    setError(null);
    setSaved(false);
    setBusy(true);
    void updateSettings(payload)
      .then(() => {
        setSaved(true);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not save settings.");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return {
    error,
    saved,
    busy,
    save,
    markEdited: () => {
      setSaved(false);
    },
  };
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
  const state = useServerSettings(server);
  const saver = useSettingsSaver((payload) => updateSettings(payload));

  if (!canManageWorkspace) {
    return (
      <Text tone="muted" size="sm" data-testid="workspace-settings-locked">
        You need the Manage workspace permission to change these settings.
      </Text>
    );
  }

  if (server === undefined) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={22} label="Loading settings" />
      </div>
    );
  }

  const storedMode: JoinMode = server.settings.inviteOnly ? "invite" : "anyone";
  const dirty =
    state.joinMode !== storedMode ||
    state.signupEnabled !== server.settings.signupEnabled ||
    !sameDomains(state.domains, server.settings.allowedEmailDomains) ||
    state.voiceEnabled !== (server.settings.voiceEnabled ?? true) ||
    state.videoEnabled !== (server.settings.videoEnabled ?? true) ||
    state.screenShareEnabled !== (server.settings.screenShareEnabled ?? true) ||
    state.maxParticipants !== (server.settings.maxCallParticipants ?? 10);

  return (
    <form
      className="flex w-full flex-col gap-5"
      data-testid="workspace-settings"
      onSubmit={(event) => {
        event.preventDefault();
        saver.save({
          ...joinModeValues(state.joinMode),
          signupEnabled: state.signupEnabled,
          allowedEmailDomains: [...state.domains],
          voiceEnabled: state.voiceEnabled,
          videoEnabled: state.videoEnabled,
          screenShareEnabled: state.screenShareEnabled,
          maxCallParticipants: state.maxParticipants,
        });
      }}
    >
      <JoiningSettings serverName={server.name} state={state} onEdited={saver.markEdited} />

      <VoiceSettings state={state} onEdited={saver.markEdited} />

      <SaveRow busy={saver.busy} dirty={dirty} saved={saver.saved} error={saver.error} />
    </form>
  );
}

function JoiningSettings({
  serverName,
  state,
  onEdited,
}: {
  readonly serverName: string;
  readonly state: ServerSettingsState;
  readonly onEdited: () => void;
}) {
  const {
    joinMode,
    setJoinMode,
    signupEnabled,
    setSignupEnabled,
    domains,
    setDomains,
    domainInput,
    setDomainInput,
  } = state;

  function addDomains() {
    const parsed = parseDomains(domainInput);
    if (parsed.length === 0) {
      return;
    }
    setDomains((current) => [...new Set([...current, ...parsed])]);
    setDomainInput("");
    onEdited();
  }

  function removeDomain(domain: string) {
    setDomains((current) => current.filter((entry) => entry !== domain));
    onEdited();
  }

  return (
    <>
      <SettingsSectionHeader
        icon="user-plus"
        title="Joining"
        description={`Who can become a member of ${serverName}, and how they get in.`}
      />

      <JoinModeCard
        joinMode={joinMode}
        onChange={(value) => {
          setJoinMode(value);
          onEdited();
        }}
      />

      <DomainsCard
        domains={domains}
        domainInput={domainInput}
        onDomainInputChange={setDomainInput}
        onAddDomains={addDomains}
        onRemoveDomain={removeDomain}
      />

      <div className="overflow-hidden rounded-[14px] border border-border bg-surface-2 px-4 py-2.5">
        <Switch
          checked={signupEnabled}
          onChange={(value) => {
            setSignupEnabled(value);
            onEdited();
          }}
          label="Allow account creation"
          description="When off, no one can create an account here — existing members keep full access."
        />
      </div>
    </>
  );
}

function JoinModeCard({
  joinMode,
  onChange,
}: {
  readonly joinMode: JoinMode;
  readonly onChange: Callback<[mode: JoinMode]>;
}) {
  return (
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
          onChange={onChange}
          options={[
            { value: "anyone", label: "Anyone" },
            { value: "invite", label: "Invite only" },
          ]}
        />
      </div>
    </div>
  );
}

function DomainsCard({
  domains,
  domainInput,
  onDomainInputChange,
  onAddDomains,
  onRemoveDomain,
}: {
  readonly domains: readonly string[];
  readonly domainInput: string;
  readonly onDomainInputChange: Callback<[value: string]>;
  readonly onAddDomains: () => void;
  readonly onRemoveDomain: Callback<[domain: string]>;
}) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-surface-2">
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
              onChange={(event) => {
                onDomainInputChange(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onAddDomains();
                }
              }}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={onAddDomains}
            disabled={domainInput.trim().length === 0}
          >
            Add
          </Button>
        </div>

        <DomainChips domains={domains} onRemoveDomain={onRemoveDomain} />
      </div>
    </div>
  );
}

function DomainChips({
  domains,
  onRemoveDomain,
}: {
  readonly domains: readonly string[];
  readonly onRemoveDomain: Callback<[domain: string]>;
}) {
  if (domains.length === 0) {
    return <span className="text-[12px] text-text-muted">Any email domain can join.</span>;
  }
  return (
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
              onRemoveDomain(domain);
            }}
            className="flex h-4 w-4 items-center justify-center rounded-full transition hover:bg-danger/15 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Icon name="x" size={10} />
          </button>
        </li>
      ))}
    </ul>
  );
}

interface VoiceToggleSpec {
  readonly key: string;
  readonly checked: boolean;
  readonly label: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly onChange: Callback<[value: boolean]>;
}

function voiceToggleSpecs(state: ServerSettingsState, onEdited: () => void): VoiceToggleSpec[] {
  return [
    {
      key: "voice",
      checked: state.voiceEnabled,
      label: "Enable voice and video calling",
      description: "Adds voice channels and call buttons. When off, no one can place a call.",
      disabled: false,
      onChange: (value: boolean) => {
        state.setVoiceEnabled(value);
        onEdited();
      },
    },
    {
      key: "video",
      checked: state.videoEnabled,
      label: "Allow video",
      description: "Members can turn on their cameras in calls.",
      disabled: !state.voiceEnabled,
      onChange: (value: boolean) => {
        state.setVideoEnabled(value);
        onEdited();
      },
    },
    {
      key: "screen",
      checked: state.screenShareEnabled,
      label: "Allow screen sharing",
      description: "Members can stream a screen, window or application into a call.",
      disabled: !state.voiceEnabled,
      onChange: (value: boolean) => {
        state.setScreenShareEnabled(value);
        onEdited();
      },
    },
  ];
}

function VoiceSettings({
  state,
  onEdited,
}: {
  readonly state: ServerSettingsState;
  readonly onEdited: () => void;
}) {
  return (
    <>
      <SettingsSectionHeader
        icon="volume"
        title="Voice &amp; video"
        description="Turn calling on or off, and choose which parts members can use."
      />

      <div className="overflow-hidden rounded-[14px] border border-border bg-surface-2">
        {voiceToggleSpecs(state, onEdited).map((toggle) => (
          <div key={toggle.key} className="px-4 py-2.5">
            <Switch
              checked={toggle.checked}
              onChange={toggle.onChange}
              label={toggle.label}
              description={toggle.description}
              disabled={toggle.disabled}
            />
          </div>
        ))}
        <div className="h-px bg-border" />
        <div className="px-4 py-3.5">
          <Input
            label="Maximum call participants"
            type="number"
            min={2}
            max={50}
            value={String(state.maxParticipants)}
            onChange={(event) => {
              state.setMaxParticipants(Number(event.currentTarget.value) || 2);
              onEdited();
            }}
            hint="Calls are peer-to-peer; keep this modest for reliable quality."
          />
        </div>
      </div>
    </>
  );
}
