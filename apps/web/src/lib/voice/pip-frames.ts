/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
/**
 * The call window's last-resort video transport.
 *
 * Some webviews (notably older WebKitGTK builds) have no working loopback peer
 * connection between two webviews. When that happens the main window draws the
 * chosen source into a small canvas at 15 fps, encodes a JPEG per frame, and
 * pushes the *raw* bytes over Tauri IPC. The shell forwards each frame on a
 * `Channel` to the call window, which draws it into its own canvas.
 *
 * Never the first choice: it costs CPU in both webviews and only survives as a
 * still picture. It exists so the window still shows the call on the platforms
 * where WebRTC between webviews does not work.
 */
import { createDesktopChannel, invokeDesktopCommand, invokeDesktopRaw } from "../desktop";

/** The encoded frame size: readable in a 240px-wide window, cheap to encode. */
export const PIP_FRAME_WIDTH = 480;
export const PIP_FRAME_HEIGHT = 270;
/** Frames per second. Low enough for a small window, high enough to feel live. */
export const PIP_FRAME_FPS = 15;
/** JPEG quality. The window is small, so a soft frame is still readable. */
const JPEG_QUALITY = 0.6;

/** How the call window is getting its picture right now. */
export type PipTransportKind = "loopback" | "frames" | "avatars";

/**
 * Decides which transport the main window should be using: the live loopback
 * when it connected, still frames when it cannot or did not connect in time,
 * and nothing when neither is possible (the window keeps drawing avatars).
 * While the loopback is still connecting this returns `"loopback"` so the
 * caller does not start the fallback early.
 */
export function choosePipTransport(input: {
  readonly loopbackSupported: boolean;
  readonly framesSupported: boolean;
  readonly loopbackConnected: boolean;
  readonly loopbackFailed: boolean;
  readonly elapsedMs: number;
  readonly timeoutMs?: number;
}): PipTransportKind {
  if (input.loopbackConnected) {
    return "loopback";
  }
  const timedOut = input.elapsedMs >= (input.timeoutMs ?? 4_000);
  const loopbackDead = !input.loopbackSupported || input.loopbackFailed || timedOut;
  if (!loopbackDead) {
    return "loopback";
  }
  return input.framesSupported ? "frames" : "avatars";
}

/**
 * A rate limiter for frame encoding. `due(atMs)` is true at most `fps` times a
 * second and advances the clock itself, so a slow encode cannot burst.
 */
export function createFrameClock(
  fps: number,
  now: () => number = () => performance.now(),
): { due(at?: number): boolean } {
  const interval = 1000 / Math.max(1, fps);
  let next = 0;
  return {
    due(at = now()) {
      if (at < next) {
        return false;
      }
      next = at + interval;
      return true;
    },
  };
}

export interface PipFrameSender {
  setTrack(track: MediaStreamTrack | null): void;
  close(): void;
}

export interface PipFrameSenderOptions {
  readonly track: MediaStreamTrack | null;
  /** Injected in tests and by callers that already own an encoder. */
  readonly push?: (bytes: Uint8Array) => void;
  readonly fps?: number;
}

/** Whether this webview can encode and push frames at all. */
export function framesSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.createElement === "function" &&
    typeof HTMLCanvasElement !== "undefined"
  );
}

/** Pushes one encoded frame from the main window to the shell. */
export async function pushPipFrame(bytes: Uint8Array): Promise<void> {
  await invokeDesktopRaw("push_pip_frame", bytes);
}

/**
 * Draws the chosen track into a canvas and pushes a JPEG per tick. Returns a
 * sender the caller changes (`setTrack`) or stops (`close`). Frames are dropped
 * rather than queued: a late picture is worse than a missing one.
 */
export function startPipFrameSender(options: PipFrameSenderOptions): PipFrameSender {
  const fps = options.fps ?? PIP_FRAME_FPS;
  const push = options.push ?? ((bytes: Uint8Array) => void pushPipFrame(bytes));
  const clock = createFrameClock(fps);
  const canvas = document.createElement("canvas");
  canvas.width = PIP_FRAME_WIDTH;
  canvas.height = PIP_FRAME_HEIGHT;
  const context = canvas.getContext("2d");
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  // Off-screen rather than detached: some webviews decode only composited
  // video, and a 1px, transparent element costs nothing.
  video.style.position = "fixed";
  video.style.left = "-10000px";
  video.style.top = "0";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.append(video);
  let closed = false;
  let busy = false;

  video.addEventListener("loadedmetadata", () => {
    void video.play().catch(() => {
      // Autoplay of a muted, track-backed video is allowed; a refusal only
      // means no frames, never an error dialog.
    });
  });

  const draw = () => {
    if (closed || busy || context === null || video.readyState < 2 || video.videoWidth === 0) {
      return;
    }
    if (!clock.due()) {
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    busy = true;
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          busy = false;
          return;
        }
        void blob
          .arrayBuffer()
          .then((buffer) => {
            if (!closed) {
              push(new Uint8Array(buffer));
            }
          })
          .finally(() => {
            busy = false;
          });
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  };

  const timer = setInterval(draw, 1000 / Math.max(1, fps));

  const attach = (next: MediaStreamTrack | null) => {
    if (closed) {
      return;
    }
    video.srcObject =
      next === null || typeof MediaStream === "undefined" ? null : new MediaStream([next]);
    if (next !== null) {
      void video.play().catch(() => {
        // See above: the picture is optional.
      });
    }
  };
  attach(options.track);

  return {
    setTrack: attach,
    close() {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(timer);
      video.srcObject = null;
      video.remove();
    },
  };
}

/**
 * Registers this webview as the frame target. The token guards against two
 * registrations racing (React re-mounts) leaving the shell pointed at a channel
 * whose handler has already been removed. Returns the unregister function.
 */
export function registerPipFrames(onFrame: (bytes: Uint8Array) => void): () => void {
  const channel = createDesktopChannel();
  if (channel === null) {
    return () => {};
  }
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let active = true;
  channel.onmessage = (message) => {
    if (Array.isArray(message)) {
      onFrame(Uint8Array.from(message as number[]));
    } else if (message instanceof ArrayBuffer) {
      onFrame(new Uint8Array(message));
    } else if (ArrayBuffer.isView(message)) {
      onFrame(new Uint8Array(message.buffer, message.byteOffset, message.byteLength));
    }
  };
  void invokeDesktopCommand("register_pip_frames", { channel, token }).catch(() => {
    // No frame fallback outside the shell.
  });
  return () => {
    if (!active) {
      return;
    }
    active = false;
    channel.onmessage = null;
    void invokeDesktopCommand("unregister_pip_frames", { token }).catch(() => {
      // The window is going away anyway.
    });
  };
}

export interface PipFramePainter {
  draw(bytes: Uint8Array): void;
}

/**
 * Draws JPEG frames into a canvas, dropping a frame that arrives while the last
 * one is still decoding. `createImageBitmap` is used where it exists; the
 * object-URL image path covers the webviews that do not have it.
 */
export function createPipFramePainter(canvas: HTMLCanvasElement | null): PipFramePainter {
  const context = canvas?.getContext("2d") ?? null;
  let decoding = false;
  return {
    draw(bytes) {
      if (context === null || canvas === null || decoding) {
        return;
      }
      const blob = new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" });
      decoding = true;
      const done = () => {
        decoding = false;
      };
      if (typeof createImageBitmap === "function") {
        void createImageBitmap(blob)
          .then((bitmap) => {
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close?.();
          })
          .catch(done)
          .finally(() => {
            decoding = false;
          });
        return;
      }
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        decoding = false;
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        decoding = false;
      };
      image.src = url;
    },
  };
}
