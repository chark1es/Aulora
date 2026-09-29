import { formatCallDuration } from "@aulora/core";
import { useEffect, useState } from "react";

/** Ticks once a second while `startedAt` is set, returning a formatted duration. */
export function useCallDuration(startedAt: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? "0:00" : formatCallDuration(now - startedAt);
}
