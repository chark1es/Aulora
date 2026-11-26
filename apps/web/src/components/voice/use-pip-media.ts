import { useEffect, useRef, useState } from "react";
import { MAIN_WINDOW_LABEL, PIP_SIGNAL_EVENT } from "../../lib/call-pip";
import { emitDesktopEventTo, listenDesktopEvent } from "../../lib/desktop";
import {
  createPipFramePainter,
  type PipFramePainter,
  registerPipFrames,
} from "../../lib/voice/pip-frames";
import {
  createPipReceiver,
  loopbackSupported,
  type PipReceiverHandle,
  parseLoopbackSignal,
} from "../../lib/voice/pip-loopback";

/** What the call window's picture surface is currently drawing. */
export type PipSurfaceKind = "loopback" | "frames" | "none";

export interface PipSurface {
  readonly kind: PipSurfaceKind;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

/**
 * The call window's half of the video transport.
 *
 * Announces itself (`ready`) so the main window offers even when this webview
 * loaded after the call, answers the loopback offer, and attaches the one video
 * track it is given. Audio never arrives and is never attached: the call's sound
 * keeps coming from the main window. The frame channel is registered at the same
 * time, so the fallback starts drawing the moment the main window decides the
 * loopback is not coming.
 *
 * The live picture is reported only once it has decoded a frame. A received
 * track can stay empty (a paused camera, a decoder that never starts), and
 * showing it then draws black where the avatars should be.
 */
export function usePipMedia(): PipSurface {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [kind, setKind] = useState<PipSurfaceKind>("none");

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let painter: PipFramePainter | null = null;
    let receiver: PipReceiverHandle | null = null;
    const video = videoRef.current;
    const onDecodedFrame = () => {
      // A size alone is only metadata; the current frame has to be there too.
      if (
        !disposed &&
        video !== null &&
        video.videoWidth > 0 &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        setKind((current) => (current === "loopback" ? current : "loopback"));
      }
    };
    // `loadeddata` is the first decoded frame; `resize` covers a new track on
    // an element that already had one.
    video?.addEventListener("loadeddata", onDecodedFrame);
    video?.addEventListener("resize", onDecodedFrame);

    const unregisterFrames = registerPipFrames((bytes) => {
      if (disposed) {
        return;
      }
      painter ??= createPipFramePainter(canvasRef.current);
      painter.draw(bytes);
      setKind((current) => (current === "frames" ? current : "frames"));
    });

    if (loopbackSupported()) {
      // Listen before announcing: the receiver says `ready` as it starts, and
      // the main window's offer can come straight back.
      void listenDesktopEvent(PIP_SIGNAL_EVENT, (payload) => {
        const signal = parseLoopbackSignal(payload);
        if (signal !== null) {
          receiver?.receive(signal);
        }
      }).then((off) => {
        if (disposed) {
          off();
          return;
        }
        unlisten = off;
        receiver = createPipReceiver({
          send: (signal) => {
            void emitDesktopEventTo(MAIN_WINDOW_LABEL, PIP_SIGNAL_EVENT, signal);
          },
          onTrack: (track) => {
            if (video === null) {
              return;
            }
            // A new stream has to decode its own first frame before it is
            // shown; the last one's may be all this element has.
            setKind((current) => (current === "loopback" ? "none" : current));
            video.srcObject = new MediaStream([track]);
            void video.play().catch(() => {
              // Muted autoplay is allowed; a refusal leaves the frame fallback.
            });
          },
          onState: (state) => {
            if (state === "idle" || state === "failed" || state === "closed") {
              setKind((current) => (current === "loopback" ? "none" : current));
            }
          },
        });
      });
    }

    return () => {
      disposed = true;
      video?.removeEventListener("loadeddata", onDecodedFrame);
      video?.removeEventListener("resize", onDecodedFrame);
      unlisten?.();
      receiver?.transport.close();
      receiver = null;
      unregisterFrames();
      painter = null;
    };
  }, []);

  return { kind, videoRef, canvasRef };
}
