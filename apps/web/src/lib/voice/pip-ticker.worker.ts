/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
/**
 * Ticks on a worker's clock. A page that is hidden (which is exactly when a
 * picture-in-picture video is useful) has its own timers slowed to once a
 * second; a worker's are not, so the PiP picture keeps its frame rate.
 */
const worker = self as unknown as { postMessage(message: string): void };
setInterval(() => {
  worker.postMessage("tick");
}, 66);
