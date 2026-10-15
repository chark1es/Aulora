/**
 * Backgrounds that can replace the camera's own. The built-in ones are drawn from
 * a few colour stops, so there are no image files to license or ship; a person's
 * own picture is kept on this device only.
 */
export interface Backdrop {
  readonly id: string;
  readonly label: string;
  /** Colour stops from the top-left to the bottom-right corner. */
  readonly stops: readonly string[];
}

export const BACKDROPS: readonly Backdrop[] = [
  { id: "dusk", label: "Dusk", stops: ["#1e1b4b", "#7c3aed", "#f472b6"] },
  { id: "aurora", label: "Aurora", stops: ["#022c22", "#0f766e", "#38bdf8"] },
  { id: "slate", label: "Slate", stops: ["#0f172a", "#334155", "#64748b"] },
  { id: "sand", label: "Sand", stops: ["#fef3c7", "#fdba74", "#fb7185"] },
];

export const CUSTOM_BACKDROP_ID = "custom";
const CUSTOM_KEY = "aulora.voiceBackdrop.v1";
/** A picture is shrunk to this before it is stored and drawn. */
const MAX_EDGE = 1280;
const MAX_STORED_CHARS = 1_200_000;

/** The CSS gradient for a swatch or a preview of a built-in backdrop. */
export function backdropGradient(backdrop: Backdrop): string {
  return `linear-gradient(135deg, ${backdrop.stops.join(", ")})`;
}

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawGradient(backdrop: Backdrop, width: number, height: number): HTMLCanvasElement {
  const canvas = newCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null) {
    return canvas;
  }
  const gradient = context.createLinearGradient(0, 0, width, height);
  backdrop.stops.forEach((color, index) => {
    gradient.addColorStop(index / Math.max(1, backdrop.stops.length - 1), color);
  });
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  // A soft light from one corner, so the backdrop reads as a room and not a flat fill.
  const glow = context.createRadialGradient(
    width * 0.75,
    height * 0.2,
    0,
    width * 0.75,
    height * 0.2,
    width * 0.6,
  );
  glow.addColorStop(0, "rgba(255,255,255,0.22)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  return canvas;
}

/** Fills `width` x `height` with the picture, cropping the excess like CSS `cover`. */
function drawCover(
  image: CanvasImageSource,
  source: { width: number; height: number },
  width: number,
  height: number,
) {
  const canvas = newCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null || source.width === 0 || source.height === 0) {
    return canvas;
  }
  const scale = Math.max(width / source.width, height / source.height);
  const drawnWidth = source.width * scale;
  const drawnHeight = source.height * scale;
  context.drawImage(
    image,
    (width - drawnWidth) / 2,
    (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
  return canvas;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error("The picture could not be read"));
    };
    image.src = url;
  });
}

/** The stored picture as a data URL, for a thumbnail; `null` when there is none. */
export function customBackdropUrl(): string | null {
  try {
    const stored = globalThis.localStorage.getItem(CUSTOM_KEY);
    return stored?.startsWith("data:image/") === true ? stored : null;
  } catch {
    return null;
  }
}

/** Whether the user has stored a picture of their own. */
export function hasCustomBackdrop(): boolean {
  return customBackdropUrl() !== null;
}

/** Draws the chosen backdrop at the output size, or `null` if it is gone. */
export async function renderBackdrop(
  id: string,
  width: number,
  height: number,
): Promise<HTMLCanvasElement | null> {
  const builtIn = BACKDROPS.find((entry) => entry.id === id);
  if (builtIn !== undefined) {
    return drawGradient(builtIn, width, height);
  }
  if (id !== CUSTOM_BACKDROP_ID) {
    return null;
  }
  try {
    const stored = globalThis.localStorage.getItem(CUSTOM_KEY);
    if (stored === null || stored.length === 0) {
      return null;
    }
    const image = await loadImage(stored);
    return drawCover(
      image,
      { width: image.naturalWidth, height: image.naturalHeight },
      width,
      height,
    );
  } catch {
    return null;
  }
}

/**
 * Stores a picture as the custom backdrop, scaled down and re-encoded so it
 * stays small and any metadata in the original is dropped.
 */
export async function saveCustomBackdrop(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = newCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL("image/jpeg", 0.85);
    if (encoded.length > MAX_STORED_CHARS) {
      throw new Error("That picture is too large to keep. Try a smaller one.");
    }
    globalThis.localStorage.setItem(CUSTOM_KEY, encoded);
  } finally {
    bitmap.close();
  }
}

export function clearCustomBackdrop(): void {
  try {
    globalThis.localStorage.removeItem(CUSTOM_KEY);
  } catch {
    // Nothing stored, or storage is blocked.
  }
}
