import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs` while `enabled`. The countdown
 * on a scheduled call is cosmetic: the server's refusal is what keeps an early
 * join out, so a coarse tick is enough and saves re-rendering the whole list.
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs, enabled]);
  return now;
}
