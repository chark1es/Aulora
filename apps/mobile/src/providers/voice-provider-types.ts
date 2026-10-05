import type {
  MediaDeviceInfo as AuloraMediaDevice,
  CallKind,
  CallView,
  VoiceDeviceSettings,
} from "@aulora/core";
import { createContext } from "react";
import type { MobileVoiceEngine, MobileVoiceSnapshot } from "../lib/voice/call-engine";

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

export const VoiceContext = createContext<VoiceContextValue | null>(null);

export const EMPTY_SNAPSHOT: MobileVoiceSnapshot = {
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

export interface EngineRef {
  current: MobileVoiceEngine | null;
}

export interface SettingsRef {
  current: VoiceDeviceSettings;
}

export interface ActiveCallsRef {
  current: readonly CallView[];
}

export interface VoiceFlags {
  readonly canConnect: boolean;
  readonly canSpeak: boolean;
  readonly canStream: boolean;
  readonly canVideo: boolean;
}

export interface VoiceControls {
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
