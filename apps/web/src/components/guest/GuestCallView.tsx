import { callKindLabel } from "@aulora/core";
import { Badge, Icon, Spinner } from "@aulora/ui-web";
import type { ConvexReactClient } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { guestPageOrigin } from "../../lib/public-origin";
import { transcriptionClient, useTranscriptionClient } from "../../lib/transcription/client-state";
import { VoiceLevelsProvider } from "../../providers/voice-levels";
import { RemoteAudio } from "../../providers/voice-remote-audio";
import { CallControls } from "../voice/CallControls";
import { CallGrid } from "../voice/CallParticipant";
import { useCallDuration } from "../voice/hooks";
import { TranscriptionBadge } from "../voice/TranscriptionIndicator";
import { TranscriptionNoticeView } from "../voice/TranscriptionNoticeView";
import { TranscriptionRuntime } from "../voice/TranscriptionRuntime";
import type { GuestEngine } from "./use-guest-engine";

/**
 * The reduced call a guest sees: the people in the call, the microphone and
 * camera, and Leave. No chat, channels, files or screen sharing: none of those
 * exist for a guest, here or on the server.
 */
export function GuestCallView({
  engine,
  client,
  sessionToken,
  selfKey,
  title,
  onLeave,
}: {
  readonly engine: GuestEngine;
  readonly client: ConvexReactClient;
  readonly sessionToken: string;
  /** This guest's own participant key (their guest session id). */
  readonly selfKey: string;
  readonly title: string;
  readonly onLeave: () => void;
}) {
  const { snapshot, levels, settings } = engine;
  const call = snapshot.call;
  const duration = useCallDuration(call?.startedAt ?? null);
  const transcription = useTranscriptionClient();
  const identity = useMemo(
    () => ({
      nameOf: (id: string) => {
        const participant = call?.participants.find((entry) => entry.userId === id);
        return participant?.displayName ?? "Participant";
      },
    }),
    [call],
  );

  return (
    <VoiceLevelsProvider store={levels}>
      <div className="flex h-dvh flex-col bg-bg text-text">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <Icon name="video" size={18} className="shrink-0 text-text-muted" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14px] font-semibold">{title}</h1>
            <p className="truncate text-[11px] tabular-nums text-text-muted">
              {call !== null
                ? `${callKindLabel(call.kind)} · ${duration} · ${call.participants.length} in call`
                : "Joining…"}
            </p>
          </div>
          {call?.transcribing === true && <TranscriptionBadge />}
          <Badge title="You joined from an invite link">Guest</Badge>
        </header>

        {snapshot.mediaError !== null && (
          <p
            role="status"
            className="mx-3 mt-2 flex items-center gap-2 rounded-[8px] border border-idle/30 bg-idle/10 px-3 py-2 text-[12px] text-idle"
          >
            <Icon name="mic-off" size={14} className="shrink-0" />
            {snapshot.mediaError}
          </p>
        )}
        {snapshot.error !== null && (
          <p
            role="alert"
            className="mx-3 mt-2 rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger"
          >
            {snapshot.error}
          </p>
        )}
        {call?.transcribing === true && (
          <TranscriptionNoticeView
            state={transcription}
            className="mx-3 mt-2"
            onOptOutChange={(optedOut) => {
              transcriptionClient.setOptedOut(optedOut);
            }}
            onResume={() => {
              transcriptionClient.requestResume();
            }}
          />
        )}

        <div className="min-h-0 flex-1 p-3">
          {call === null ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size={28} label="Joining the call" />
            </div>
          ) : (
            <CallGrid
              participants={call.participants}
              streams={snapshot.remoteStreams}
              localUserId={selfKey}
              localVideoTrack={snapshot.localVideoTrack}
              settings={settings}
              identity={identity}
              speakingIds={snapshot.remoteSpeaking}
              localSpeaking={snapshot.localSpeaking}
              className="h-full"
            />
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-center border-t border-border px-4 py-3">
          <CallControls
            muted={snapshot.local.muted}
            deafened={false}
            video={snapshot.local.video}
            sharingScreen={false}
            canSpeak
            canDeafen={false}
            canVideo
            canStream={false}
            onToggleMute={() => {
              engine.setMuted(!snapshot.local.muted);
            }}
            onToggleDeafen={() => undefined}
            onToggleCamera={() => {
              engine.setCamera(!snapshot.local.video);
            }}
            onToggleScreen={() => undefined}
            onLeave={onLeave}
          />
        </footer>

        <RemoteAudio
          streams={snapshot.remoteStreams}
          deafened={false}
          outputDeviceId={settings.outputDeviceId}
          outputVolume={settings.outputVolume}
        />
        <TranscriptionRuntime
          sessionId={call?.transcribing === true ? (call.transcriptionSessionId ?? null) : null}
          micStream={snapshot.micStream}
          transmitting={snapshot.transmitting}
          origin={guestPageOrigin()}
          mint={async () => {
            const minted = await client.mutation(api.guestCalls.mintAudioToken, { sessionToken });
            return { token: minted.token, wsPath: minted.wsPath };
          }}
        />
      </div>
    </VoiceLevelsProvider>
  );
}
