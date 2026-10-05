import {
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
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

const SIZE = new Map<NonNullable<ModalProps["size"]>, string>([
  ["sm", "max-w-[380px]"],
  ["md", "max-w-[480px]"],
  ["lg", "max-w-[620px]"],
]);

const FOCUSABLE_SELECTOR =
  "input,textarea,select,button:not([disabled]),[tabindex]:not([tabindex='-1'])";

/** Keeps the element mounted through the exit transition. */
function useModalPresence(open: boolean, reducedMotion: boolean) {
  const [rendered, setRendered] = useState(open);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      const frame = requestAnimationFrame(() => {
        setEntered(true);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    setEntered(false);
    if (reducedMotion) {
      setRendered(false);
      return;
    }
    const timer = setTimeout(() => {
      setRendered(false);
    }, 160);
    return () => {
      clearTimeout(timer);
    };
  }, [open, reducedMotion]);

  return { rendered, entered };
}

/** Moves focus into the dialog when it opens, and restores it on close. */
function useModalFocusTrap(open: boolean, panelRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const focusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable ?? panel).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [open, panelRef]);
}

/** Escape closes; Tab cycles focus within the panel. */
function useModalKeyDown(onClose: () => void, panelRef: RefObject<HTMLDivElement | null>) {
  return useCallback(
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
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
      const first = focusable.at(0);
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
    [onClose, panelRef],
  );
}

function ModalHeader({
  label,
  title,
  description,
  icon,
  titleId,
  descriptionId,
  onClose,
}: {
  readonly label: string;
  readonly title?: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly titleId: string;
  readonly descriptionId: string;
  readonly onClose: () => void;
}) {
  return (
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
  );
}

interface ModalPanelProps extends ModalProps {
  readonly entered: boolean;
  readonly titleId: string;
  readonly descriptionId: string;
  readonly panelRef: RefObject<HTMLDivElement | null>;
  readonly onKeyDown: (event: React.KeyboardEvent) => void;
}

function ModalPanel(props: ModalPanelProps) {
  const { entered, titleId, descriptionId, panelRef, onKeyDown } = props;
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={props.title === undefined ? props.label : undefined}
      aria-labelledby={props.title !== undefined ? titleId : undefined}
      aria-describedby={props.description !== undefined ? descriptionId : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        "w-full overflow-hidden rounded-[14px] border border-border bg-surface-2 shadow-2xl shadow-black/30",
        "transition-all duration-150 ease-out focus:outline-none",
        entered ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0",
        SIZE.get(props.size ?? "md"),
        props.className,
      )}
    >
      <ModalHeader
        label={props.label}
        {...(props.title !== undefined ? { title: props.title } : {})}
        {...(props.description !== undefined ? { description: props.description } : {})}
        icon={props.icon}
        titleId={titleId}
        descriptionId={descriptionId}
        onClose={props.onClose}
      />
      <div className="px-5 pb-1 pt-2">{props.children}</div>
      {props.footer !== undefined && (
        <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-1/60 px-5 py-3.5">
          {props.footer}
        </footer>
      )}
    </div>
  );
}

function ModalSurface(props: ModalPanelProps) {
  const { entered, onClose } = props;
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
      <ModalPanel {...props} />
    </div>
  );
}

/**
 * A focused, centered dialog. Opens with a subtle scale-and-fade, traps the
 * initial focus, closes on Escape or a backdrop press, and restores focus to
 * the trigger. Uses the native `dialog`-style semantics (`role="dialog"` +
 * `aria-modal`) so it is identical in the web and Tauri builds.
 */
export function Modal(props: ModalProps) {
  const { open, onClose } = props;
  const reducedMotion = usePrefersReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { rendered, entered } = useModalPresence(open, reducedMotion);
  useModalFocusTrap(open, panelRef);
  const onKeyDown = useModalKeyDown(onClose, panelRef);

  if (!rendered) {
    return null;
  }

  return (
    <ModalSurface
      {...props}
      entered={entered}
      titleId={titleId}
      descriptionId={descriptionId}
      panelRef={panelRef}
      onKeyDown={onKeyDown}
    />
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
