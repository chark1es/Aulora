/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { PipSource } from "./pip-source";

/**
 * Picture-in-picture for browsers without Document Picture-in-Picture (Safari,
 * Firefox, and the macOS desktop engine). They can only float a `<video>`, so
 * the call is drawn onto a canvas, captured as a stream and floated from a
 * hidden video element. It shows one participant: a screen share, the speaker,
 * or the first other person.
 */
export interface VideoPip {
  setSource(source: PipSource): void;
  stop(): void;
}

const WIDTH = 640;
const HEIGHT = 360;

export function videoPipSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    document.pictureInPictureEnabled === true &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

/** Draws a picture scaled to fit inside the frame, centred. */
function drawContained(context: CanvasRenderingContext2D, video: HTMLVideoElement): void {
  const scale = Math.min(WIDTH / video.videoWidth, HEIGHT / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  context.drawImage(video, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
}

function drawPlaceholder(context: CanvasRenderingContext2D, label: string): void {
  context.fillStyle = "#334155";
  context.beginPath();
  context.arc(WIDTH / 2, HEIGHT / 2 - 10, 56, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f8fafc";
  context.font = "bold 56px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText((label.trim()[0] ?? "?").toUpperCase(), WIDTH / 2, HEIGHT / 2 - 8);
}

function drawCaption(context: CanvasRenderingContext2D, source: PipSource): void {
  context.fillStyle = "rgba(0,0,0,0.55)";
  context.fillRect(0, HEIGHT - 44, WIDTH, 44);
  context.fillStyle = "#ffffff";
  context.font = "600 22px system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(source.muted ? `${source.label} (muted)` : source.label, 16, HEIGHT - 22);
}

function hiddenVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  // Present in the document (some engines refuse to float a detached element)
  // but invisible.
  video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(video);
  return video;
}

/**
 * Starts the floating video. Must be called from a user gesture, which the
 * browser requires to open picture-in-picture. `onClosed` runs when the user
 * closes the floating window.
 */
export async function startVideoPip(initial: PipSource, onClosed: () => void): Promise<VideoPip> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("A 2D canvas is not available");
  }
  const source = hiddenVideo();
  const output = hiddenVideo();
  let current = initial;
  const draw = () => {
    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    if (source.readyState >= 2 && source.videoWidth > 0) {
      drawContained(context, source);
    } else {
      drawPlaceholder(context, current.label);
    }
    drawCaption(context, current);
  };
  const ticker = new Worker(new URL("./pip-ticker.worker.ts", import.meta.url), { type: "module" });
  ticker.onmessage = draw;
  draw();
  output.srcObject = canvas.captureStream(15);
  const cleanup = () => {
    ticker.terminate();
    source.srcObject = null;
    output.srcObject = null;
    source.remove();
    output.remove();
  };
  try {
    await output.play();
    await output.requestPictureInPicture();
  } catch (error) {
    cleanup();
    throw error;
  }
  const apply = (next: PipSource) => {
    current = next;
    if (source.srcObject !== next.stream) {
      source.srcObject = next.stream;
      if (next.stream !== null) {
        void source.play().catch(() => undefined);
      }
    }
  };
  apply(initial);
  output.addEventListener("leavepictureinpicture", () => {
    cleanup();
    onClosed();
  });
  return {
    setSource: apply,
    stop() {
      if (document.pictureInPictureElement === output) {
        void document.exitPictureInPicture().catch(() => undefined);
      }
      cleanup();
    },
  };
}
