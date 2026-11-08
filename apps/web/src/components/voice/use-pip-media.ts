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

    const unregisterFrames = registerPipFrames((bytes) => {
      if (disposed) {
        return;
      }
      painter ??= createPipFramePainter(canvasRef.current);
      painter.draw(bytes);
      setKind((current) => (current === "frames" ? current : "frames"));
    });

    if (loopbackSupported()) {
      receiver = createPipReceiver({
        send: (signal) => {
          void emitDesktopEventTo(MAIN_WINDOW_LABEL, PIP_SIGNAL_EVENT, signal);
        },
        onTrack: (track) => {
          const video = videoRef.current;
          if (video === null) {
            return;
          }
          video.srcObject = new MediaStream([track]);
          void video.play().catch(() => {
            // Muted autoplay is allowed; a refusal leaves the frame fallback.
          });
          setKind("loopback");
        },
        onState: (state) => {
          if (state === "idle" || state === "failed" || state === "closed") {
            setKind((current) => (current === "loopback" ? "none" : current));
          }
        },
      });
      void listenDesktopEvent(PIP_SIGNAL_EVENT, (payload) => {
        const signal = parseLoopbackSignal(payload);
        if (signal !== null) {
          receiver?.receive(signal);
        }
      }).then((off) => {
        if (disposed) {
          off();
        } else {
          unlisten = off;
        }
      });
    }

    return () => {
      disposed = true;
      unlisten?.();
      receiver?.transport.close();
      receiver = null;
      unregisterFrames();
      painter = null;
    };
  }, []);

  return { kind, videoRef, canvasRef };
}
