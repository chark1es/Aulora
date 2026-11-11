import { createTypingThrottle } from "@aulora/core";
import { useCallback, useRef } from "react";
import type { Fn } from "../../lib/function-type";

type TypingThrottle = ReturnType<typeof createTypingThrottle>;

/** Typing pings throttled per channel, and the retraction that stops the indicator. */
export function useComposerTyping(
  onTyping: Fn<[channelId: string], void>,
  onClearTyping: Fn<[channelId: string], void> | undefined,
) {
  // Latest callbacks, so the throttle instance below can be created once.
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;
  const onClearTypingRef = useRef(onClearTyping);
  onClearTypingRef.current = onClearTyping;
  const throttleRef = useRef<TypingThrottle>(null);
  if (throttleRef.current === null) {
    throttleRef.current = createTypingThrottle((id) => {
      onTypingRef.current(id);
    });
  }
  const ping = (id: string) => {
    throttleRef.current?.ping(id);
  };
  const stop = useCallback((id: string) => {
    throttleRef.current?.reset(id);
    onClearTypingRef.current?.(id);
  }, []);
  return { ping, stop };
}
