/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { cn, Icon, MODAL_SHADOW } from "@aulora/ui-web";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { SidebarNavButton } from "./ChannelSidebarChrome";

/** One workspace addon behind the single Addons nav entry. */
export interface AddonMenuItem {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly onSelect: () => void;
}

export interface AddonMenuPlacement {
  readonly placement: "down" | "up";
  readonly maxHeight: number;
}

const MENU_GAP = 8;
const MENU_MIN_HEIGHT = 96;
const MENU_MAX_HEIGHT = 320;

/**
 * Places the menu where a short window can still use it.
 *
 * The sidebar is a full-height pane with `overflow-hidden`, so a dropdown that
 * runs past the bottom would be clipped. Open downward when there is room,
 * otherwise upward, and cap the height so the rows scroll instead of spilling
 * off-screen on a small laptop or a phone-sized browser window.
 */
export function addonMenuPlacement(
  viewportHeight: number,
  triggerTop: number,
  triggerBottom: number,
): AddonMenuPlacement {
  const below = viewportHeight - triggerBottom - MENU_GAP;
  const above = triggerTop - MENU_GAP;
  const placement = below >= above ? "down" : "up";
  const available = placement === "down" ? below : above;
  return {
    placement,
    maxHeight: Math.max(MENU_MIN_HEIGHT, Math.min(available, MENU_MAX_HEIGHT)),
  };
}

/** Moves the roving focus of the addons menu by one row, wrapping at the ends. */
function focusTarget(key: string, current: number, last: number): number {
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return last;
    case "ArrowUp":
      return current <= 0 ? last : current - 1;
    default:
      return current >= last ? 0 : current + 1;
  }
}

/**
 * A single sidebar row for every addon the workspace enables. The row opens a
 * menu instead of adding one nav row per addon, so the workspace nav stays the
 * same length as addons are added.
 */
export function AddonsMenu({ items }: { readonly items: readonly AddonMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<AddonMenuPlacement>({
    placement: "down",
    maxHeight: MENU_MAX_HEIGHT,
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const active = items.some((item) => item.active);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        close(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger === null) return;
    const rect = trigger.getBoundingClientRect();
    setPlacement(addonMenuPlacement(window.innerHeight, rect.top, rect.bottom));
  }, []);

  // Re-measure while open so a resize or an on-screen keyboard keeps the rows
  // inside the sidebar pane.
  useEffect(() => {
    if (!open) {
      return;
    }
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // The first item takes focus so the menu is immediately keyboard-drivable.
  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const rows = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []),
    ];
    const focused = document.activeElement;
    const current = focused instanceof HTMLButtonElement ? rows.indexOf(focused) : -1;
    rows.at(focusTarget(event.key, current, rows.length - 1))?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <SidebarNavButton
        ref={triggerRef}
        label="Addons"
        testId="sidebar-addons"
        icon={<Icon name="grid" size={16} />}
        active={active}
        hasPopup="menu"
        expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      />
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Addons"
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            // Tabbing past the menu moves focus outside it. Close and let
            // focus continue to the page's natural next stop.
            const next = event.relatedTarget;
            if (next === null || !menuRef.current?.contains(next as Node)) {
              close(false);
            }
          }}
          style={{ maxHeight: placement.maxHeight }}
          className={cn(
            "absolute left-0 right-0 z-20 animate-pop-in overflow-y-auto overscroll-contain rounded-[10px] bg-surface-2 p-1",
            placement.placement === "down" ? "top-full mt-1" : "bottom-full mb-1",
            MODAL_SHADOW,
          )}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitemradio"
              aria-checked={item.active}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className="group flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-text transition hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted transition group-hover:text-text group-focus-visible:text-text">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.active && <Icon name="check" size={14} className="shrink-0 text-accent-text" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
