import {
  type MediaDeviceInfo as AuloraMediaDevice,
  type CallKind,
  type CallView,
  claimCallSeat,
  createVoiceClientId,
  ensureVoiceClientId,
  hasPermission,
  mergeVoiceSettings,
  Permission,
  type VoiceDeviceSettings,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
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
import { SwitchDeviceCallModal } from "../components/voice/SwitchDeviceCallModal";
import { VoiceEngine, type VoiceSnapshot } from "../lib/voice/call-engine";
import { convexVoicePort, convexVoiceSubscriptions } from "../lib/voice/convex-voice";
import {
  DEFAULT_VOICE_SETTINGS,
  readVoiceSettings,
  writeVoiceSettings,
} from "../lib/voice/device-settings";
import { sendLeaveBeacon } from "../lib/voice/leave-beacon";
import { listMediaDevices, onDeviceChange } from "../lib/voice/media";
import { RemoteAudio } from "./voice-remote-audio";

/** How often the cached unload token is refreshed while a call is active. */
const TOKEN_REFRESH_MS = 60_000;

/** Tags whose text entry should suppress push-to-talk while focused. */
const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA"]);

/** The workspace's voice policy, mirrored from `server.publicConfig`. */
export interface VoicePolicy {
  readonly enabled: boolean;
  readonly videoEnabled: boolean;
  readonly screenShareEnabled: boolean;
  readonly maxParticipants: number;
  readonly iceServers: readonly RTCIceServer[];
}

export type CallViewMode = "hidden" | "dock" | "stage";

export interface VoiceContextValue extends VoiceSnapshot {
  readonly selfUserId: string;
  /** This install's id, used to tell a local seat from one on another device. */
  readonly clientId: string;
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
  setView(_view: CallViewMode): void;
  setPipPinned(_pinned: boolean): void;
  startCall(
    _channelId: string,
    _kind: CallKind,
    _ringingUserIds?: readonly string[],
  ): Promise<string | null>;
  joinCall(_callId: string): Promise<boolean>;
  acceptCall(_call: CallView): Promise<void>;
  declineCall(_callId: string): Promise<void>;
  leave(): Promise<void>;
  endCall(): Promise<void>;
  setMuted(_muted: boolean): Promise<void>;
  setDeafened(_deafened: boolean): void;
  setCamera(_on: boolean): Promise<void>;
  setScreenSharing(_on: boolean): Promise<void>;
  updateSettings(_partial: Partial<VoiceDeviceSettings>): Promise<void>;
  refreshDevices(): Promise<void>;
  clearError(): void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

const EMPTY_SNAPSHOT: VoiceSnapshot = {
  callId: null,
  call: null,
  local: { muted: false, deafened: false, video: false, sharingScreen: false },
  micStream: null,
  localVideoTrack: null,
  remoteStreams: new Map(),
  remoteSpeaking: new Set(),
  micLevel: 0,
  localSpeaking: false,
  pending: false,
  error: null,
  mediaError: null,
};

export interface VoiceProviderProps {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly permissions: bigint;
  readonly policy: VoicePolicy;
  readonly children: ReactNode;
}

/**
 * Owns the call engine for one signed-in device: the WebRTC mesh, the media
 * devices and the call UI mode. Everything else in the app talks to calls
 * through {@link useVoice}.
 */
export function VoiceProvider({
  client,
  userId,
  permissions,
  policy,
  children,
}: VoiceProviderProps) {
  const [clientId] = useState(loadBrowserVoiceClientId);
  const engineRef = useRef<VoiceEngine | null>(null);
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>(EMPTY_SNAPSHOT);
  const [incoming, setIncoming] = useState<readonly CallView[]>([]);
  const [activeCalls, setActiveCalls] = useState<readonly CallView[]>([]);
  const [settings, setSettings] = useState<VoiceDeviceSettings>(DEFAULT_VOICE_SETTINGS);
  const [devices, setDevices] = useState<readonly AuloraMediaDevice[]>([]);
  const [view, setView] = useState<CallViewMode>("hidden");
  const [pipPinned, setPipPinned] = useState(false);
  const [switchPrompt, setSwitchPrompt] = useState<{
    resolve: (_accepted: boolean) => void;
  } | null>(null);
  const settingsRef = useRef<VoiceDeviceSettings>(settings);
  settingsRef.current = settings;
  const iceServersRef = useRef(policy.iceServers);
  iceServersRef.current = policy.iceServers;
  // A fresh Convex JWT, cached so the unload beacon can authenticate without
  // awaiting anything once the page is going away.
  const authTokenRef = useRef<string | null>(null);
  const activeCallsRef = useRef(activeCalls);
  activeCallsRef.current = activeCalls;

  // Engine lifetime is tied to the signed-in client + identity.
  useEffect(() => {
    const engine = new VoiceEngine({
      port: convexVoicePort(client, clientId),
      subscriptions: convexVoiceSubscriptions(client),
      userId,
      clientId,
      getSettings: () => settingsRef.current,
      getIceServers: () => iceServersRef.current,
    });
    engineRef.current = engine;
    setSnapshot(engine.getSnapshot());
    const unsubscribe = engine.subscribe(() => {
      setSnapshot(engine.getSnapshot());
    });
    const offIncoming = convexVoiceSubscriptions(client).watchIncoming((calls) => {
      setIncoming(calls);
    });
    const offActive = convexVoiceSubscriptions(client).watchActiveCalls((calls) => {
      setActiveCalls(calls);
    });
    return () => {
      unsubscribe();
      offIncoming();
      offActive();
      // Signing out (or switching profile) unmounts the engine mid-call: leave
      // immediately instead of waiting for the heartbeat sweep to reclaim us.
      const callId = engine.getSnapshot().callId;
      if (callId !== null) {
        sendLeaveBeacon({
          convexUrl: client.url,
          token: authTokenRef.current,
          callId,
          clientId,
        });
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, [client, clientId, userId]);

  // Load local device settings, enumerate devices and follow device changes.
  useEffect(() => {
    const initial = readVoiceSettings();
    setSettings(initial);
    settingsRef.current = initial;
    void listMediaDevices().then(setDevices);
    return onDeviceChange(() => {
      void listMediaDevices().then(setDevices);
    });
  }, []);

  // Push-to-talk: hold Space to transmit. Ignored while typing in a field.
  useEffect(() => {
    if (!settings.pushToTalk) {
      return;
    }
    const isTyping = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) {
        return false;
      }
      const editable = target as { readonly isContentEditable?: boolean };
      return TEXT_ENTRY_TAGS.has(target.tagName) || editable.isContentEditable === true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !event.repeat && !isTyping(event.target)) {
        event.preventDefault();
        engineRef.current?.setTalking(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isTyping(event.target)) {
        engineRef.current?.setTalking(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      engineRef.current?.setTalking(false);
    };
  }, [settings.pushToTalk]);

  // Reveal the dock when a call starts; hide it when the call ends.
  const callActive = snapshot.callId !== null;
  useEffect(() => {
    setView((current) => {
      if (callActive) {
        return current === "hidden" ? "dock" : current;
      }
      return "hidden";
    });
    if (!callActive) {
      setPipPinned(false);
    }
  }, [callActive]);

  // Keep a Convex token cached so the unload beacon can authenticate without
  // awaiting anything once the page is going away. Fetched on mount so it is
  // warm before the first call, then refreshed well inside the token lifetime.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/auth/convex/token", { credentials: "include" });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { token?: string };
        if (!cancelled) {
          authTokenRef.current = data.token ?? null;
        }
      } catch {
        // Best-effort; without a token the heartbeat sweep is the backstop.
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), TOKEN_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Closing the tab, navigating away or quitting the desktop app drops the
  // caller out of the call right away. `beforeunload` covers the exits browsers
  // report there; `pagehide` is the backstop for the ones they don't. A bfcache
  // entry (`persisted`) keeps the seat. The mobile app backgrounds without ever
  // reaching either event, so a sleeping phone stays in the call. Neither
  // listener prompts on unload.
  useEffect(() => {
    let departed = false;
    const leaveNow = () => {
      if (departed) {
        return;
      }
      const callId = engineRef.current?.getSnapshot().callId;
      if (callId === null || callId === undefined) {
        return;
      }
      departed = true;
      sendLeaveBeacon({
        convexUrl: client.url,
        token: authTokenRef.current,
        callId,
        clientId,
      });
      engineRef.current?.abandon();
    };
    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        leaveNow();
      }
    };
    window.addEventListener("beforeunload", leaveNow);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", leaveNow);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [client, clientId]);

  const refreshDevices = useCallback(async () => {
    setDevices(await listMediaDevices());
  }, []);

  const updateSettings = useCallback(async (partial: Partial<VoiceDeviceSettings>) => {
    const next = mergeVoiceSettings({ ...settingsRef.current, ...partial });
    setSettings(next);
    settingsRef.current = next;
    writeVoiceSettings(next);
    await engineRef.current?.applySettings(next);
  }, []);

  const confirmSwitch = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      setSwitchPrompt((current) => {
        current?.resolve(false);
        return { resolve };
      });
    });
  }, []);

  const settleSwitch = useCallback((accepted: boolean) => {
    setSwitchPrompt((current) => {
      current?.resolve(accepted);
      return null;
    });
  }, []);

  const startCall = useCallback(
    async (channelId: string, kind: CallKind, ringingUserIds?: readonly string[]) => {
      const engine = engineRef.current;
      if (engine === null) {
        return null;
      }
      const result = await claimCallSeat({
        calls: activeCallsRef.current,
        userId,
        clientId,
        confirm: confirmSwitch,
        run: (takeover) =>
          engine.startCall({
            channelId,
            kind,
            ...(ringingUserIds !== undefined ? { ringingUserIds } : {}),
            ...(takeover ? { takeover: true } : {}),
          }),
      });
      if (result.status === "joined") {
        setView("dock");
        return result.callId;
      }
      return null;
    },
    [clientId, confirmSwitch, userId],
  );

  const joinCall = useCallback(
    async (callId: string) => {
      const engine = engineRef.current;
      if (engine === null) {
        return false;
      }
      const result = await claimCallSeat({
        calls: activeCallsRef.current,
        userId,
        clientId,
        confirm: confirmSwitch,
        run: (takeover) => engine.joinCall(callId, takeover ? { takeover: true } : {}),
      });
      if (result.status === "joined") {
        setView("dock");
        return true;
      }
      return false;
    },
    [clientId, confirmSwitch, userId],
  );

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

  const canConnect = policy.enabled && hasPermission(permissions, Permission.Connect);
  const canSpeak = hasPermission(permissions, Permission.Speak);
  const canStream = policy.screenShareEnabled && hasPermission(permissions, Permission.Stream);
  const canVideo = policy.videoEnabled && hasPermission(permissions, Permission.UseVideo);

  const value = useMemo<VoiceContextValue>(
    () => ({
      ...snapshot,
      selfUserId: userId,
      clientId,
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
      clientId,
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
      <SwitchDeviceCallModal
        open={switchPrompt !== null}
        onCancel={() => {
          settleSwitch(false);
        }}
        onConfirm={() => {
          settleSwitch(true);
        }}
      />
      <RemoteAudio
        streams={snapshot.remoteStreams}
        deafened={snapshot.local.deafened}
        outputDeviceId={settings.outputDeviceId}
        outputVolume={settings.outputVolume}
      />
    </VoiceContext.Provider>
  );
}

function loadBrowserVoiceClientId(): string {
  try {
    if (typeof localStorage !== "undefined") {
      return ensureVoiceClientId(localStorage);
    }
  } catch {
    // Private mode can throw on access. A session-only id still separates tabs
    // that do not share storage, which is enough to keep seats apart.
  }
  return createVoiceClientId();
}

/** Reads the voice context; throws outside a {@link VoiceProvider}. */
export function useVoice(): VoiceContextValue {
  const value = useContext(VoiceContext);
  if (value === null) {
    throw new Error("useVoice must be used within a VoiceProvider.");
  }
  return value;
}
