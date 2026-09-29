import {
  type MediaDeviceInfo as AuloraMediaDevice,
  type CallKind,
  type CallView,
  hasPermission,
  mergeVoiceSettings,
  Permission,
  type VoiceDeviceSettings,
} from "@aulora/core";
import { type ConvexReactClient, useQuery } from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  setView(view: CallViewMode): void;
  setPipPinned(pinned: boolean): void;
  startCall(
    channelId: string,
    kind: CallKind,
    ringingUserIds?: readonly string[],
  ): Promise<string | null>;
  joinCall(callId: string): Promise<boolean>;
  acceptCall(call: CallView): Promise<void>;
  declineCall(callId: string): Promise<void>;
  leave(): Promise<void>;
  endCall(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  setDeafened(deafened: boolean): void;
  setCamera(on: boolean): Promise<void>;
  setScreenSharing(on: boolean): Promise<void>;
  updateSettings(partial: Partial<VoiceDeviceSettings>): Promise<void>;
  refreshDevices(): Promise<void>;
  clearError(): void;
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

/**
 * Owns the call engine for one signed-in device: the WebRTC mesh, the media
 * devices and the call UI mode. Mounted inside {@link ChatProvider} so it can
 * read the viewer's resolved permission bitfield without duplicating that
 * resolution; every call surface talks to it through {@link useVoice}.
 */
export function VoiceProvider({ client, userId, children }: VoiceProviderProps) {
  const { viewerPermissions } = useChat();
  const engineRef = useRef<MobileVoiceEngine | null>(null);
  const [snapshot, setSnapshot] = useState<MobileVoiceSnapshot>(EMPTY_SNAPSHOT);
  const [incoming, setIncoming] = useState<readonly CallView[]>([]);
  const [activeCalls, setActiveCalls] = useState<readonly CallView[]>([]);
  const [settings, setSettings] = useState<VoiceDeviceSettings>(DEFAULT_VOICE_SETTINGS);
  const [devices, setDevices] = useState<readonly AuloraMediaDevice[]>([]);
  const [view, setView] = useState<CallViewMode>("hidden");
  const [pipPinned, setPipPinned] = useState(false);
  const settingsRef = useRef<VoiceDeviceSettings>(settings);
  settingsRef.current = settings;

  const config = useQuery(api.server.publicConfig, {});
  const policy = useMemo<VoicePolicy>(() => {
    const voice = config?.voice;
    return {
      enabled: voice?.enabled ?? true,
      videoEnabled: voice?.videoEnabled ?? true,
      screenShareEnabled: voice?.screenShareEnabled ?? true,
      maxParticipants: voice?.maxParticipants ?? 10,
      iceServers: normalizeIceServers(voice?.iceServers),
    };
  }, [config]);

  // Engine lifetime is tied to the signed-in client + identity.
  useEffect(() => {
    const engine = new MobileVoiceEngine({
      port: convexVoicePort(client),
      subscriptions: convexVoiceSubscriptions(client),
      userId,
      getSettings: () => settingsRef.current,
      iceServers: policy.iceServers,
    });
    engineRef.current = engine;
    setSnapshot(engine.getSnapshot());
    const unsubscribe = engine.subscribe(() => setSnapshot(engine.getSnapshot()));
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
  }, [client, userId, policy.iceServers]);

  // Load local device settings, enumerate devices and follow device changes.
  useEffect(() => {
    void loadVoiceSettingsAsync().then((initial) => {
      setSettings(initial);
      settingsRef.current = initial;
    });
    void listMediaDevices().then(setDevices);
    return onDeviceChange(() => {
      void listMediaDevices().then(setDevices);
    });
  }, []);

  // Reveal the call stage when a call starts; hide it when the call ends.
  const callActive = snapshot.callId !== null;
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
  }, [callActive]);

  const refreshDevices = useCallback(async () => {
    setDevices(await listMediaDevices());
  }, []);

  const updateSettings = useCallback(async (partial: Partial<VoiceDeviceSettings>) => {
    const next = mergeVoiceSettings({ ...settingsRef.current, ...partial });
    setSettings(next);
    settingsRef.current = next;
    await saveVoiceSettingsAsync(next);
    await engineRef.current?.applySettings(next);
  }, []);

  const startCall = useCallback(
    async (channelId: string, kind: CallKind, ringingUserIds?: readonly string[]) => {
      const engine = engineRef.current;
      if (engine === null) {
        return null;
      }
      const callId = await engine.startCall({
        channelId,
        kind,
        ...(ringingUserIds !== undefined ? { ringingUserIds } : {}),
      });
      if (callId !== null) {
        setView("stage");
      }
      return callId;
    },
    [],
  );

  const joinCall = useCallback(async (callId: string) => {
    const ok = (await engineRef.current?.joinCall(callId)) ?? false;
    if (ok) {
      setView("stage");
    }
    return ok;
  }, []);

  const acceptCall = useCallback(
    async (call: CallView) => {
      await joinCall(call.id);
    },
    [joinCall],
  );

  const declineCall = useCallback(async (callId: string) => {
    await engineRef.current?.declineCall(callId);
  }, []);

  const leave = useCallback(async () => {
    await engineRef.current?.leave();
    setView("hidden");
  }, []);

  const endCall = useCallback(async () => {
    await engineRef.current?.endCall();
    setView("hidden");
  }, []);

  const setMuted = useCallback(async (muted: boolean) => {
    await engineRef.current?.setMuted(muted);
  }, []);

  const setDeafened = useCallback((deafened: boolean) => {
    engineRef.current?.setDeafened(deafened);
  }, []);

  const setCamera = useCallback(async (on: boolean) => {
    await engineRef.current?.setCamera(on);
  }, []);

  const setScreenSharing = useCallback(async (on: boolean) => {
    await engineRef.current?.setScreenSharing(on);
  }, []);

  const clearError = useCallback(() => {
    engineRef.current?.clearError();
  }, []);

  const canConnect = policy.enabled && hasPermission(viewerPermissions, Permission.Connect);
  const canSpeak = hasPermission(viewerPermissions, Permission.Speak);
  const canStream =
    policy.screenShareEnabled && hasPermission(viewerPermissions, Permission.Stream);
  const canVideo = policy.videoEnabled && hasPermission(viewerPermissions, Permission.UseVideo);

  const value = useMemo<VoiceContextValue>(
    () => ({
      ...snapshot,
      selfUserId: userId,
      policy,
      incoming,
      activeCalls,
      settings,
      devices,
      canConnect,
      canSpeak,
      canStream,
      canVideo,
      view,
      pipPinned,
      setView,
      setPipPinned,
      startCall,
      joinCall,
      acceptCall,
      declineCall,
      leave,
      endCall,
      setMuted,
      setDeafened,
      setCamera,
      setScreenSharing,
      updateSettings,
      refreshDevices,
      clearError,
    }),
    [
      snapshot,
      userId,
      policy,
      incoming,
      activeCalls,
      settings,
      devices,
      canConnect,
      canSpeak,
      canStream,
      canVideo,
      view,
      pipPinned,
      startCall,
      joinCall,
      acceptCall,
      declineCall,
      leave,
      endCall,
      setMuted,
      setDeafened,
      setCamera,
      setScreenSharing,
      updateSettings,
      refreshDevices,
      clearError,
    ],
  );

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
        const adjustable = track as { _setVolume?: (value: number) => void };
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

/** Reads the voice context; throws outside a {@link VoiceProvider}. */
export function useVoice(): VoiceContextValue {
  const value = useContext(VoiceContext);
  if (value === null) {
    throw new Error("useVoice must be used within a VoiceProvider.");
  }
  return value;
}
