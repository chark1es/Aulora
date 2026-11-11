import { type CSSProperties, type RefObject, useLayoutEffect, useState } from "react";

/** Only backdrop presses consume a click: Save and other controls act immediately. */
export function swallowOutsideClick(target: EventTarget | null) {
  if (!(target instanceof Element) || !target.matches("[data-modal-backdrop]")) return;
  const cleanup = () => {
    document.removeEventListener("click", swallow, true);
    document.removeEventListener("pointerdown", cleanup, true);
  };
  const swallow = (event: MouseEvent) => {
    if (event.target === target) {
      event.preventDefault();
      event.stopPropagation();
    }
    cleanup();
  };
  document.addEventListener("click", swallow, true);
  document.addEventListener("pointerdown", cleanup, true);
  return cleanup;
}

/** A viewport-anchored popup stays outside scroll clipping and follows its trigger. */
export function useSelectPopup(
  open: boolean,
  triggerRef: RefObject<HTMLButtonElement | null>,
  listRef: RefObject<HTMLDivElement | null>,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const update = (event?: Event) => {
      if (event?.target instanceof Node && listRef.current?.contains(event.target)) return;
      const trigger = triggerRef.current;
      const list = listRef.current;
      if (trigger === null || list === null) return;
      const rect = trigger.getBoundingClientRect();
      const below = Math.max(0, window.innerHeight - rect.bottom - 12);
      const above = Math.max(0, rect.top - 12);
      const upward = list.scrollHeight > below && above > below;
      const width = Math.min(Math.max(rect.width, list.offsetWidth), window.innerWidth - 16);
      const next: CSSProperties = {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
        ...(upward ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
        maxHeight: upward ? above : below,
      };
      setStyle((previous) =>
        previous.left === next.left &&
        previous.width === next.width &&
        previous.top === next.top &&
        previous.bottom === next.bottom &&
        previous.maxHeight === next.maxHeight
          ? previous
          : next,
      );
    };
    update();
    listRef.current?.focus();
    let frame: number;
    const followTrigger = () => {
      update();
      frame = window.requestAnimationFrame(followTrigger);
    };
    frame = window.requestAnimationFrame(followTrigger);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, triggerRef, listRef]);
  return style;
}
