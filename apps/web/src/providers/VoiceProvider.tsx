import {
  type AddonFlags,
  type MediaDeviceInfo as AuloraMediaDevice,
  type CallKind,
  type CallView,
  callElsewhereFromUnknown,
  claimCallSeat,
  DEFAULT_FEATURE_FLAGS,
  type FeatureFlags,
  hasPermission,
  mergeVoiceSettings,
  NO_ADDONS,
  notOpenMessage,
  Permission,
  parseScheduledCallNotOpen,
  type ScheduledCallNotOpenInfo,
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
import { api } from "../../../../packages/convex/convex/_generated/api";
import { CallEndedNotice } from "../components/voice/CallEndedNotice";
import { SwitchDeviceCallModal } from "../components/voice/SwitchDeviceCallModal";
import { TranscriptionRuntime } from "../components/voice/TranscriptionRuntime";
import { publicOrigin } from "../lib/public-origin";
import { VoiceEngine, type VoiceSnapshot } from "../lib/voice/call-engine";
import { convexVoicePort, convexVoiceSubscriptions } from "../lib/voice/convex-voice";
import {
  DEFAULT_VOICE_SETTINGS,
  readVoiceSettings,
  writeVoiceSettings,
} from "../lib/voice/device-settings";
import { sendLeaveBeacon } from "../lib/voice/leave-beacon";
import { VoiceLevelsStore } from "../lib/voice/levels";
import { listMediaDevices, onDeviceChange, resumeLevelMeterContext } from "../lib/voice/media";
import { type PipControl, type PipSurface, useCallPip } from "./use-call-pip";
import { VoiceLevelsProvider } from "./voice-levels";
import { loadBrowserVoiceClientId, withScreenAudio } from "./voice-provider-utils";
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

/** The outcome of joining a scheduled call, with a message the UI can show as is. */
export type ScheduledJoinResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly message: string;
      /** Set when the server refused because the call is not open yet. */
      readonly notOpen?: ScheduledCallNotOpenInfo;
    };

export interface VoiceContextValue extends VoiceSnapshot {
  readonly selfUserId: string;
  /** The viewer's workspace permissions, for call-addon controls. */
  readonly permissions: bigint;
  /** Which call addons the workspace has switched on. */
  readonly addons: AddonFlags;
  /** The title of the scheduled call this device joined, for a room with no channel. */
  readonly scheduledTitle: { readonly scheduledCallId: string; readonly title: string } | null;
  /** Whether the invite-a-guest dialog is open. */
  readonly inviteGuestOpen: boolean;
  setInviteGuestOpen(_open: boolean): void;
  /** Shows a message in the call error toast. */
  reportError(_message: string): void;
  /** Joins a scheduled call: the server seats this device, then the engine starts. */
  joinScheduledCall(_scheduledCallId: string, _title: string): Promise<ScheduledJoinResult>;
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
  /** Picture-in-picture for the active call, in whatever form this platform offers. */
  readonly pip: PipControl;
  /** The floating surface the page draws the call into, if one is open. */
  readonly pipSurface: PipSurface;
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
  /** Hides an automatic quality-reduction notice, keeping the reduction. */
  dismissQualityNotice(): void;
  /** Restores the camera and stops automatic degradation for this call. */
  undoQualityChange(): void;
  /** Restarts the solo-call countdown after the person chooses to stay. */
  stayInCall(): Promise<void>;
  /** Hides the notice shown after the server's solo-call disconnect. */
  dismissEndedNotice(): void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

const EMPTY_SNAPSHOT: VoiceSnapshot = {
  callId: null,
  call: null,
  local: { muted: false, deafened: false, video: false, sharingScreen: false },
  micStream: null,
  transmitting: false,
  localVideoTrack: null,
  remoteStreams: new Map(),
  remoteScreens: new Map(),
  remoteSpeaking: new Set(),
  attachRemoteVideo: () => false,
  localSpeaking: false,
  pending: false,
  error: null,
  mediaError: null,
  qualityNotice: null,
  endedNotice: null,
};

export interface VoiceProviderProps {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly permissions: bigint;
  readonly policy: VoicePolicy;
  /** The operator's kill switches; absent means every feature is on. */
  readonly featureFlags?: FeatureFlags;
  /** Which call addons are on; absent means all off (an older backend). */
  readonly addons?: AddonFlags;
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
  featureFlags = DEFAULT_FEATURE_FLAGS,
  addons = NO_ADDONS,
  children,
}: VoiceProviderProps) {
  const [clientId] = useState(loadBrowserVoiceClientId);
  const engineRef = useRef<VoiceEngine | null>(null);
  const [levels] = useState(() => new VoiceLevelsStore());
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>(EMPTY_SNAPSHOT);
  const [incoming, setIncoming] = useState<readonly CallView[]>([]);
  const [activeCalls, setActiveCalls] = useState<readonly CallView[]>([]);
  const [settings, setSettings] = useState<VoiceDeviceSettings>(DEFAULT_VOICE_SETTINGS);
  const [devices, setDevices] = useState<readonly AuloraMediaDevice[]>([]);
  const [view, setView] = useState<CallViewMode>("hidden");
  const [pipPinned, setPipPinned] = useState(false);
  const [inviteGuestOpen, setInviteGuestOpen] = useState(false);
  const [scheduledTitle, setScheduledTitle] = useState<{
    readonly scheduledCallId: string;
    readonly title: string;
  } | null>(null);
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
  // The operator's kill switches. The engine reads them on each decision; the
  // effect below tells it when they change so a call in progress follows.
  const featureFlagsRef = useRef(featureFlags);
  featureFlagsRef.current = featureFlags;

  // Engine lifetime is tied to the signed-in client + identity.
  useEffect(() => {
    const engine = new VoiceEngine({
      port: convexVoicePort(client, clientId),
      subscriptions: convexVoiceSubscriptions(client),
      userId,
      clientId,
      getSettings: () => settingsRef.current,
      getIceServers: () => iceServersRef.current,
      getFeatureFlags: () => featureFlagsRef.current,
      levels,
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
  }, [client, clientId, levels, userId]);

  const transportOff = featureFlags.disableNewCallTransport;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the flag is only a trigger; the engine reads the current value itself
  useEffect(() => {
    engineRef.current?.refreshFeatureFlags();
  }, [transportOff]);

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

  // Browsers keep an AudioContext suspended until a gesture. The level meters
  // share one context, so a pointer or key press anywhere resumes all of them.
  useEffect(() => {
    const resume = () => {
      resumeLevelMeterContext();
    };
    window.addEventListener("pointerdown", resume, { passive: true });
    window.addEventListener("keydown", resume);
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
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
  // awaiting anything once the page is going away. A seat only exists during a
  // call, so fetch lazily when the call starts and refresh while it lasts
  // instead of polling the auth endpoint once a minute for every signed-in tab.
  useEffect(() => {
    if (!callActive) {
      return;
    }
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
  }, [callActive]);

  // Only a completed navigation leaves the call. beforeunload may be cancelled
  // by a dirty-form prompt; bfcache entries keep their seat.
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
    window.addEventListener("pagehide", onPageHide);
    return () => {
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

  const joinScheduledCall = useCallback(
    async (scheduledCallId: string, title: string): Promise<ScheduledJoinResult> => {
      const engine = engineRef.current;
      if (engine === null) {
        return { ok: false, message: "Calls are not ready yet. Try again in a moment." };
      }
      try {
        const joined = await client.mutation(api.scheduledCalls.join, {
          scheduledCallId: scheduledCallId as never,
          clientId,
        });
        setScheduledTitle({ scheduledCallId, title });
        const attached = await engine.attachToCall(joined.callId);
        if (!attached) {
          return { ok: false, message: "Could not start the call. Try again." };
        }
        setView("dock");
        return { ok: true };
      } catch (error) {
        // The server's refusal is the truth; the countdown on screen is cosmetic.
        const notOpen = parseScheduledCallNotOpen(error);
        if (notOpen !== null) {
          return { ok: false, message: notOpenMessage(notOpen), notOpen };
        }
        if (callElsewhereFromUnknown(error) !== null) {
          return {
            ok: false,
            message: "You are already in this call on another device. Leave it there first.",
          };
        }
        return {
          ok: false,
          message:
            error instanceof Error && error.message.length > 0
              ? error.message
              : "Could not join the call. Try again.",
        };
      }
    },
    [client, clientId],
  );

  const reportError = useCallback((message: string) => {
    engineRef.current?.setError(message);
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

  const dismissQualityNotice = useCallback(() => {
    engineRef.current?.dismissQualityNotice();
  }, []);

  const undoQualityChange = useCallback(() => {
    engineRef.current?.undoQualityChange();
  }, []);

  const stayInCall = useCallback(async () => {
    await engineRef.current?.stayInCall();
  }, []);

  const dismissEndedNotice = useCallback(() => {
    engineRef.current?.dismissEndedNotice();
  }, []);

  const canConnect = policy.enabled && hasPermission(permissions, Permission.Connect);
  const canSpeak = hasPermission(permissions, Permission.Speak);
  const canStream = policy.screenShareEnabled && hasPermission(permissions, Permission.Stream);
  const canVideo = policy.videoEnabled && hasPermission(permissions, Permission.UseVideo);

  const { pip, surface: pipSurface } = useCallPip({
    callActive,
    snapshot,
    selfUserId: userId,
    canSpeak,
    canVideo,
    canStream,
    videoDisabled: featureFlags.disablePipVideo,
    pinned: pipPinned,
    controls: {
      toggleMicrophone: () => {
        const engine = engineRef.current;
        void engine?.setMuted(!engine.getSnapshot().local.muted);
      },
      toggleDeafen: () => {
        const engine = engineRef.current;
        engine?.setDeafened(!engine.getSnapshot().local.deafened);
      },
      toggleCamera: () => {
        const engine = engineRef.current;
        void engine?.setCamera(!engine.getSnapshot().local.video);
      },
      toggleScreen: () => {
        const engine = engineRef.current;
        void engine?.setScreenSharing(!engine.getSnapshot().local.sharingScreen);
      },
      stay: () => {
        void stayInCall();
      },
      hangUp: () => {
        void leave();
      },
    },
  });

  const value = useMemo<VoiceContextValue>(
    () => ({
      ...snapshot,
      selfUserId: userId,
      permissions,
      addons,
      scheduledTitle,
      inviteGuestOpen,
      setInviteGuestOpen,
      reportError,
      joinScheduledCall,
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
      pip,
      pipSurface,
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
      dismissQualityNotice,
      undoQualityChange,
      stayInCall,
      dismissEndedNotice,
    }),
    [
      snapshot,
      userId,
      permissions,
      addons,
      scheduledTitle,
      inviteGuestOpen,
      reportError,
      joinScheduledCall,
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
      pip,
      pipSurface,
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
      dismissQualityNotice,
      undoQualityChange,
      stayInCall,
      dismissEndedNotice,
    ],
  );

  // A relayed share's own audio plays beside the call audio, under its own key.
  const audioStreams = withScreenAudio(snapshot.remoteStreams, snapshot.remoteScreens);

  return (
    <VoiceContext.Provider value={value}>
      <VoiceLevelsProvider store={levels}>
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
          streams={audioStreams}
          deafened={snapshot.local.deafened}
          outputDeviceId={settings.outputDeviceId}
          outputVolume={settings.outputVolume}
        />
        <CallEndedNotice />
        {callActive && (
          <TranscriptionRuntime
            sessionId={
              snapshot.call?.transcribing === true
                ? (snapshot.call.transcriptionSessionId ?? null)
                : null
            }
            micStream={snapshot.micStream}
            transmitting={snapshot.transmitting}
            origin={publicOrigin()}
            mint={async (sessionId) => {
              const minted = await client.mutation(api.transcription.mintAudioTokenForCall, {
                sessionId: sessionId as never,
              });
              return { token: minted.token, wsPath: minted.wsPath };
            }}
          />
        )}
      </VoiceLevelsProvider>
    </VoiceContext.Provider>
  );
}

/** Reads the voice context; throws outside a {@link VoiceProvider}. */
export function useVoice(): VoiceContextValue {
  const value = useContext(VoiceContext);
  if (value === null) {
    throw new Error("useVoice must be used within a VoiceProvider.");
  }
  return value;
}
