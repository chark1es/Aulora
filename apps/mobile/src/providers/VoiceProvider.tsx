import {
  type MediaDeviceInfo as AuloraMediaDevice,
  type CallKind,
  type CallView,
  claimCallSeat,
  ensureVoiceClientIdAsync,
  hasPermission,
  mergeVoiceSettings,
  Permission,
  type VoiceDeviceSettings,
} from "@aulora/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type ConvexReactClient, useQuery } from "convex/react";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert } from "react-native";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { MobileVoiceEngine, type MobileVoiceSnapshot } from "../lib/voice/call-engine";
import { convexVoicePort, convexVoiceSubscriptions } from "../lib/voice/convex-voice";
import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettingsAsync,
  saveVoiceSettingsAsync,
} from "../lib/voice/device-settings";
import { listMediaDevices, onDeviceChange } from "../lib/voice/webrtc";
import { useChat } from "./ChatProvider";

/** The workspace's voice policy, mirrored from `server.publicConfig`. */
export interface VoicePolicy {
  readonly enabled: boolean;
  readonly videoEnabled: boolean;
  readonly screenShareEnabled: boolean;
  readonly maxParticipants: number;
  readonly iceServers: readonly { urls: string | readonly string[] }[];
}

export type CallViewMode = "hidden" | "stage";

export interface VoiceContextValue extends MobileVoiceSnapshot {
  readonly selfUserId: string;
  /** This install's id, or null until it has been read from storage. */
  readonly clientId: string | null;
  readonly policy: VoicePolicy;
  readonly incoming: readonly CallView[];
  readonly activeCalls: readonly CallView[];
  readonly settings: VoiceDeviceSettings;
  readonly devices: readonly AuloraMediaDevice[];
  readonly canConnect: boolean;
  readonly canSpeak: boolean;
  readonly canStream: boolean;
  readonly canVideo: boolean;
  readonly view: CallViewMode;
  readonly pipPinned: boolean;
  readonly setView: (_view: CallViewMode) => void;
  readonly setPipPinned: (_pinned: boolean) => void;
  readonly startCall: (
    _channelId: string,
    _kind: CallKind,
    _ringingUserIds?: readonly string[],
  ) => Promise<string | null>;
  readonly joinCall: (_callId: string) => Promise<boolean>;
  readonly acceptCall: (_call: CallView) => Promise<void>;
  readonly declineCall: (_callId: string) => Promise<void>;
  readonly leave: () => Promise<void>;
  readonly endCall: () => Promise<void>;
  readonly setMuted: (_muted: boolean) => Promise<void>;
  readonly setDeafened: (_deafened: boolean) => void;
  readonly setCamera: (_on: boolean) => Promise<void>;
  readonly setScreenSharing: (_on: boolean) => Promise<void>;
  readonly updateSettings: (_partial: Partial<VoiceDeviceSettings>) => Promise<void>;
  readonly refreshDevices: () => Promise<void>;
  readonly clearError: () => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

const EMPTY_SNAPSHOT: MobileVoiceSnapshot = {
  callId: null,
  call: null,
  local: { muted: false, deafened: false, video: false, sharingScreen: false },
  micStream: null,
  localVideoTrack: null,
  remoteStreams: new Map(),
  remoteLevels: new Map(),
  micLevel: 0,
  micLevelAvailable: false,
  pending: false,
  error: null,
};

export interface VoiceProviderProps {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly children: ReactNode;
}

interface EngineRef {
  current: MobileVoiceEngine | null;
}

interface SettingsRef {
  current: VoiceDeviceSettings;
}

interface ActiveCallsRef {
  current: readonly CallView[];
}

interface VoiceFlags {
  readonly canConnect: boolean;
  readonly canSpeak: boolean;
  readonly canStream: boolean;
  readonly canVideo: boolean;
}

interface VoiceControls {
  readonly startCall: VoiceContextValue["startCall"];
  readonly joinCall: VoiceContextValue["joinCall"];
  readonly acceptCall: VoiceContextValue["acceptCall"];
  readonly declineCall: VoiceContextValue["declineCall"];
  readonly leave: VoiceContextValue["leave"];
  readonly endCall: VoiceContextValue["endCall"];
  readonly setMuted: VoiceContextValue["setMuted"];
  readonly setDeafened: VoiceContextValue["setDeafened"];
  readonly setCamera: VoiceContextValue["setCamera"];
  readonly setScreenSharing: VoiceContextValue["setScreenSharing"];
  readonly clearError: VoiceContextValue["clearError"];
}

function useVoiceClientId(): string | null {
  const [clientId, setClientId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ensureVoiceClientIdAsync(AsyncStorage).then((id) => {
      if (!cancelled) {
        setClientId(id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return clientId;
}

function useVoicePolicy(): VoicePolicy {
  const config = useQuery(api.server.publicConfig, {});
  return useMemo<VoicePolicy>(() => {
    const voice = config?.voice;
    return {
      enabled: voice?.enabled ?? true,
      videoEnabled: voice?.videoEnabled ?? true,
      screenShareEnabled: voice?.screenShareEnabled ?? true,
      maxParticipants: voice?.maxParticipants ?? 10,
      iceServers: normalizeIceServers(voice?.iceServers),
    };
  }, [config]);
}

function useVoiceSettings(engineRef: EngineRef) {
  const [settings, setSettings] = useState<VoiceDeviceSettings>(DEFAULT_VOICE_SETTINGS);
  const settingsRef = useRef<VoiceDeviceSettings>(settings);
  settingsRef.current = settings;

  useEffect(() => {
    void loadVoiceSettingsAsync().then((initial) => {
      setSettings(initial);
      settingsRef.current = initial;
    });
  }, []);

  const updateSettings = useCallback(
    async (partial: Partial<VoiceDeviceSettings>) => {
      const next = mergeVoiceSettings({ ...settingsRef.current, ...partial });
      setSettings(next);
      settingsRef.current = next;
      await saveVoiceSettingsAsync(next);
      await engineRef.current?.applySettings(next);
    },
    [engineRef],
  );

  return { settings, settingsRef, updateSettings };
}

function useVoiceDevices() {
  const [devices, setDevices] = useState<readonly AuloraMediaDevice[]>([]);
  useEffect(() => {
    void listMediaDevices().then(setDevices);
    return onDeviceChange(() => {
      void listMediaDevices().then(setDevices);
    });
  }, []);
  const refreshDevices = useCallback(async () => {
    setDevices(await listMediaDevices());
  }, []);
  return { devices, refreshDevices };
}

function useVoiceEngine(
  client: ConvexReactClient,
  clientId: string | null,
  userId: string,
  policy: VoicePolicy,
  settingsRef: SettingsRef,
  engineRef: EngineRef,
) {
  const [snapshot, setSnapshot] = useState<MobileVoiceSnapshot>(EMPTY_SNAPSHOT);
  const [incoming, setIncoming] = useState<readonly CallView[]>([]);
  const [activeCalls, setActiveCalls] = useState<readonly CallView[]>([]);

  // Engine lifetime is tied to the signed-in client + identity.
  useEffect(() => {
    if (clientId === null) {
      return;
    }
    const engine = new MobileVoiceEngine({
      port: convexVoicePort(client, clientId),
      subscriptions: convexVoiceSubscriptions(client),
      userId,
      clientId,
      getSettings: () => settingsRef.current,
      iceServers: policy.iceServers,
    });
    engineRef.current = engine;
    setSnapshot(engine.getSnapshot());
    const unsubscribe = engine.subscribe(() => {
      setSnapshot(engine.getSnapshot());
    });
    const subscriptions = convexVoiceSubscriptions(client);
    const offIncoming = subscriptions.watchIncoming(setIncoming);
    const offActive = subscriptions.watchActiveCalls(setActiveCalls);
    return () => {
      unsubscribe();
      offIncoming();
      offActive();
      engine.dispose();
      engineRef.current = null;
    };
  }, [client, clientId, userId, policy.iceServers, settingsRef, engineRef]);

  return { snapshot, incoming, activeCalls };
}

function useAutoRevealStage(
  callActive: boolean,
  setView: Dispatch<SetStateAction<CallViewMode>>,
  setPipPinned: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    setView((current) => {
      if (callActive) {
        return current === "hidden" ? "stage" : current;
      }
      return "hidden";
    });
    if (!callActive) {
      setPipPinned(false);
    }
  }, [callActive, setView, setPipPinned]);
}

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

function useVoiceUi(callActive: boolean) {
  const [view, setView] = useState<CallViewMode>("hidden");
  const [pipPinned, setPipPinned] = useState(false);
  useAutoRevealStage(callActive, setView, setPipPinned);
  return { view, pipPinned, setView, setPipPinned };
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
 * devices and the call UI mode. Mounted inside {@link ChatProvider} so it can
 * read the viewer's resolved permission bitfield without duplicating that
 * resolution; every call surface talks to it through {@link useVoice}.
 */
export function VoiceProvider({ client, userId, children }: VoiceProviderProps) {
  const { viewerPermissions } = useChat();
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

  return (
    <VoiceContext.Provider value={value}>
      {children}
      <RemoteAudio
        streams={snapshot.remoteStreams}
        deafened={snapshot.local.deafened}
        volume={settings.outputVolume}
      />
    </VoiceContext.Provider>
  );
}

/** Maps configured ICE servers onto the engine's structural shape. */
function normalizeIceServers(
  servers:
    | readonly { urls: readonly string[]; username?: string; credential?: string }[]
    | undefined,
): readonly { urls: string | readonly string[] }[] {
  if (servers === undefined) {
    return [];
  }
  return servers.map((server) => ({
    urls: server.urls,
    ...(server.username !== undefined ? { username: server.username } : {}),
    ...(server.credential !== undefined ? { credential: server.credential } : {}),
  }));
}

/**
 * Remote audio routing. Native WebRTC plays remote audio through the platform
 * session; this component only applies the local deafen flag to the remote
 * tracks, which is the one routing control available without a native audio
 * session module.
 */
function RemoteAudio({
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
