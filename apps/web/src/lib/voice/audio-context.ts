/** The browser's `AudioContext`, including the prefixed one older Safari ships. */
export function audioContextCtor(): typeof AudioContext | null {
  if (typeof AudioContext !== "undefined") {
    return AudioContext;
  }
  const legacy: unknown = Reflect.get(globalThis, "webkitAudioContext");
  return typeof legacy === "function" ? (legacy as typeof AudioContext) : null;
}
