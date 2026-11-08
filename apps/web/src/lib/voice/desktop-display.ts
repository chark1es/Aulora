import type { StreamProfile } from "@aulora/core";
import { createDesktopChannel, invokeDesktopCommand } from "../desktop";

/**
 * Native screen and window capture for the desktop shell.
 *
 * The webview draws its own `getDisplayMedia` picker, which cannot be styled or
 * replaced, so the shell enumerates the capture sources itself and hands over
 * one JPEG frame per request. This module draws those frames into a canvas and
 * captures the canvas, which keeps encoding and pacing in the webview's own
 * video pipeline instead of adding a native streaming path.
 *
 * Frames arrive as a raw Tauri IPC body: a small header followed by JPEG bytes.
 * Nothing is base64-encoded, copied byte-by-byte or parsed as JSON, so a share
 * costs one `Blob` and one `createImageBitmap` per frame.
 */

export type DisplaySourceKind = "screen" | "window";

/** One screen or window the shell can share. */
export interface DisplaySource {
  /** Opaque id the shell understands: `screen:<id>` or `window:<id>`. */
  readonly id: string;
  readonly name: string;
  readonly kind: DisplaySourceKind;
  /** `data:image/jpeg;base64,…` picker tile; `null` when the shell could not draw one. */
  readonly thumbnail: string | null;
}

/**
 * One captured frame: the shell scaled it down and JPEG-encoded it, and the
 * header says how big the picture is. `bytes` is a view into the IPC buffer.
 */
export interface CaptureFrame {
  readonly mime: string;
  /** Encoded JPEG bytes, without a data-URL prefix. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

/** Magic, version, format, reserved and two sizes: see the shell's `capture.rs`. */
export const FRAME_HEADER_BYTES = 16;
const FRAME_MAGIC = [0x41, 0x55, 0x4c, 0x46]; // "AULF"
const FRAME_VERSION = 1;
const FRAME_FORMAT_JPEG = 1;

function parseSource(value: unknown): DisplaySource | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) {
    return null;
  }
  if (typeof record.name !== "string" || record.name.length === 0) {
    return null;
  }
  if (record.kind !== "screen" && record.kind !== "window") {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    thumbnail: typeof record.thumbnail === "string" ? record.thumbnail : null,
  };
}

function parseSources(value: unknown): DisplaySource[] {
  return Array.isArray(value)
    ? value.map(parseSource).filter((source): source is DisplaySource => source !== null)
    : [];
}

/** Reads the IPC body as bytes: Tauri sends an ArrayBuffer, tests may pass a view. */
function frameView(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    // IPC bodies are never shared memory, and `Blob` requires a plain buffer.
    const buffer = value.buffer as ArrayBuffer;
    return new Uint8Array(buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    // macOS/iOS webviews cannot take the raw channel path, so Tauri serializes
    // the body as a JSON byte array there. Copy once into a plain buffer.
    const bytes = value as number[];
    if (!bytes.every((entry) => typeof entry === "number")) {
      return null;
    }
    return Uint8Array.from(bytes);
  }
  return null;
}

/**
 * Validates the shell's frame header and returns the JPEG as a view. A frame
 * that is short, not ours, or from another version is rejected instead of
 * drawn as garbage.
 */
export function parseCaptureFrame(value: unknown): CaptureFrame {
  const view = frameView(value);
  if (view === null || view.byteLength <= FRAME_HEADER_BYTES) {
    throw new Error("The desktop app returned an unreadable screen frame.");
  }
  for (let index = 0; index < FRAME_MAGIC.length; index += 1) {
    if (view[index] !== FRAME_MAGIC[index]) {
      throw new Error("The desktop app returned an unreadable screen frame.");
    }
  }
  if (view[4] !== FRAME_VERSION || view[5] !== FRAME_FORMAT_JPEG) {
    throw new Error("The desktop app returned an unreadable screen frame.");
  }
  const header = new DataView(view.buffer, view.byteOffset, FRAME_HEADER_BYTES);
  const width = header.getUint32(8, true);
  const height = header.getUint32(12, true);
  if (width === 0 || height === 0) {
    throw new Error("The desktop app returned an unreadable screen frame.");
  }
  return {
    mime: "image/jpeg",
    bytes: view.subarray(FRAME_HEADER_BYTES),
    width,
    height,
  };
}

/** Lists the screens and windows the shell can share, with picker tiles. */
export async function listDisplaySources(): Promise<DisplaySource[]> {
  return parseSources(await invokeDesktopCommand("list_capture_sources"));
}

/** Pulls one frame of `sourceId`, which the shell scales down to the box. */
export async function captureDisplayFrame(
  sourceId: string,
  maxWidth: number,
  maxHeight: number,
): Promise<CaptureFrame> {
  return parseCaptureFrame(
    await invokeDesktopCommand("capture_source_frame", {
      sourceId,
      maxWidth,
      maxHeight,
    }),
  );
}

export type CapturePermissionStatus = "granted" | "denied" | "unsupported";

/** Whether the OS lets Aulora read the screen, and where that is granted. */
export interface CapturePermission {
  readonly status: CapturePermissionStatus;
  /** Whether the shell can open the OS pane where the permission is granted. */
  readonly canOpenSettings: boolean;
  /** Why sharing cannot start, in words for the person to read. */
  readonly detail: string | null;
}

function parsePermission(value: unknown): CapturePermission {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const { status } = record;
    if (status === "granted" || status === "denied" || status === "unsupported") {
      return {
        status,
        canOpenSettings: record.canOpenSettings === true,
        detail:
          typeof record.detail === "string" && record.detail.length > 0 ? record.detail : null,
      };
    }
  }
  throw new Error("The desktop app did not report a usable screen sharing permission.");
}

/** Reads the OS screen-capture permission; never prompts. */
export async function screenCapturePermission(): Promise<CapturePermission> {
  return parsePermission(
    await invokeDesktopCommand("screen_capture_permission", { request: false }),
  );
}

/**
 * Asks the OS for the permission (macOS shows its own Screen Recording prompt,
 * which also lists Aulora in that settings pane) and reports the result.
 */
export async function requestScreenCapturePermission(): Promise<CapturePermission> {
  return parsePermission(
    await invokeDesktopCommand("screen_capture_permission", { request: true }),
  );
}

/** Opens the OS pane where screen recording is granted (macOS only). */
export async function openCapturePermissionSettings(): Promise<void> {
  await invokeDesktopCommand("open_capture_permission_settings");
}

/** What the shell reports about system audio before any samples arrive. */
export interface AudioStreamHeader {
  readonly sampleRate: number;
  readonly channels: number;
  /** Always `f32`: interleaved little-endian 32-bit floats. */
  readonly format: string;
  /** Which backend produced the samples. */
  readonly backend: string;
  /** Non-fatal caveats, e.g. that the capture includes Aulora's own audio. */
  readonly warnings: readonly string[];
}

/** Whether this platform can capture system audio, and what to expect. */
export interface SystemAudioSupport {
  readonly supported: boolean;
  readonly backend: string;
  readonly detail: string | null;
}

function parseAudioSupport(value: unknown): SystemAudioSupport {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.supported === "boolean") {
      return {
        supported: record.supported,
        backend: typeof record.backend === "string" ? record.backend : "unknown",
        detail:
          typeof record.detail === "string" && record.detail.length > 0 ? record.detail : null,
      };
    }
  }
  throw new Error("The desktop app did not report a usable system audio capability.");
}

function parseAudioHeader(value: unknown): AudioStreamHeader {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const { sampleRate, channels } = record;
    if (typeof sampleRate === "number" && sampleRate > 0 && typeof channels === "number") {
      return {
        sampleRate,
        channels,
        format: typeof record.format === "string" ? record.format : "f32",
        backend: typeof record.backend === "string" ? record.backend : "unknown",
        warnings: Array.isArray(record.warnings)
          ? record.warnings.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
    }
  }
  throw new Error("The desktop app returned an unreadable audio stream header.");
}

/**
 * Copies a raw channel payload into samples. The wire is little-endian f32, so
 * the endianness is read explicitly rather than assumed.
 */
export function pcmFromPayload(payload: unknown): Float32Array | null {
  let bytes: Uint8Array;
  if (payload instanceof ArrayBuffer) {
    bytes = new Uint8Array(payload);
  } else if (payload instanceof Uint8Array) {
    bytes = payload;
  } else if (Array.isArray(payload)) {
    bytes = Uint8Array.from(payload as number[]);
  } else {
    return null;
  }
  const samples = new Float32Array(bytes.byteLength >> 2);
  if (samples.length === 0) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getFloat32(index * 4, true);
  }
  return samples;
}

/** Reads whether this platform can capture system audio. */
export async function systemAudioSupport(): Promise<SystemAudioSupport> {
  return parseAudioSupport(await invokeDesktopCommand("system_audio_support"));
}

/**
 * Starts the shell's system audio capture and forwards each 20 ms chunk of
 * interleaved f32 to `onPcm`. Resolves with the stream header once the backend
 * runs; rejects when the platform has no usable backend.
 */
export async function startAudioCapture(
  sourceId: string | null,
  onPcm: (pcm: Float32Array) => void,
): Promise<AudioStreamHeader> {
  const channel = createDesktopChannel();
  if (channel === null) {
    throw new Error("The desktop app cannot stream system audio.");
  }
  channel.onmessage = (message) => {
    const pcm = pcmFromPayload(message);
    if (pcm !== null) {
      onPcm(pcm);
    }
  };
  return parseAudioHeader(
    await invokeDesktopCommand("start_audio_capture", {
      channel,
      sourceId: sourceId ?? undefined,
    }),
  );
}

/** Stops the shell's system audio capture; safe when none is running. */
export async function stopAudioCapture(): Promise<void> {
  await invokeDesktopCommand("stop_audio_capture");
}

/** What the poll loop draws into; injectable so tests need no canvas. */
export interface FrameSurface {
  draw(frame: CaptureFrame): Promise<void>;
  /** A live video track of everything drawn from now on. */
  captureStream(frameRate: number): MediaStreamTrack;
}

export interface DisplayStreamDeps {
  readonly captureFrame?: (
    sourceId: string,
    maxWidth: number,
    maxHeight: number,
  ) => Promise<CaptureFrame>;
  readonly createSurface?: (width: number, height: number) => FrameSurface | null;
}

export interface DisplayStream {
  readonly track: MediaStreamTrack;
  /** Ends the poll loop and the track. Safe to call more than once. */
  stop(): void;
}

/**
 * Frames that may fail in a row before the share gives up. A window that was
 * closed keeps failing; anything shorter-lived (a compositor hiccup) recovers.
 */
const MAX_CONSECUTIVE_FAILURES = 15;

/** Draws JPEG frames into a canvas and captures that canvas as a video track. */
function canvasSurface(width: number, height: number): FrameSurface | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }
  return {
    async draw(frame) {
      const bitmap = await createImageBitmap(new Blob([frame.bytes], { type: frame.mime }));
      try {
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } finally {
        bitmap.close();
      }
    },
    captureStream(frameRate) {
      const track = canvas.captureStream(frameRate).getVideoTracks()[0];
      if (track === undefined) {
        throw new Error("The screen surface did not produce a video track.");
      }
      return track;
    },
  };
}

/**
 * Starts a stream of `source`'s frames at the profile's size and frame rate.
 *
 * Frames are pulled one at a time, so a slow shell slows the share instead of
 * queueing work, and the loop stops the moment the track is stopped.
 */
export async function openDisplayStream(
  source: DisplaySource,
  profile: StreamProfile,
  deps: DisplayStreamDeps = {},
): Promise<DisplayStream> {
  const captureFrame = deps.captureFrame ?? captureDisplayFrame;
  const frameRate = Math.min(Math.max(Math.round(profile.frameRate), 1), 60);
  const interval = 1000 / frameRate;

  // The first frame sizes the surface and paints it, so the track starts on a
  // real picture instead of a black canvas.
  const first = await captureFrame(source.id, profile.width, profile.height);
  const createSurface = deps.createSurface ?? canvasSurface;
  const surface = createSurface(first.width, first.height);
  if (surface === null) {
    throw new Error("This device cannot draw the shared screen.");
  }
  await surface.draw(first);
  const track = surface.captureStream(frameRate);

  let closed = false;
  let waiting: { timer: number; resume: () => void } | null = null;
  let failures = 0;

  // `window.setTimeout` keeps the timer handle a plain number whether or not
  // Node types are in scope.
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        waiting = null;
        resolve();
      }, ms);
      waiting = { timer, resume: resolve };
    });

  const stop = () => {
    if (closed) {
      return;
    }
    closed = true;
    const pendingPause = waiting;
    waiting = null;
    if (pendingPause !== null) {
      window.clearTimeout(pendingPause.timer);
      pendingPause.resume();
    }
    track.stop();
  };

  const poll = async () => {
    while (!closed) {
      const startedAt = performance.now();
      try {
        const frame = await captureFrame(source.id, profile.width, profile.height);
        if (closed) {
          return;
        }
        await surface.draw(frame);
        failures = 0;
      } catch {
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          // The source is gone (a closed window). Ending the track tells the
          // share to tear down instead of showing a frozen picture.
          stop();
          track.dispatchEvent(new Event("ended"));
          return;
        }
      }
      if (closed) {
        return;
      }
      const elapsed = performance.now() - startedAt;
      await pause(elapsed < interval ? interval - elapsed : 0);
    }
  };

  void poll();
  return { track, stop };
}
