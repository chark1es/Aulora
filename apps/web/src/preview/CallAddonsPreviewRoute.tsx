import { Permission } from "@aulora/core";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { useEffect, useMemo, useState } from "react";
import { TranscriptionSettings } from "../components/admin/TranscriptionSettings";
import { DEFAULT_GUEST_CHOICES } from "../components/guest/DeviceCheck";
import { GuestJoinForm } from "../components/guest/GuestJoinForm";
import { GuestMessageScreen } from "../components/guest/GuestMessageScreen";
import { ScheduledCallsView } from "../components/scheduled/ScheduledCallsView";
import { TranscriptsView } from "../components/transcripts/TranscriptsView";
import { LobbyList } from "../components/voice/GuestLobbyPrompt";
import { GuestLinkDialog } from "../components/voice/InviteGuestDialog";
import {
  TranscriptionBadge,
  TranscriptionIndicator,
} from "../components/voice/TranscriptionIndicator";
import { TranscriptionNoticeView } from "../components/voice/TranscriptionNoticeView";
import { applyTheme, type ResolvedTheme } from "../lib/theme";
import type { TranscriptionClientState } from "../lib/transcription/client-state";
import { type VoicePolicy, VoiceProvider } from "../providers/VoiceProvider";

/**
 * Dev-only visual harness for the call addons. It renders the real components
 * over fixtures served by a fake Convex client, so each surface can be checked
 * (and captured) in both themes and at phone width without a backend.
 * Registered at `/__preview/calls` only in development builds.
 *
 *   /__preview/calls?view=scheduled&theme=dark
 *   views: scheduled, transcripts, admin, guest-lobby, guest-wait, guest-link,
 *          lobby, invite, notice
 */

const NOW = Date.now();
const HOUR = 3_600_000;
const MIN = 60_000;

function scheduledCall(
  id: string,
  title: string,
  startsAt: number,
  extra: Record<string, unknown>,
) {
  return {
    id,
    title,
    description: "",
    startsAt,
    durationMinutes: 30,
    openLeadMinutes: 5,
    opensAt: startsAt - 5 * MIN,
    channelId: null,
    inviteeUserIds: ["u2", "u3"],
    inviteeRoleIds: [],
    createdBy: "me",
    status: "scheduled",
    callId: null,
    canManage: true,
    canJoin: true,
    ...extra,
  };
}

const FIXTURES: Record<string, unknown> = {
  "scheduledCalls:list": [
    scheduledCall("a", "Design review", NOW + 2 * MIN, {
      description: "Walk through the new lobby.",
    }),
    scheduledCall("b", "Weekly sync", NOW + 3 * HOUR, { inviteeRoleIds: ["r1"] }),
    scheduledCall("c", "Customer onboarding", NOW + 26 * HOUR, { canManage: false }),
    scheduledCall("d", "Retro", NOW - 30 * HOUR, { status: "ended" }),
    scheduledCall("e", "Planning", NOW + 5 * HOUR, { status: "cancelled" }),
  ],
  "transcription:listSessions": [
    {
      id: "s1",
      callId: "c1",
      channelId: null,
      startedBy: "me",
      startedAt: NOW - 2 * HOUR,
      endedAt: NOW - HOUR,
      status: "ended",
      summaryStatus: "ready",
      summaryConfigured: true,
      segmentCount: 4,
      retentionExpiresAt: NOW + 20 * 24 * HOUR,
    },
    {
      id: "s2",
      callId: "c2",
      channelId: null,
      startedBy: "me",
      startedAt: NOW - 20 * MIN,
      endedAt: null,
      status: "active",
      summaryStatus: "none",
      summaryConfigured: true,
      segmentCount: 2,
      retentionExpiresAt: null,
    },
  ],
  "transcription:getSession": {
    id: "s1",
    callId: "c1",
    channelId: null,
    startedBy: "me",
    startedAt: NOW - 2 * HOUR,
    endedAt: NOW - HOUR,
    status: "ended",
    summaryStatus: "ready",
    summaryConfigured: true,
    summary: JSON.stringify({
      overview:
        "The team agreed to ship the guest lobby on Friday and to follow up on the TURN relay.",
      keyPoints: [
        "Guests wait in a lobby until admitted",
        "Transcription notice is shown to everyone",
      ],
      decisions: ["Ship on Friday"],
      actionItems: [
        { text: "Write the docs page", owner: "Sam" },
        { text: "Check the relay", owner: null },
      ],
      speakerHighlights: [{ speaker: "Ada", text: "Wants the notice to be impossible to miss." }],
      language: "en",
    }),
    summaryModel: "openai/gpt-4o-mini",
    summaryAt: NOW - HOUR,
    summaryError: null,
    segmentCount: 4,
    retentionExpiresAt: NOW + 20 * 24 * HOUR,
  },
  "transcription:listSegments": {
    page: [
      {
        id: "g1",
        seq: 1,
        speakerKey: "user:me",
        speakerName: "Ada Lovelace",
        text: "Thanks for joining everyone.",
        startMs: 2_000,
        endMs: 4_000,
        confidence: 0.9,
        language: "en",
      },
      {
        id: "g2",
        seq: 2,
        speakerKey: "user:me",
        speakerName: "Ada Lovelace",
        text: "Let's start with the lobby.",
        startMs: 5_000,
        endMs: 7_000,
        confidence: 0.9,
        language: "en",
      },
      {
        id: "g3",
        seq: 1,
        speakerKey: "guest:g1",
        speakerName: "Alex Visitor",
        text: "Sounds good to me.",
        startMs: 8_000,
        endMs: 10_000,
        confidence: 0.9,
        language: "en",
      },
      {
        id: "g4",
        seq: 3,
        speakerKey: "user:me",
        speakerName: "Ada Lovelace",
        text: "Great.",
        startMs: 12_000,
        endMs: 13_000,
        confidence: 0.9,
        language: "en",
      },
    ],
    nextCursor: null,
  },
  "transcription:status": {
    enabled: true,
    modelId: "base",
    modelStatus: "ready",
    modelProgress: null,
    ready: true,
    runtimeReady: true,
    retentionDays: 30,
    serviceInstalled: true,
  },
  "transcription:getConfig": {
    modelId: "base",
    modelStatus: "downloading",
    // The server reports null (indeterminate) while a download runs, not a fake 0.
    modelProgress: null,
    modelError: null,
    provider: "openai_compatible",
    baseUrl: "https://llm.example.com/v1",
    model: "gpt-x",
    hasApiKey: true,
    summaryLanguage: null,
    summaryStyle: null,
    retentionDays: 30,
    allowPrivateEndpoint: false,
    updatedAt: 1,
    availableModels: ["tiny", "base", "small", "medium", "large-v3-turbo"],
    serviceInstalled: true,
  },
  "guestCalls:preview": { title: "Design review", open: true, startsAt: null, opensAt: null },
  "guestCalls:lobbyAccess": { canManage: true },
  "guestCalls:lobbyList": {
    pending: [
      {
        guestSessionId: "g1",
        displayName: "Alex Visitor",
        affiliation: "Acme Studio",
        requestedAt: NOW,
        expiresAt: NOW + 10 * MIN,
      },
      {
        guestSessionId: "g2",
        displayName: "Sam Rivera",
        affiliation: null,
        requestedAt: NOW,
        expiresAt: NOW + 10 * MIN,
      },
    ],
    admitted: [
      {
        guestSessionId: "g3",
        displayName: "Kim Park",
        affiliation: null,
        admittedAt: NOW,
        expiresAt: NOW + HOUR,
      },
    ],
  },
  "guestCalls:links": [
    {
      id: "l1",
      createdBy: "me",
      createdAt: NOW - 10 * MIN,
      expiresAt: NOW + 50 * MIN,
      maxUses: 5,
      uses: 1,
      revoked: false,
      label: null,
    },
    {
      id: "l2",
      createdBy: "me",
      createdAt: NOW - 3 * HOUR,
      expiresAt: NOW - HOUR,
      maxUses: 5,
      uses: 5,
      revoked: false,
      label: null,
    },
  ],
};

/** A stand-in for the Convex client that answers every query from fixtures. */
function fakeClient(): ConvexReactClient {
  const client = {
    url: "https://preview.invalid",
    watchQuery(query: Parameters<typeof getFunctionName>[0]) {
      const value = FIXTURES[getFunctionName(query)] ?? null;
      return {
        onUpdate: () => () => undefined,
        localQueryResult: () => value,
        localQueryLogs: () => undefined,
        journal: () => undefined,
      };
    },
    mutation: () => Promise.resolve(null),
    action: () => Promise.resolve({ ok: true, model: "gpt-x" }),
    connectionState: () => ({ isWebSocketConnected: true }),
    subscribeToConnectionState: () => () => undefined,
    close: () => Promise.resolve(),
  };
  return client as unknown as ConvexReactClient;
}

const POLICY: VoicePolicy = {
  enabled: true,
  videoEnabled: true,
  screenShareEnabled: true,
  maxParticipants: 10,
  iceServers: [],
};

const noticeState = (extra: Partial<TranscriptionClientState>): TranscriptionClientState => ({
  sessionId: "s1",
  phase: "live",
  optedOut: false,
  stream: { kind: "streaming", sending: true },
  ...extra,
});

function Notices() {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3 p-6">
      <div className="flex items-center gap-3">
        <TranscriptionIndicator size={20} />
        <TranscriptionIndicator size={32} />
        <TranscriptionBadge />
      </div>
      <TranscriptionNoticeView
        state={noticeState({ phase: "notice" })}
        onOptOutChange={() => undefined}
      />
      <TranscriptionNoticeView state={noticeState({})} onOptOutChange={() => undefined} />
      <TranscriptionNoticeView
        state={noticeState({ optedOut: true })}
        onOptOutChange={() => undefined}
      />
      <TranscriptionNoticeView
        state={noticeState({ stream: { kind: "reconnecting", attempt: 2 } })}
        onOptOutChange={() => undefined}
      />
      <TranscriptionNoticeView state={noticeState({})} compact onOptOutChange={() => undefined} />
    </div>
  );
}

export function CallAddonsPreviewRoute() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") ?? "notice";
  const theme: ResolvedTheme = params.get("theme") === "light" ? "light" : "dark";
  const client = useMemo(fakeClient, []);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    applyTheme(theme);
    setReady(true);
  }, [theme]);
  if (!ready) {
    return null;
  }
  const permissions = Permission.Administrator;
  return (
    <ConvexProvider client={client}>
      <VoiceProvider
        client={client}
        userId="me"
        permissions={permissions}
        policy={POLICY}
        addons={{ transcription: true, guestCalls: true, scheduledCalls: true }}
      >
        <div className="flex h-full min-h-0 flex-1 flex-col bg-bg text-text">
          {view === "scheduled" && (
            <ScheduledCallsView
              ownUserId="me"
              permissions={permissions}
              members={[
                { userId: "u2", displayName: "Sam Rivera" },
                { userId: "u3", displayName: "Kim Park" },
              ]}
              roles={[]}
              channels={[]}
              titles={new Map()}
              guestCallsEnabled
              onBack={() => undefined}
            />
          )}
          {view === "transcripts" && (
            <TranscriptsView
              permissions={permissions}
              titles={new Map()}
              onBack={() => undefined}
            />
          )}
          {view === "admin" && (
            <div className="mx-auto w-full max-w-[720px] overflow-y-auto p-6">
              <TranscriptionSettings />
            </div>
          )}
          {view === "guest-lobby" && (
            <GuestJoinForm
              linkToken="agu_preview"
              choices={DEFAULT_GUEST_CHOICES}
              onChoices={() => undefined}
              busy={false}
              failure={null}
              onTitle={() => undefined}
              onSubmit={() => undefined}
            />
          )}
          {view === "guest-wait" && (
            <GuestMessageScreen icon="clock" title="Waiting to be let in">
              Alex, someone in the call will let you in shortly. Keep this page open.
            </GuestMessageScreen>
          )}
          {view === "guest-link" && (
            <GuestMessageScreen icon="link" title="This guest link isn't available">
              It may have expired, been replaced or used up. Ask the person who invited you for a
              new link.
            </GuestMessageScreen>
          )}
          {view === "lobby" && <LobbyList callId="call1" />}
          {view === "invite" && (
            <GuestLinkDialog
              target={{ channelId: "ch1" }}
              callId="call1"
              onClose={() => undefined}
            />
          )}
          {view === "notice" && <Notices />}
        </div>
      </VoiceProvider>
    </ConvexProvider>
  );
}
