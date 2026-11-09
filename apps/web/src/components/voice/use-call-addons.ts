import { canCreateGuestLinks, hasPermission, Permission } from "@aulora/core";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { useVoice } from "../../providers/VoiceProvider";
import { transcriptionOffer } from "./transcription-offer";

export interface TranscriptionControl {
  readonly active: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
}

export interface CallAddonControls {
  /** Present only when this member may start or stop transcription right now. */
  readonly transcription?: TranscriptionControl;
  /** Present only when this member may create guest links for this call. */
  readonly onInviteGuest?: () => void;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/**
 * The call-addon controls this member is offered, for any call surface (stage,
 * dock, channel pane). The UI only hides controls; the server re-checks every
 * permission, the addon switch and the model state on each call.
 */
export function useCallAddonControls(): CallAddonControls {
  const voice = useVoice();
  const { call, addons, permissions } = voice;
  const callId = call?.id ?? null;
  const transcribing = call?.transcribing === true;
  const holdsStart = hasPermission(permissions, Permission.StartTranscription);
  // The model status is only needed to decide whether to offer Start.
  const status = useQuery(
    api.transcription.status,
    addons.transcription && holdsStart && callId !== null && !transcribing ? {} : "skip",
  );
  const start = useMutation(api.transcription.start);
  const stop = useMutation(api.transcription.stop);
  const [busy, setBusy] = useState(false);
  const sessionId = call?.transcriptionSessionId ?? null;

  const toggle = useCallback(() => {
    if (callId === null) {
      return;
    }
    setBusy(true);
    const work =
      transcribing && sessionId !== null
        ? stop({ sessionId: sessionId as never })
        : start({ callId: callId as never });
    void work
      .catch((error: unknown) => {
        voice.reportError(messageOf(error, "Could not change transcription. Try again."));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [callId, sessionId, transcribing, start, stop, voice]);

  return useMemo<CallAddonControls>(() => {
    const controls: {
      transcription?: TranscriptionControl;
      onInviteGuest?: () => void;
    } = {};
    const offer = transcriptionOffer({
      permissions,
      addonEnabled: addons.transcription,
      modelReady: status?.ready === true,
      serviceInstalled: status?.serviceInstalled === true,
      runtimeReady: status?.runtimeReady === true,
      inCall: callId !== null,
      transcribing,
    });
    if (offer !== "none") {
      controls.transcription = { active: transcribing, busy, onToggle: toggle };
    }
    if (callId !== null && canCreateGuestLinks(permissions, addons.guestCalls)) {
      controls.onInviteGuest = () => {
        voice.setInviteGuestOpen(true);
      };
    }
    return controls;
  }, [
    permissions,
    addons,
    status?.ready,
    status?.serviceInstalled,
    status?.runtimeReady,
    callId,
    transcribing,
    busy,
    toggle,
    voice,
  ]);
}
