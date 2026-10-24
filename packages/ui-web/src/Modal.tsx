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
import { ModalShell } from "./ModalShell";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Accessible dialog name; rendered as the visible title unless `title` is set. */
  readonly label: string;
  readonly title?: string;
  readonly description?: string;
  /** Leading element beside the title. A bare {@link Icon} is tinted by `tone`. */
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  /** Footer actions, usually buttons. */
  readonly footer?: ReactNode;
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
  /** `danger` tints an icon tile and is used by destructive confirms. */
  readonly tone?: "default" | "danger";
  /** Hides the corner close button, for a fully custom action row. */
  readonly hideClose?: boolean;
  /** Hides the title block, for sheet-style dialogs such as an incoming call. */
  readonly hideHeader?: boolean;
  /** Where focus lands on open. `panel` avoids arming a destructive first button. */
  readonly initialFocus?: "first" | "panel";
}

const FOCUSABLE_SELECTOR =
  "input,textarea,select,button:not([disabled]),[tabindex]:not([tabindex='-1'])";

/** Text entry wins initial focus, so a form dialog can be typed into at once. */
const TEXT_FIELD_SELECTOR =
  "[data-autofocus],input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([disabled]),textarea:not([disabled])";

/**
 * Where focus lands when a dialog opens: an explicit `data-autofocus` element,
 * else the first text field, else the first control that is not the corner
 * close button (usually Cancel, never an armed destructive action), else the
 * panel itself.
 */
function initialFocusTarget(panel: HTMLElement): HTMLElement {
  const field = panel.querySelector<HTMLElement>(TEXT_FIELD_SELECTOR);
  if (field !== null) {
    return field;
  }
  const control = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].find(
    (node) => node.dataset.modalClose === undefined,
  );
  return control ?? panel;
}

/** Keeps the element mounted through the exit transition. */
function useModalPresence(open: boolean, reducedMotion: boolean) {
  const [rendered, setRendered] = useState(open);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      if (reducedMotion) {
        setEntered(true);
        return undefined;
      }
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
      return undefined;
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
function useModalFocusTrap(
  open: boolean,
  panelRef: RefObject<HTMLDivElement | null>,
  initialFocus: "first" | "panel",
) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      (initialFocus === "panel" ? panel : initialFocusTarget(panel)).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [open, panelRef, initialFocus]);
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

/**
 * A focused dialog. Opens with a scale-and-fade on desktop and rises as a
 * bottom sheet on phones; traps focus, closes on Escape or a backdrop press,
 * and restores focus to the trigger. Uses `role="dialog"` + `aria-modal` so it
 * behaves the same in the web and Tauri builds.
 */
export function Modal(props: ModalProps) {
  const { open, onClose, initialFocus = "first" } = props;
  const reducedMotion = usePrefersReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { rendered, entered } = useModalPresence(open, reducedMotion);
  useModalFocusTrap(open, panelRef, initialFocus);
  const onKeyDown = useModalKeyDown(onClose, panelRef);

  if (!rendered) {
    return null;
  }

  return (
    <ModalShell
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
  error,
  children,
  className,
  ...rest
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...rest}>
      <span className="text-[12.5px] font-medium text-text">{label}</span>
      {children}
      {hint !== undefined && <span className="text-[12px] text-text-muted">{hint}</span>}
      {error !== undefined && (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * The footer of a {@link Modal}: a destructive secondary action sits on the
 * far left, while the cancel and primary action stay right-aligned in the
 * order they are passed.
 */
export function ModalFooter({
  destructive,
  children,
}: {
  readonly destructive?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <>
      {destructive !== undefined && (
        <span className="mr-auto flex items-center gap-2">{destructive}</span>
      )}
      {children}
    </>
  );
}
