import { cn, Logo } from "@aulora/ui-web";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface AuthFrameProps {
  readonly children: ReactNode;
}

/**
 * The frame for pre-session screens (connect, sign in, invites): one centred
 * column over a plain canvas with a faint accent wash at the top, and a quiet
 * footer.
 */
export function AuthFrame({ children }: AuthFrameProps) {
  return (
    <div className="pane bg-bg relative flex flex-1 flex-col items-center overflow-y-auto overflow-x-hidden px-5 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_srgb,var(--aulora-accent)_7%,transparent),transparent)]"
      />
      <div className="relative my-auto flex w-full max-w-[400px] animate-pop-in flex-col gap-7">
        {children}
        <p className="flex items-center justify-center gap-1.5 text-xs text-text-muted">
          <Logo size={14} />
          aulora · team chat on your own server
        </p>
      </div>
    </div>
  );
}

export interface AuthHeaderProps {
  /** The mark above the title: the Aulora logo or a server's avatar. */
  readonly mark: ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  /** A small monospaced line under the subtitle, e.g. the server host. */
  readonly caption?: string;
}

/** The centred mark, title and supporting copy above an {@link AuthCard}. */
export function AuthHeader({ mark, title, subtitle, caption }: AuthHeaderProps) {
  return (
    <header className="flex flex-col items-center gap-4 text-center">
      <div
        aria-hidden="true"
        className="grid h-16 w-16 place-items-center overflow-hidden rounded-[18px] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_8px_24px_-10px_rgba(0,0,0,0.35)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_24px_-10px_rgba(0,0,0,0.8)]"
      >
        {mark}
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <h1 className="text-balance text-[26px] font-semibold leading-tight tracking-tight text-text">
          {title}
        </h1>
        {subtitle !== undefined && subtitle.length > 0 && (
          <p className="text-balance text-[14.5px] leading-normal text-text-muted">{subtitle}</p>
        )}
        {caption !== undefined && (
          <p className="max-w-full truncate rounded-full bg-surface-3 px-2.5 py-0.5 font-mono text-xs text-text-muted">
            {caption}
          </p>
        )}
      </div>
    </header>
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
        "flex flex-col gap-4 rounded-[14px] border border-border bg-surface-2 p-5",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-18px_rgba(0,0,0,0.22)]",
        "dark:shadow-[0_1px_2px_rgba(0,0,0,0.5),0_14px_34px_-20px_rgba(0,0,0,0.85)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A hairline rule with a centred label, used between sign-in methods. */
export function AuthDivider({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-text-muted" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** The quiet text link under a card ("Use a different server"). */
export function AuthLink({
  children,
  ...rest
}: { readonly children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="mx-auto -mt-2 rounded-[8px] px-2 py-1 text-[13px] font-medium text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}
