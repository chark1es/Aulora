import { useEffect, useState } from "react";

/** Tailwind's `md`, where the channel sidebar and the canvas share the screen. */
export const WIDE_SHELL_QUERY = "(min-width: 768px)";

function matchesWideShell(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(WIDE_SHELL_QUERY).matches
  );
}

/**
 * Whether the viewport is wide enough for the two-pane shell.
 *
 * On a phone the sidebar and the canvas take turns (`mobilePane`), so the canvas
 * can be hidden even with `mainView === "chat"`. Tracking the media query keeps
 * visibility-based side effects (such as read receipts) honest on both sizes.
 */
export function useWideShell(): boolean {
  const [wide, setWide] = useState(matchesWideShell);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(WIDE_SHELL_QUERY);
    const update = () => {
      setWide(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
  return wide;
}
