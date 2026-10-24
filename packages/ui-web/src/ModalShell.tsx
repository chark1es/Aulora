/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { isValidElement, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";
import type { ModalProps } from "./Modal";

const SIZE = new Map<NonNullable<ModalProps["size"]>, string>([
  ["sm", "sm:max-w-[400px] sm:rounded-[16px]"],
  ["md", "sm:max-w-[520px] sm:rounded-[16px]"],
  ["lg", "sm:max-w-[720px] sm:rounded-[18px]"],
]);

/**
 * One elevation for every dialog: a hairline drawn inside the shadow stack, a
 * tight contact shadow and a wide ambient shadow. No separate border class.
 */
export const MODAL_SHADOW =
  "shadow-[0_0_0_1px_color-mix(in_srgb,var(--aulora-text)_8%,transparent),0_2px_6px_-2px_rgba(0,0,0,0.18),0_28px_70px_-20px_rgba(0,0,0,0.5)]";

/** True while the scroll body has more content than it can show. */
function useBodyOverflow(scrollRef: RefObject<HTMLDivElement | null>) {
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) {
      return undefined;
    }
    const update = () => {
      setOverflowing(node.scrollHeight > node.clientHeight + 1);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(node);
    if (node.firstElementChild !== null) {
      observer?.observe(node.firstElementChild);
    }
    node.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      node.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [scrollRef]);

  return overflowing;
}

/** A bare icon gets the shared 36px tile; pre-styled nodes pass through. */
function ModalIcon({
  icon,
  tone,
}: {
  readonly icon: ReactNode;
  readonly tone: NonNullable<ModalProps["tone"]>;
}) {
  if (isValidElement(icon) && icon.type === Icon) {
    return (
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
          tone === "danger" ? "bg-danger/[0.12] text-danger" : "bg-accent/[0.12] text-accent",
        )}
      >
        {icon}
      </span>
    );
  }
  return <span className="shrink-0">{icon}</span>;
}

interface ModalHeaderProps {
  readonly label: string;
  readonly title?: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly tone: NonNullable<ModalProps["tone"]>;
  readonly hideClose: boolean;
  readonly titleId: string;
  readonly descriptionId: string;
  readonly onClose: () => void;
}

function ModalHeader(props: ModalHeaderProps) {
  const { label, title, description, icon, tone, hideClose, titleId, descriptionId, onClose } =
    props;
  // A lone title centers on the 36px icon tile; with a description the pair hangs from its top.
  const tiled = icon !== undefined;
  const centered = tiled && description === undefined;
  return (
    <header className="flex shrink-0 items-start gap-3 px-6 pb-4 pt-6">
      {tiled && <ModalIcon icon={icon} tone={tone} />}
      <div className="min-w-0 flex-1">
        <h2
          id={titleId}
          className={cn(
            "text-[17px] font-semibold leading-6 tracking-[-0.015em] text-text",
            centered && "flex min-h-9 items-center",
          )}
        >
          {title ?? label}
        </h2>
        {description !== undefined && (
          <p id={descriptionId} className="mt-1 text-[13.5px] leading-relaxed text-text-muted">
            {description}
          </p>
        )}
      </div>
      {!hideClose && (
        <button
          type="button"
          aria-label="Close"
          data-modal-close=""
          onClick={onClose}
          className={cn(
            "-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-surface-3/80",
            centered ? "mt-1" : "-mt-0.5",
          )}
        >
          <Icon name="x" size={16} />
        </button>
      )}
    </header>
  );
}

function ModalBody({
  scrollRef,
  hideHeader,
  hasFooter,
  children,
}: {
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly hideHeader: boolean;
  readonly hasFooter: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      ref={scrollRef}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-6",
        hideHeader ? "pt-6" : "pt-0",
        hasFooter ? "pb-5" : "pb-6",
      )}
    >
      {children}
    </div>
  );
}

function ModalActions({
  overflowing,
  children,
}: {
  readonly overflowing: boolean;
  readonly children: ReactNode;
}) {
  return (
    <footer
      className={cn(
        "flex shrink-0 items-center justify-end gap-2 px-6 pb-6 pt-4",
        "max-sm:[&>button]:flex-1",
        overflowing && "border-t border-border/60",
      )}
    >
      {children}
    </footer>
  );
}

export interface ModalPanelProps extends ModalProps {
  readonly entered: boolean;
  readonly titleId: string;
  readonly descriptionId: string;
  readonly panelRef: RefObject<HTMLDivElement | null>;
  readonly onKeyDown: (event: React.KeyboardEvent) => void;
}

function panelClasses(props: ModalPanelProps) {
  return cn(
    "relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface-2 focus:outline-none sm:max-h-[min(85dvh,720px)]",
    "rounded-t-[20px] pb-[env(safe-area-inset-bottom)] sm:rounded-[16px] sm:pb-0",
    MODAL_SHADOW,
    "transition-[opacity,transform] motion-reduce:transition-none",
    props.entered
      ? "translate-y-0 scale-100 opacity-100 duration-200 ease-[cubic-bezier(.2,.9,.3,1)]"
      : "translate-y-full opacity-0 duration-[140ms] ease-in sm:translate-y-2 sm:scale-[0.96]",
    SIZE.get(props.size ?? "md"),
    props.className,
  );
}

function ModalPanel(props: ModalPanelProps) {
  const { label, title, description, hideHeader, footer, children } = props;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const overflowing = useBodyOverflow(bodyRef);
  const named = hideHeader !== true && title !== undefined;
  return (
    <div
      ref={props.panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={named ? undefined : label}
      aria-labelledby={named ? props.titleId : undefined}
      aria-describedby={
        hideHeader === true || description === undefined ? undefined : props.descriptionId
      }
      tabIndex={-1}
      onKeyDown={props.onKeyDown}
      className={panelClasses(props)}
    >
      <span
        aria-hidden="true"
        className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-text/15 sm:hidden"
      />
      {hideHeader !== true && (
        <ModalHeader
          label={label}
          {...(title !== undefined ? { title } : {})}
          {...(description !== undefined ? { description } : {})}
          {...(props.icon !== undefined ? { icon: props.icon } : {})}
          tone={props.tone ?? "default"}
          hideClose={props.hideClose === true}
          titleId={props.titleId}
          descriptionId={props.descriptionId}
          onClose={props.onClose}
        />
      )}
      {children !== null && children !== undefined && (
        <ModalBody
          scrollRef={bodyRef}
          hideHeader={hideHeader === true}
          hasFooter={footer !== undefined}
        >
          {children}
        </ModalBody>
      )}
      {footer !== undefined && <ModalActions overflowing={overflowing}>{footer}</ModalActions>}
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
        "fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:px-4",
        "bg-black/25 backdrop-blur-[3px] dark:bg-black/45",
        "transition-opacity duration-[160ms] motion-reduce:transition-none",
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

export function ModalShell(props: ModalPanelProps) {
  return <ModalSurface {...props} />;
}
