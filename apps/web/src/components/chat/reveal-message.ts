/** How long a jumped-to message keeps its highlight before it fades. */
const REVEAL_HIGHLIGHT_MS = 1600;

/** True when the viewer asked the OS to reduce motion. */
function prefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Scrolls the row for `id` into view and briefly marks it so the eye can find
 * it: a fading tint normally, a static outline when motion is reduced. Shared
 * by the reply line and the pin notification so both reveal a message the same
 * way. A missing row (not loaded yet) is left alone.
 */
export function revealMessage(id: string): void {
  const node = document.getElementById(`message-${id}`);
  if (node === null) {
    return;
  }
  if (typeof node.scrollIntoView === "function") {
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (prefersReducedMotion() || typeof node.animate !== "function") {
    const previousOutline = node.style.outline;
    const previousOffset = node.style.outlineOffset;
    node.style.outline = "2px solid var(--aulora-accent)";
    node.style.outlineOffset = "2px";
    globalThis.setTimeout(() => {
      node.style.outline = previousOutline;
      node.style.outlineOffset = previousOffset;
    }, REVEAL_HIGHLIGHT_MS);
    return;
  }
  node.animate(
    [{ backgroundColor: "var(--aulora-accent-soft)" }, { backgroundColor: "transparent" }],
    { duration: REVEAL_HIGHLIGHT_MS, easing: "ease-out" },
  );
}
