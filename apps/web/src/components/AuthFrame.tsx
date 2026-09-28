import { cn, Icon, Logo } from "@aulora/ui-web";
import type { ReactNode } from "react";

export interface AuthFrameProps {
  readonly children: ReactNode;
  /**
   * `single` keeps the original one-column card width (used by the redeem
   * flow); `split` widens the frame for the two-column threshold layout.
   */
  readonly layout?: "single" | "split";
}

/**
 * The frame for pre-session screens (connect, sign in, invites): a plain canvas
 * with a quiet footer and one orchestrated entrance.
 */
export function AuthFrame({ children, layout = "single" }: AuthFrameProps) {
  return (
    <div className="pane bg-bg relative flex flex-1 flex-col items-center overflow-y-auto overflow-x-hidden px-4 py-10">
      <div
        className={cn(
          "relative my-auto flex w-full animate-pop-in flex-col gap-6",
          layout === "split" ? "max-w-[900px]" : "max-w-[420px]",
        )}
      >
        {children}
        {layout === "single" && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-text-muted">
            <Logo size={14} />
            aulora · team chat on your own server
          </p>
        )}
      </div>
    </div>
  );
}

export interface AuthCardProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/** The raised card inside {@link AuthFrame}. */
export function AuthCard({ children, className }: AuthCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5 rounded-[12px] border border-border bg-surface-2 p-6",
        "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_10px_30px_-16px_rgba(0,0,0,0.25)]",
        "dark:shadow-[0_1px_2px_rgba(0,0,0,0.5),0_12px_32px_-20px_rgba(0,0,0,0.85)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface AuthAuraProps {
  /** The keyhole at the centre: the doorway mark or a server's blobatar. */
  readonly children?: ReactNode;
  readonly className?: string;
}

/**
 * The signature threshold mark: the doorway keyhole on a plain surface.
 * Decorative — pass the keyhole as children; size it from the outside.
 */
export function AuthAura({ children, className }: AuthAuraProps) {
  return (
    <div aria-hidden="true" className={cn("relative grid place-items-center p-4", className)}>
      {children}
    </div>
  );
}

export interface AuthBrandPanelProps {
  /** The keyhole at the centre; defaults to the Aulora doorway mark. */
  readonly keyhole?: ReactNode;
  readonly className?: string;
}

/**
 * The brand column of the threshold layout: the mark, the Aulora wordmark and
 * one product-true line. On a narrow layout only the mark is shown.
 */
export function AuthBrandPanel({ keyhole, className }: AuthBrandPanelProps) {
  return (
    <div className={cn("flex flex-col items-center gap-5 text-center", className)}>
      <AuthAura className="h-32 w-32 md:h-48 md:w-48">
        {keyhole ?? <Logo size={64} className="h-16 w-16 md:h-24 md:w-24" />}
      </AuthAura>
      <div className="hidden flex-col items-center gap-1.5 md:flex">
        <span className="text-[22px] font-semibold tracking-tight text-text">Aulora</span>
        <span className="flex items-center gap-1.5 text-[13px] text-text-muted">
          <Icon name="lock" size={13} />
          Team chat that stays on your server.
        </span>
      </div>
    </div>
  );
}

export interface AuthColumnsProps {
  readonly children: ReactNode;
  /** Keyhole rendered inside the brand panel's mark. */
  readonly keyhole?: ReactNode;
}

/** Two columns on a wide layout; the mark stacks above the form on a narrow one. */
export function AuthColumns({ children, keyhole }: AuthColumnsProps) {
  return (
    <div className="grid w-full items-center gap-10 md:grid-cols-[minmax(0,44fr)_minmax(0,56fr)] md:gap-16">
      <AuthBrandPanel {...(keyhole !== undefined ? { keyhole } : {})} />
      <div className="mx-auto w-full max-w-[400px]">{children}</div>
    </div>
  );
}
