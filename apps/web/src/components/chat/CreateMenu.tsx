/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { cn, Icon, MODAL_SHADOW } from "@aulora/ui-web";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { HeaderButton } from "./ChannelSidebarChrome";

/** Moves the roving focus of the create menu by one row, wrapping at the ends. */
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

function CreateMenuItem({
  icon,
  label,
  onSelect,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="group flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-text transition hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted transition group-hover:text-text group-focus-visible:text-text">
        {icon}
      </span>
      {label}
    </button>
  );
}

function CreateMenu({
  canCreateChannel,
  canManageCategories,
  onCreateChannel,
  onCreateCategory,
  onClose,
}: {
  readonly canCreateChannel: boolean;
  readonly canManageCategories: boolean;
  readonly onCreateChannel: (kind?: "text" | "voice") => void;
  readonly onCreateCategory?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The first item takes focus so the menu is immediately keyboard-drivable.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
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
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    const focused = document.activeElement;
    const current = focused instanceof HTMLButtonElement ? items.indexOf(focused) : -1;
    const next = focusTarget(event.key, current, items.length - 1);
    items.at(next)?.focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Create"
      onKeyDown={handleKeyDown}
      className={cn(
        "absolute right-0 top-full z-20 mt-1 min-w-[200px] animate-pop-in rounded-[10px] bg-surface-2 p-1",
        MODAL_SHADOW,
      )}
    >
      {canCreateChannel && (
        <CreateMenuItem
          icon={<Icon name="hash" size={15} />}
          label="New channel"
          onSelect={() => {
            onClose();
            onCreateChannel("text");
          }}
        />
      )}
      {canCreateChannel && canManageCategories && <div className="my-1 h-px bg-border" />}
      <CreateMenuItem
        icon={<Icon name="folder-plus" size={15} />}
        label="New category"
        onSelect={() => {
          onClose();
          onCreateCategory?.();
        }}
      />
    </div>
  );
}

/**
 * The channels header "+" control: a plain button when the viewer can only
 * create channels, a small menu (channel or category) when they can do both.
 */
export function CreateMenuButton({
  canCreateChannel,
  canManageCategories,
  onCreateChannel,
  onCreateCategory,
}: {
  readonly canCreateChannel: boolean;
  readonly canManageCategories: boolean;
  readonly onCreateChannel: (kind?: "text" | "voice") => void;
  readonly onCreateCategory?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

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

  const hasExtras = canManageCategories;
  const label = canManageCategories ? "Create channel or category" : "Create channel";

  return (
    <div ref={containerRef} className="relative">
      <HeaderButton
        ref={triggerRef}
        label={label}
        small
        hasPopup="menu"
        expanded={open}
        onClick={() => {
          if (!hasExtras) {
            onCreateChannel("text");
            return;
          }
          setOpen((current) => !current);
        }}
      >
        <Icon name="plus" size={15} />
      </HeaderButton>
      {open && hasExtras && (
        <CreateMenu
          canCreateChannel={canCreateChannel}
          canManageCategories={canManageCategories}
          onCreateChannel={onCreateChannel}
          onCreateCategory={onCreateCategory}
          onClose={() => {
            close(true);
          }}
        />
      )}
    </div>
  );
}
