import { cn, Logo, Spinner } from "@aulora/ui-web";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from "react";
import { BlobBackdrop } from "./BlobBackdrop";

export interface AuthFrameProps {
  readonly children: ReactNode;
  /**
   * Workspace icon seed: renders the saturated blobatar-palette field behind
   * the content. Omitted screens fall back to a quiet accent wash.
   */
  readonly seed?: string;
  /**
   * When set, the screen is a split layout: this content sits on the workspace's
   * colour field in a full-height panel, and `children` is the form column on
   * the plain page. Without it the legacy single centred column is used.
   */
  readonly stage?: ReactNode;
}

const SPLIT_STYLE: CSSProperties = {
  minHeight: "calc(100dvh - var(--titlebar-height, 0px))",
};

const FRAME_STYLE: CSSProperties = {
  minHeight: "calc(100dvh - var(--titlebar-height, 0px))",
  paddingTop: "calc(var(--titlebar-height, 0px) + 1.5rem)",
};

/**
 * The frame for pre-session screens (connect, sign in, invites): one centred
 * column over the workspace's own colour field, with a quiet footer. The column
 * is deliberately narrow — a pre-session screen has exactly one job.
 */
export function AuthFrame({ children, seed, stage }: AuthFrameProps) {
  if (stage !== undefined) {
    return (
      <SplitFrame seed={seed} stage={stage}>
        {children}
      </SplitFrame>
    );
  }
  return (
    <div
      className="pane bg-bg relative flex flex-1 flex-col items-center overflow-y-auto overflow-x-hidden px-5 pb-6"
      style={FRAME_STYLE}
    >
      {seed !== undefined ? (
        <BlobBackdrop seed={seed} />
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_srgb,var(--aulora-accent)_8%,transparent),transparent)]"
        />
      )}
      <div className="relative my-auto flex w-full max-w-[420px] animate-pop-in flex-col gap-5">
        {children}
        <p className="flex items-center justify-center gap-1.5 text-xs text-text-muted">
          <Logo size={14} />
          aulora · team chat on your own server
        </p>
      </div>
    </div>
  );
}

function AuthFooter() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-text-muted">
      <Logo size={14} />
      aulora · team chat on your own server
    </p>
  );
}

interface SplitFrameProps {
  readonly children: ReactNode;
  readonly seed: string | undefined;
  readonly stage: ReactNode;
}

/**
 * The split layout: the workspace's colour field and blobatar fill an inset,
 * rounded panel on one side, and the form sits directly on the page on the
 * other, with no card around it. On a phone the panel collapses to a short band
 * above the form.
 */
function SplitFrame({ children, seed, stage }: SplitFrameProps) {
  return (
    <div
      className="pane bg-bg relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden lg:flex-row"
      style={SPLIT_STYLE}
    >
      <aside className="relative isolate m-3 flex min-h-[220px] shrink-0 overflow-hidden rounded-[28px] ring-1 ring-inset ring-black/[0.05] dark:ring-white/[0.07] lg:m-4 lg:min-h-0 lg:w-[48%] lg:max-w-[780px]">
        {seed !== undefined && <BlobBackdrop seed={seed} vignette={false} />}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-1/2 bg-gradient-to-t from-bg/55 to-transparent lg:block"
        />
        <div className="relative flex w-full flex-col p-6 lg:p-10">{stage}</div>
      </aside>
      <main className="flex flex-1 flex-col justify-center px-6 py-8 lg:px-16 lg:py-12">
        <div className="mx-auto flex w-full max-w-[380px] animate-pop-in flex-col gap-8">
          {children}
          <AuthFooter />
        </div>
      </main>
    </div>
  );
}

export interface AuthStageProps {
  /** The hero blobatar, centred in the panel. */
  readonly hero: ReactNode;
  /** Large display line at the bottom of the panel (desktop only). */
  readonly headline: string;
  /** A small monospaced line under the headline, e.g. the server host. */
  readonly caption?: string;
}

/** The content of the colour panel: wordmark, hero, then one confident line. */
export function AuthStage({ hero, headline, caption }: AuthStageProps) {
  return (
    <div className="flex w-full flex-1 flex-col justify-between gap-6">
      <p className="hidden items-center gap-2 text-[13px] font-semibold tracking-[-0.01em] text-text lg:flex">
        <Logo size={18} />
        Aulora
      </p>
      <div className="grid flex-1 place-items-center">{hero}</div>
      <div className="hidden flex-col gap-3 lg:flex">
        <p className="max-w-[13ch] text-balance text-[clamp(2.25rem,3.6vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-text">
          {headline}
        </p>
        {caption !== undefined && (
          <p className="w-fit max-w-full truncate rounded-full bg-bg/50 px-2.5 py-0.5 font-mono text-xs text-text-muted backdrop-blur-sm">
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}

export interface AuthHeadingProps {
  readonly title: string;
  readonly subtitle?: string;
}

/** The title and supporting line at the top of the form column. */
export function AuthHeading({ title, subtitle }: AuthHeadingProps) {
  return (
    <header className="flex flex-col gap-2.5">
      <h1 className="text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-text">
        {title}
      </h1>
      {subtitle !== undefined && subtitle.length > 0 && (
        <p className="text-[15px] leading-relaxed text-text-muted">{subtitle}</p>
      )}
    </header>
  );
}

export interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly label: string;
  readonly error?: string;
  /** Decorative element before the text, e.g. an icon. */
  readonly leading?: ReactNode;
  /** Control after the text, e.g. a show-password button. */
  readonly trailing?: ReactNode;
}

/**
 * A field with no box: a small caps label, large text, and a single rule
 * underneath that turns to the accent on focus. It reads as part of the page
 * rather than a form widget dropped onto it.
 */
export function AuthField(props: AuthFieldProps) {
  const { label, error, leading, trailing, className, id, ...rest } = props;
  const generated = useId();
  const inputId = id ?? generated;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-text-muted"
      >
        {label}
      </label>
      <div
        className={cn(
          "flex items-center gap-2.5 border-b-2 transition-colors",
          error === undefined
            ? "border-border focus-within:border-accent hover:border-text-muted/60"
            : "border-danger",
        )}
      >
        {leading !== undefined && <span className="text-text-muted">{leading}</span>}
        <input
          id={inputId}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={error !== undefined ? errorId : undefined}
          className={cn(
            "h-12 min-w-0 flex-1 bg-transparent text-[19px] tracking-[-0.01em] text-text placeholder:text-text-muted/55 focus:outline-none",
            className,
          )}
          {...rest}
        />
        {trailing}
      </div>
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface AuthHeaderProps {
  /** The mark above the title: the hero blobatar, or the Aulora logo. */
  readonly mark: ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  /** A small monospaced line under the subtitle, e.g. the server host. */
  readonly caption?: string;
}

/** The centred mark, title and supporting copy above an {@link AuthCard}. */
export function AuthHeader({ mark, title, subtitle, caption }: AuthHeaderProps) {
  return (
    <header className="flex flex-col items-center gap-5 text-center">
      {mark}
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-balance text-[27px] font-semibold leading-[1.15] tracking-[-0.02em] text-text">
          {title}
        </h1>
        {subtitle !== undefined && subtitle.length > 0 && (
          <p className="max-w-[36ch] text-balance text-[14.5px] leading-relaxed text-text-muted">
            {subtitle}
          </p>
        )}
        {caption !== undefined && (
          <p className="max-w-full truncate rounded-full bg-surface-3/70 px-2.5 py-0.5 font-mono text-xs text-text-muted backdrop-blur-sm">
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

/**
 * The translucent surface inside {@link AuthFrame}. Layered and hairlined: a
 * blurred plate, a 1px inner highlight so the edge catches light, and a shadow
 * that is soft and far rather than hard and close.
 */
export function AuthCard({ children, className }: AuthCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-[22px] border border-border/80 bg-surface-2/75 p-5 backdrop-blur-2xl",
        "ring-1 ring-inset ring-black/[0.04] dark:ring-white/[0.06]",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_22px_60px_-28px_rgba(0,0,0,0.35)]",
        "dark:shadow-[0_1px_2px_rgba(0,0,0,0.5),0_26px_64px_-30px_rgba(0,0,0,0.95)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A hairline rule with a label, used between sign-in methods. */
export function AuthDivider({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-text-muted">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span>{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/** The quiet text link under a form ("Use a different workspace"). */
export function AuthLink({
  children,
  centered = false,
  className,
  ...rest
}: {
  readonly children: ReactNode;
  /** Centres the link, for the legacy single-column frame. */
  readonly centered?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "w-fit rounded-[10px] text-[13px] font-medium text-text-muted underline decoration-border underline-offset-4 transition hover:text-text hover:decoration-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50",
        centered && "mx-auto -mt-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Shows the particle spinner and blocks interaction. */
  readonly loading?: boolean;
  readonly leading?: ReactNode;
}

/**
 * The single primary action of a pre-session screen. Bigger than the in-app
 * button and fully rounded, because it is the only target on the page.
 *
 * Its disabled state is deliberately *not* the app's flat grey: the point of
 * the state is "almost ready", so it keeps the Ember hue at a tint and gains a
 * hairline ring. It stays unmistakably clearer than the enabled state, which is
 * solid accent with a lit shadow. Busy is a third state and the brightest of the
 * two inactive ones, because "Checking…" is a word someone is reading.
 */
const READY_CLASSES =
  "bg-accent text-on-accent shadow-[0_12px_28px_-12px_color-mix(in_srgb,var(--aulora-accent)_75%,transparent)] hover:brightness-110 active:brightness-95";
const BUSY_CLASSES = "pointer-events-none bg-accent/25 text-text ring-1 ring-inset ring-accent/35";
const WAITING_CLASSES =
  "cursor-not-allowed bg-accent/[0.14] text-accent ring-1 ring-inset ring-accent/25";

function stateClasses(loading: boolean, disabled: boolean): string {
  if (loading) {
    return BUSY_CLASSES;
  }
  return disabled ? WAITING_CLASSES : READY_CLASSES;
}

export function AuthButton(props: AuthButtonProps) {
  const {
    loading = false,
    leading,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  } = props;
  const isDisabled = disabled === true || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex h-12 w-full select-none items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        stateClasses(loading, disabled === true),
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span aria-hidden="true">
          <Spinner size={18} label="Loading" />
        </span>
      ) : (
        leading
      )}
      {children}
    </button>
  );
}
