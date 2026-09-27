import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Accessible dialog name; rendered as the visible title unless `title` is set. */
  readonly label: string;
  readonly title?: string;
  readonly description?: string;
  /** Leading element beside the title, e.g. a channel-kind glyph. */
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  /** Footer actions, usually buttons. */
  readonly footer?: ReactNode;
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

const SIZE: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-[380px]",
  md: "max-w-[480px]",
  lg: "max-w-[620px]",
};

/**
 * A focused, centered dialog. Opens with a subtle scale-and-fade, traps the
 * initial focus, closes on Escape or a backdrop press, and restores focus to
 * the trigger. Uses the native `dialog`-style semantics (`role="dialog"` +
 * `aria-modal`) so it is identical in the web and Tauri builds.
 */
export function Modal({
  open,
  onClose,
  label,
  title,
  description,
  icon,
  children,
  footer,
  size = "md",
  className,
}: ModalProps) {
  const reducedMotion = usePrefersReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(open);
  const [entered, setEntered] = useState(false);

  // Keep the element mounted through the exit transition.
  useEffect(() => {
    if (open) {
      setRendered(true);
      const frame = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(frame);
    }
    setEntered(false);
    if (reducedMotion) {
      setRendered(false);
      return;
    }
    const timer = setTimeout(() => setRendered(false), 160);
    return () => clearTimeout(timer);
  }, [open, reducedMotion]);

  // Move focus into the dialog when it opens, and restore it on close.
  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const focusable = panel.querySelector<HTMLElement>(
        "input,textarea,select,button:not([disabled]),[tabindex]:not([tabindex='-1'])",
      );
      (focusable ?? panel).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previous?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          "input,textarea,select,button:not([disabled]),[tabindex]:not([tabindex='-1'])",
        ),
      ].filter((node) => node.offsetParent !== null || node === document.activeElement);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!rendered) {
    return null;
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop press dismisses the dialog
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape and Tab are handled on the panel
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-[2px]",
        "transition-opacity duration-150",
        entered ? "opacity-100" : "opacity-0",
      )}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title === undefined ? label : undefined}
        aria-labelledby={title !== undefined ? titleId : undefined}
        aria-describedby={description !== undefined ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          "w-full overflow-hidden rounded-[14px] border border-border bg-surface-2 shadow-2xl shadow-black/30",
          "transition-all duration-150 ease-out focus:outline-none",
          entered ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0",
          SIZE[size],
          className,
        )}
      >
        <header className="flex items-start gap-3 px-5 pb-1 pt-5">
          {icon !== undefined && <span className="mt-0.5 shrink-0">{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.01em] text-text">
              {title ?? label}
            </h2>
            {description !== undefined && (
              <p id={descriptionId} className="mt-0.5 text-[13px] leading-snug text-text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-text-muted transition hover:bg-surface-3 hover:text-text"
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="px-5 pb-1 pt-2">{children}</div>

        {footer !== undefined && (
          <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-1/60 px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** A labelled field wrapper used by modal and settings forms. */
export function Field({
  label,
  hint,
  children,
  className,
  ...rest
}: { label: string; hint?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...rest}>
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      {children}
      {hint !== undefined && <span className="text-[11px] text-text-muted">{hint}</span>}
    </div>
  );
}
