import {
  type MediaDeviceInfo as AuloraMediaDevice,
  type CallKind,
  type CallView,
  claimCallSeat,
  hasPermission,
  Permission,
  type VoiceDeviceSettings,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Alert } from "react-native";
import type { MobileVoiceEngine, MobileVoiceSnapshot } from "../lib/voice/call-engine";
import {
  useVoiceClientId,
  useVoiceDevices,
  useVoiceEngine,
  useVoicePolicy,
  useVoiceSettings,
  useVoiceUi,
} from "./voice-provider-engine";
import {
  type ActiveCallsRef,
  type CallViewMode,
  type EngineRef,
  VoiceContext,
  type VoiceContextValue,
  type VoiceControls,
  type VoiceFlags,
  type VoicePolicy,
} from "./voice-provider-types";

function useStartCall(
  engineRef: EngineRef,
  activeCallsRef: ActiveCallsRef,
  userId: string,
  clientId: string | null,
  setView: Dispatch<SetStateAction<CallViewMode>>,
) {
  return useCallback(
    async (channelId: string, kind: CallKind, ringingUserIds?: readonly string[]) => {
      const engine = engineRef.current;
      if (engine === null) {
        return null;
      }
      const result = await claimCallSeat({
        calls: activeCallsRef.current,
        userId,
        clientId,
        confirm: () => confirmSwitchDevice(),
        run: (takeover) =>
          engine.startCall({
            channelId,
            kind,
            ...(ringingUserIds !== undefined ? { ringingUserIds } : {}),
            ...(takeover ? { takeover: true } : {}),
          }),
      });
      if (result.status === "joined") {
        setView("stage");
        return result.callId;
      }
      return null;
    },
    [clientId, userId, engineRef, activeCallsRef, setView],
  );
}

function useJoinCall(
  engineRef: EngineRef,
  activeCallsRef: ActiveCallsRef,
  userId: string,
  clientId: string | null,
  setView: Dispatch<SetStateAction<CallViewMode>>,
) {
  return useCallback(
    async (callId: string) => {
      const engine = engineRef.current;
      if (engine === null) {
        return false;
      }
      const result = await claimCallSeat({
        calls: activeCallsRef.current,
        userId,
        clientId,
        confirm: () => confirmSwitchDevice(),
        run: (takeover) => engine.joinCall(callId, takeover ? { takeover: true } : {}),
      });
      if (result.status === "joined") {
        setView("stage");
        return true;
      }
      return false;
    },
    [clientId, userId, engineRef, activeCallsRef, setView],
  );
}

function useSessionControls(engineRef: EngineRef, setView: Dispatch<SetStateAction<CallViewMode>>) {
  const declineCall = useCallback(
    async (callId: string) => {
      await engineRef.current?.declineCall(callId);
    },
    [engineRef],
  );
  const leave = useCallback(async () => {
    await engineRef.current?.leave();
    setView("hidden");
  }, [engineRef, setView]);
  const endCall = useCallback(async () => {
    await engineRef.current?.endCall();
    setView("hidden");
  }, [engineRef, setView]);
  const setMuted = useCallback(
    async (muted: boolean) => {
      await engineRef.current?.setMuted(muted);
    },
    [engineRef],
  );
  const setDeafened = useCallback(
    (deafened: boolean) => {
      engineRef.current?.setDeafened(deafened);
    },
    [engineRef],
  );
  const setCamera = useCallback(
    async (on: boolean) => {
      await engineRef.current?.setCamera(on);
    },
    [engineRef],
  );
  const setScreenSharing = useCallback(
    async (on: boolean) => {
      await engineRef.current?.setScreenSharing(on);
    },
    [engineRef],
  );
  const clearError = useCallback(() => {
    engineRef.current?.clearError();
  }, [engineRef]);
  return {
    declineCall,
    leave,
    endCall,
    setMuted,
    setDeafened,
    setCamera,
    setScreenSharing,
    clearError,
  };
}

function useVoiceControls(
  engineRef: EngineRef,
  activeCallsRef: ActiveCallsRef,
  userId: string,
  clientId: string | null,
  setView: Dispatch<SetStateAction<CallViewMode>>,
): VoiceControls {
  const startCall = useStartCall(engineRef, activeCallsRef, userId, clientId, setView);
  const joinCall = useJoinCall(engineRef, activeCallsRef, userId, clientId, setView);
  const session = useSessionControls(engineRef, setView);
  const acceptCall = useCallback(
    async (call: CallView) => {
      await joinCall(call.id);
    },
    [joinCall],
  );
  return { startCall, joinCall, acceptCall, ...session };
}

function useVoiceFlags(viewerPermissions: bigint, policy: VoicePolicy): VoiceFlags {
  return {
    canConnect: policy.enabled && hasPermission(viewerPermissions, Permission.Connect),
    canSpeak: hasPermission(viewerPermissions, Permission.Speak),
    canStream: policy.screenShareEnabled && hasPermission(viewerPermissions, Permission.Stream),
    canVideo: policy.videoEnabled && hasPermission(viewerPermissions, Permission.UseVideo),
  };
}

function useVoiceContextValue(input: {
  readonly snapshot: MobileVoiceSnapshot;
  readonly userId: string;
  readonly clientId: string | null;
  readonly policy: VoicePolicy;
  readonly incoming: readonly CallView[];
  readonly activeCalls: readonly CallView[];
  readonly settings: VoiceDeviceSettings;
  readonly devices: readonly AuloraMediaDevice[];
  readonly flags: VoiceFlags;
  readonly view: CallViewMode;
  readonly pipPinned: boolean;
  readonly setView: Dispatch<SetStateAction<CallViewMode>>;
  readonly setPipPinned: Dispatch<SetStateAction<boolean>>;
  readonly controls: VoiceControls;
  readonly updateSettings: (_partial: Partial<VoiceDeviceSettings>) => Promise<void>;
  readonly refreshDevices: () => Promise<void>;
}): VoiceContextValue {
  const {
    snapshot,
    userId,
    clientId,
    policy,
    incoming,
    activeCalls,
    settings,
    devices,
    flags,
    view,
    pipPinned,
    setView,
    setPipPinned,
    controls,
    updateSettings,
    refreshDevices,
  } = input;
  return useMemo<VoiceContextValue>(
    () => ({
      ...snapshot,
      selfUserId: userId,
      clientId,
      policy,
      incoming,
      activeCalls,
      settings,
      devices,
      ...flags,
      view,
      pipPinned,
      setView,
      setPipPinned,
      ...controls,
      updateSettings,
      refreshDevices,
    }),
    [
      snapshot,
      userId,
      clientId,
      policy,
      incoming,
      activeCalls,
      settings,
      devices,
      flags,
      view,
      pipPinned,
      setView,
      setPipPinned,
      controls,
      updateSettings,
      refreshDevices,
    ],
  );
}

/**
 * Owns the call engine for one signed-in device: the WebRTC mesh, the media
 * devices and the call UI mode. Mounted inside {@link VoiceProvider} so it can
 * read the viewer's resolved permission bitfield without duplicating that
 * resolution; every call surface talks to it through {@link useVoice}.
 */
export function useVoiceValue(input: {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly viewerPermissions: bigint;
}) {
  const { client, userId, viewerPermissions } = input;
  const clientId = useVoiceClientId();
  const policy = useVoicePolicy();
  const engineRef = useRef<MobileVoiceEngine | null>(null);
  const { settings, settingsRef, updateSettings } = useVoiceSettings(engineRef);
  const { devices, refreshDevices } = useVoiceDevices();
  const { snapshot, incoming, activeCalls } = useVoiceEngine(
    client,
    clientId,
    userId,
    policy,
    settingsRef,
    engineRef,
  );
  const ui = useVoiceUi(snapshot.callId !== null);
  const activeCallsRef = useRef(activeCalls);
  activeCallsRef.current = activeCalls;
  const controls = useVoiceControls(engineRef, activeCallsRef, userId, clientId, ui.setView);
  const flags = useVoiceFlags(viewerPermissions, policy);
  const value = useVoiceContextValue({
    snapshot,
    userId,
    clientId,
    policy,
    incoming,
    activeCalls,
    settings,
    devices,
    flags,
    ...ui,
    controls,
    updateSettings,
    refreshDevices,
  });

  return { value, snapshot, settings };
}

/**
 * Remote audio routing. Native WebRTC plays remote audio through the platform
 * session; this component only applies the local deafen flag to the remote
 * tracks, which is the one routing control available without a native audio
 * session module.
 */
export function RemoteAudio({
  streams,
  deafened,
  volume,
}: {
  readonly streams: ReadonlyMap<string, { getAudioTracks(): { enabled: boolean }[] }>;
  readonly deafened: boolean;
  readonly volume: number;
}) {
  useEffect(() => {
    for (const stream of streams.values()) {
      for (const track of stream.getAudioTracks()) {
        track.enabled = !deafened;
        const adjustable = track as { _setVolume?: (_value: number) => void };
        try {
          adjustable._setVolume?.(deafened ? 0 : volume);
        } catch {
          // Per-track gain is not exposed on every platform.
        }
      }
    }
  }, [streams, deafened, volume]);
  return null;
}

function confirmSwitchDevice(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(accepted);
    };
    Alert.alert(
      "Join on this device?",
      "You're already in a call on another device. Joining here will disconnect that device.",
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            finish(false);
          },
        },
        {
          text: "Join here",
          onPress: () => {
            finish(true);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          finish(false);
        },
      },
    );
  });
}

/** Reads the voice context; throws outside a {@link VoiceProvider}. */
export function useVoice(): VoiceContextValue {
  const value = useContext(VoiceContext);
  if (value === null) {
    throw new Error("useVoice must be used within a VoiceProvider.");
  }
  return value;
}
