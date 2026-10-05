import {
  type MediaDeviceInfo as AuloraMediaDevice,
  type CallView,
  ensureVoiceClientIdAsync,
  mergeVoiceSettings,
  type VoiceDeviceSettings,
} from "@aulora/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type ConvexReactClient, useQuery } from "convex/react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
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
import {
  type CallViewMode,
  EMPTY_SNAPSHOT,
  type EngineRef,
  type SettingsRef,
  type VoicePolicy,
} from "./voice-provider-types";

export function useVoiceClientId(): string | null {
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

export function useVoicePolicy(): VoicePolicy {
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

export function useVoiceSettings(engineRef: EngineRef) {
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

export function useVoiceDevices() {
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

export function useVoiceEngine(
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

export function useVoiceUi(callActive: boolean) {
  const [view, setView] = useState<CallViewMode>("hidden");
  const [pipPinned, setPipPinned] = useState(false);
  useAutoRevealStage(callActive, setView, setPipPinned);
  return { view, pipPinned, setView, setPipPinned };
}

/** Maps configured ICE servers onto the engine's structural shape. */
export function normalizeIceServers(
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
