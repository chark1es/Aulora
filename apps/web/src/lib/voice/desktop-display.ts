import type { StreamProfile } from "@aulora/core";
import { createDesktopChannel, invokeDesktopCommand } from "../desktop";

/**
 * Native screen and window capture for the desktop shell.
 *
 * The webview draws its own `getDisplayMedia` picker, which cannot be styled or
 * replaced, so the shell enumerates the capture sources itself and hands over
 * one JPEG frame per request. This module draws those frames into a canvas and
 * captures the canvas, which keeps encoding and pacing in the webview's own
 * video pipeline instead of adding a native streaming path. A couple of requests
 * stay in flight so the shell's capture and encode of the next frame overlaps
 * the IPC, decode and draw of the current one.
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
  /**
   * The shell's wrapping 16-bit count of completed grabs, so frames can be
   * ordered by when their pixels were taken. 0 (or absent) means unordered, as
   * older shells left the field zero.
   */
  readonly sequence?: number;
}

/** Magic, version, format, capture sequence and two sizes: see the shell's `capture.rs`. */
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
    sequence: header.getUint16(6, true),
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

/** What the capture loop draws into; injectable so tests need no canvas. */
export interface FrameSurface {
  /** Paints the frame and, when the surface can, emits it on the track right away. */
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
  /** Ends the capture loop and the track. Safe to call more than once. */
  stop(): void;
}

/**
 * How long, and how many times in a row, frames must fail before the share
 * gives up. A window that was closed keeps failing; anything shorter-lived (a
 * compositor hiccup) recovers. The time floor keeps a 60 fps share, which can
 * fail fifteen times in a quarter of a second, from ending on a brief hiccup.
 */
const MAX_CONSECUTIVE_FAILURES = 15;
export const FAILURE_WINDOW_MS = 2_000;

/**
 * Failures of one kind in a row. Capture and draw failures are counted apart,
 * so frames that keep arriving cannot hide a surface that never manages to
 * draw them (a frozen share that never ends).
 */
function failureStreak() {
  let count = 0;
  let since: number | null = null;
  return {
    reset() {
      count = 0;
      since = null;
    },
    /** Records one failure; true once the streak is long enough to give up. */
    record(now: number): boolean {
      count += 1;
      since ??= now;
      return count >= MAX_CONSECUTIVE_FAILURES && now - since >= FAILURE_WINDOW_MS;
    },
  };
}

/**
 * How early a capture may start. Timers can fire a fraction of a millisecond
 * before their deadline, and re-arming for that remainder costs a clamped 4 ms
 * nested timer, which alone caps a 60 fps share near 50.
 */
const TIMER_SLACK_MS = 1;

/**
 * Capture requests allowed in flight at once. The shell runs each on its own
 * blocking thread, so three keep the next frames' capture and encode (about 25
 * to 40 ms each) overlapped with the current frame's IPC, decode and draw, which
 * a 60 fps share needs, and spread the work over several cores.
 */
export const MAX_CAPTURES_IN_FLIGHT = 3;

type FrameTrack = MediaStreamTrack & { requestFrame?: () => void };

/** Draws JPEG frames into a canvas and captures that canvas as a video track. */
function canvasSurface(width: number, height: number): FrameSurface | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  // Screen frames are opaque, so an alpha-less canvas skips compositing work.
  const context = canvas.getContext("2d", { alpha: false });
  if (context === null) {
    return null;
  }
  let track: FrameTrack | null = null;
  // Set when the track only emits on `requestFrame`, so every drawn frame goes
  // out once, when it is drawn, instead of being sampled by a timer.
  let manual = false;
  return {
    async draw(frame) {
      const bitmap = await createImageBitmap(new Blob([frame.bytes], { type: frame.mime }));
      try {
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } finally {
        bitmap.close();
      }
      if (manual) {
        track?.requestFrame?.();
      }
    },
    captureStream(frameRate) {
      let candidate: FrameTrack | undefined;
      try {
        candidate = canvas.captureStream(0).getVideoTracks()[0] as FrameTrack | undefined;
      } catch {
        // An engine that rejects a zero frame rate takes the timed path below.
        candidate = undefined;
      }
      if (candidate !== undefined && typeof candidate.requestFrame === "function") {
        manual = true;
        // Emit the frame that is already painted.
        candidate.requestFrame();
      } else {
        candidate?.stop();
        candidate = canvas.captureStream(frameRate).getVideoTracks()[0] as FrameTrack | undefined;
      }
      if (candidate === undefined) {
        throw new Error("The screen surface did not produce a video track.");
      }
      track = candidate;
      return candidate;
    },
  };
}

/** Where a frame sits in the stream: its request order and the shell's grab order. */
interface FrameStamp {
  readonly request: number;
  readonly capture: number;
}

/**
 * Whether `a` shows a later picture than `b`. The shell's grab sequence decides
 * when both frames carry one (a request that stalled before its grab can return
 * a newer picture than one started after it); otherwise request order does.
 */
function newerThan(a: FrameStamp, b: FrameStamp): boolean {
  if (a.capture !== 0 && b.capture !== 0 && a.capture !== b.capture) {
    // Wrapping 16-bit comparison: ahead by less than half the range is newer.
    return ((a.capture - b.capture) & 0xffff) < 0x8000;
  }
  return a.request > b.request;
}

/**
 * Starts a stream of `source`'s frames at the profile's size and frame rate.
 *
 * Up to [`MAX_CAPTURES_IN_FLIGHT`] frames are requested at once, never faster
 * than the frame interval, so a slow shell slows the share instead of queueing
 * work. Replies can arrive out of order: the newest picture wins (by the shell's
 * grab sequence), a frame older than one already drawn is dropped, and only one
 * draw runs at a time. The loop stops the moment the track is stopped.
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
  let timer: number | null = null;
  const captureFailures = failureStreak();
  const drawFailures = failureStreak();
  let inFlight = 0;
  // When the next capture is due. It advances by whole intervals so the pace
  // does not drift with timer jitter.
  let nextDue = performance.now() + interval;
  // Requests are numbered in the order they start; the first frame was 0.
  let nextRequest = 1;
  let drawn: FrameStamp = { request: 0, capture: first.sequence ?? 0 };
  let drawing = false;
  let pending: { stamp: FrameStamp; frame: CaptureFrame } | null = null;

  const stop = () => {
    if (closed) {
      return;
    }
    closed = true;
    pending = null;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    track.stop();
  };

  const fail = (streak: ReturnType<typeof failureStreak>) => {
    if (streak.record(performance.now()) && !closed) {
      // The source is gone (a closed window) or its frames cannot be drawn.
      // Ending the track tells the share to tear down instead of showing a
      // frozen picture.
      stop();
      track.dispatchEvent(new Event("ended"));
    }
  };

  /** Draws the newest waiting frame, and whatever arrives while it draws. */
  const drain = async () => {
    if (drawing) {
      return;
    }
    drawing = true;
    try {
      while (!closed && pending !== null) {
        const { stamp, frame } = pending;
        pending = null;
        if (!newerThan(stamp, drawn)) {
          continue;
        }
        drawn = stamp;
        try {
          await surface.draw(frame);
          drawFailures.reset();
        } catch {
          fail(drawFailures);
        }
      }
    } finally {
      drawing = false;
    }
  };

  const deliver = (request: number, frame: CaptureFrame) => {
    const stamp: FrameStamp = { request, capture: frame.sequence ?? 0 };
    if (closed || !newerThan(stamp, drawn)) {
      return;
    }
    if (pending === null || newerThan(stamp, pending.stamp)) {
      pending = { stamp, frame };
    }
    void drain();
  };

  const launch = () => {
    const request = nextRequest;
    nextRequest += 1;
    inFlight += 1;
    const now = performance.now();
    nextDue += interval;
    if (nextDue <= now) {
      // A slot was missed (the cap was full): skip it rather than burst.
      nextDue = now + interval;
    }
    captureFrame(source.id, profile.width, profile.height).then(
      (frame) => {
        inFlight -= 1;
        // The source is alive, even if this frame turns out to be stale.
        captureFailures.reset();
        deliver(request, frame);
        pump();
      },
      () => {
        inFlight -= 1;
        fail(captureFailures);
        pump();
      },
    );
  };

  /** Starts a capture when the cap and the frame interval both allow one. */
  const pump = () => {
    if (closed || timer !== null || inFlight >= MAX_CAPTURES_IN_FLIGHT) {
      return;
    }
    const wait = nextDue - performance.now();
    if (wait > TIMER_SLACK_MS) {
      timer = window.setTimeout(() => {
        timer = null;
        pump();
      }, Math.ceil(wait));
      return;
    }
    launch();
    pump();
  };

  pump();
  return { track, stop };
}
