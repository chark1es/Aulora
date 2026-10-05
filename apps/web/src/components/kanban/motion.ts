import { usePrefersReducedMotion } from "@aulora/ui-web";
import { type RefObject, useLayoutEffect, useRef } from "react";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Where an element sits on screen, ignoring any transform a running animation applies. */
function place(node: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let positioned: Element | null = node;
  while (positioned instanceof HTMLElement && positioned !== root) {
    x += positioned.offsetLeft;
    y += positioned.offsetTop;
    positioned = positioned.offsetParent;
  }
  let scroller = node.parentElement;
  while (scroller !== null && scroller !== root) {
    x -= scroller.scrollLeft;
    y -= scroller.scrollTop;
    scroller = scroller.parentElement;
  }
  return { x, y };
}

/**
 * Animates every `[data-flip]` element under `root` between renders: items
 * that changed place glide from where they were, items that are new fade in.
 * A new `scope` (for example another board) replays the staggered entrance.
 */
export function useFlip(root: RefObject<HTMLElement | null>, scope: unknown) {
  const reduced = usePrefersReducedMotion();
  const seen = useRef<{ scope: unknown; places: Map<string, { x: number; y: number }> } | null>(
    null,
  );
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const nodes = container.querySelectorAll<HTMLElement>("[data-flip]");
    // An empty pass is a loading state; keep waiting for the real entrance.
    const last = seen.current;
    if (!nodes.length && last?.scope !== scope) return;
    const previous = last !== null && last.scope === scope ? last.places : null;
    const places = new Map<string, { x: number; y: number }>();
    let entering = 0;
    for (const node of nodes) {
      const id = node.dataset.flip ?? "";
      const now = place(node, container);
      places.set(id, now);
      if (reduced || typeof node.animate !== "function") continue;
      const before = previous?.get(id);
      if (before) {
        const dx = before.x - now.x;
        const dy = before.y - now.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1)
          node.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)`, zIndex: 1 },
              { transform: "none", zIndex: 1 },
            ],
            { duration: 260, easing: EASE },
          );
      } else
        node.animate(
          [
            { opacity: 0, transform: previous ? "scale(0.96)" : "translateY(8px)" },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: 220,
            easing: EASE,
            fill: "backwards",
            // Only the first paint of a board staggers; later arrivals appear at once.
            delay: previous ? 0 : Math.min(entering++ * 18, 180),
          },
        );
    }
    seen.current = { scope, places };
  });
}
