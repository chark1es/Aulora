import { DEFAULT_FEATURE_FLAGS, type VoiceDeviceSettings } from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { guestClientId } from "../../lib/guest/client-id";
import { guestVoicePort, guestVoiceSubscriptions } from "../../lib/guest/guest-voice";
import { sendGuestLeaveBeacon } from "../../lib/guest/leave-beacon";
import { VoiceEngine, type VoiceSnapshot } from "../../lib/voice/call-engine";
import { readVoiceSettings } from "../../lib/voice/device-settings";
import { VoiceLevelsStore } from "../../lib/voice/levels";
import type { GuestMediaChoices } from "./DeviceCheck";

const GUEST_FLAGS = {
  ...DEFAULT_FEATURE_FLAGS,
  // Guests only ever use the peer mesh, never the streaming server.
  disableNewCallTransport: true,
};

export interface GuestEngine {
  readonly snapshot: VoiceSnapshot;
  readonly levels: VoiceLevelsStore;
  readonly settings: VoiceDeviceSettings;
  setMuted(muted: boolean): void;
  setCamera(on: boolean): void;
  leave(): Promise<void>;
}

/**
 * Runs the existing call engine for a guest, over `guestCalls.*`. The engine is
 * the same one members use; only its backend differs. It is disposed with the
 * component without telling the server, so React's development double-mount can
 * never make a guest leave: leaving is the Leave button or closing the tab.
 */
export function useGuestEngine(args: {
  readonly client: ConvexReactClient;
  readonly convexUrl: string;
  readonly sessionToken: string;
  readonly selfKey: string;
  readonly callId: string;
  readonly choices: GuestMediaChoices;
  readonly iceServers: readonly RTCIceServer[];
  /**
   * The engine stopped on its own after joining: the call ended, the session ran
   * out, or the guest was removed. Without this the page would sit on "Joining…".
   */
  readonly onEnded: () => void;
}): GuestEngine | null {
  const { client, convexUrl, sessionToken, selfKey, callId, choices } = args;
  const onEndedRef = useRef(args.onEnded);
  onEndedRef.current = args.onEnded;
  const [levels] = useState(() => new VoiceLevelsStore());
  const settings = useRef<VoiceDeviceSettings>({
    ...readVoiceSettings(),
    joinMuted: !choices.micOn,
    joinWithCamera: choices.cameraOn,
    inputDeviceId: choices.inputDeviceId,
    cameraDeviceId: choices.cameraDeviceId,
  });
  const iceRef = useRef(args.iceServers);
  iceRef.current = args.iceServers;
  const engineRef = useRef<VoiceEngine | null>(null);
  const [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);

  useEffect(() => {
    const engine = new VoiceEngine({
      port: guestVoicePort(client, sessionToken),
      subscriptions: guestVoiceSubscriptions(client, sessionToken, selfKey),
      userId: selfKey,
      clientId: guestClientId(),
      getSettings: () => settings.current,
      getIceServers: () => iceRef.current,
      getFeatureFlags: () => GUEST_FLAGS,
      levels,
    });
    engineRef.current = engine;
    setSnapshot(engine.getSnapshot());
    let attached = false;
    let disposed = false;
    const unsubscribe = engine.subscribe(() => {
      setSnapshot(engine.getSnapshot());
      if (attached && !disposed && !engine.isActive()) {
        onEndedRef.current();
      }
    });
    void engine.attachToCall(callId).then(() => {
      attached = true;
      if (!disposed && !engine.isActive()) {
        onEndedRef.current();
      }
    });
    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted && engine.isActive()) {
        sendGuestLeaveBeacon({ convexUrl, sessionToken });
        engine.abandon();
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      disposed = true;
      window.removeEventListener("pagehide", onPageHide);
      unsubscribe();
      engine.dispose();
      engineRef.current = null;
    };
  }, [client, convexUrl, sessionToken, selfKey, callId, levels]);

  if (snapshot === null) {
    return null;
  }
  return {
    snapshot,
    levels,
    settings: settings.current,
    setMuted: (muted) => {
      void engineRef.current?.setMuted(muted);
    },
    setCamera: (on) => {
      void engineRef.current?.setCamera(on);
    },
    leave: async () => {
      await engineRef.current?.leave();
    },
  };
}
