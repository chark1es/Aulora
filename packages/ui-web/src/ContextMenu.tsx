import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "./cn";

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  /** Rendered before the label, e.g. an `Icon`. */
  readonly icon?: ReactNode;
  readonly onSelect: () => void;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  /** Draws a hairline above this item, grouping it apart. */
  readonly separatorBefore?: boolean;
  /** Optional shortcut hint shown on the right. */
  readonly shortcut?: string;
}

interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
  readonly label: string;
}

const ContextMenuContext = createContext<((event: ContextMenuEvent) => void) | null>(null);

export interface ContextMenuEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly items: readonly ContextMenuItem[];
  readonly label: string;
}

/**
 * One provider at the app root owns the single open context menu, so menus
 * never nest and a click anywhere dismisses. Attach a handler with
 * {@link useContextMenu}.
 */
export function ContextMenuProvider({ children }: { readonly children: ReactNode }) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const open = useCallback((event: ContextMenuEvent) => {
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: event.items,
      label: event.label,
    });
  }, []);

  useEffect(() => {
    if (menu === null) {
      return;
    }
    const close = () => {
      setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  return (
    <ContextMenuContext.Provider value={open}>
      {children}
      {menu !== null && (
        <ContextMenu
          state={menu}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </ContextMenuContext.Provider>
  );
}

/** Opens a context menu at the pointer. No-op when no provider is mounted. */
export function useContextMenu(): (event: ContextMenuEvent) => void {
  const open = useContext(ContextMenuContext);
  return open ?? (() => undefined);
}

function ContextMenu({
  state,
  onClose,
}: {
  readonly state: ContextMenuState;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x: state.x, y: state.y });

  // Keep the whole menu on screen, flipping near an edge.
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    const rect = node.getBoundingClientRect();
    const margin = 8;
    let x = state.x;
    let y = state.y;
    if (x + rect.width + margin > window.innerWidth) {
      x = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (y + rect.height + margin > window.innerHeight) {
      y = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPosition({ x, y });
  }, [state.x, state.y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={state.label}
      style={{ left: position.x, top: position.y }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      className="fixed z-[60] min-w-[196px] animate-pop-in rounded-[10px] border border-border bg-surface-2 p-1 shadow-2xl shadow-black/30"
    >
      {state.items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore === true && <div className="my-1 h-px bg-border" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled === true}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] transition disabled:pointer-events-none disabled:opacity-40",
              item.danger === true
                ? "text-danger hover:bg-danger/10"
                : "text-text hover:bg-surface-3",
            )}
          >
            {item.icon !== undefined && (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">
                {item.icon}
              </span>
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut !== undefined && (
              <span className="shrink-0 font-mono text-[10px] text-text-muted">
                {item.shortcut}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
