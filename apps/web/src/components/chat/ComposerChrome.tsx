import { MESSAGE_MAX_LENGTH } from "@aulora/core";
import { CapText, cn, Icon } from "@aulora/ui-web";

export interface ComposerNoticeProps {
  /** Hint to show above the composer; `null` or empty renders nothing. */
  readonly text: string | null;
}

/**
 * The mention-scope hint above the composer. It floats over the end of the
 * message list instead of taking a row in the composer: an empty hint used to
 * reserve 48px, and a hint appearing pushed every message up. The element is
 * mounted only while there is something to say, so an empty composer keeps no
 * reserved space at all.
 */
export function ComposerNotice({ text }: ComposerNoticeProps) {
  if (text === null || text.length === 0) {
    return null;
  }
  return (
    <p
      role="status"
      data-testid="composer-notice"
      className="pointer-events-none absolute inset-x-4 bottom-full z-10 mb-1 max-h-12 overflow-y-auto rounded-[6px] bg-surface-2 px-2 py-1 text-xs leading-4 text-text-muted ring-1 ring-border sm:inset-x-6"
    >
      {text}
    </p>
  );
}

export interface ComposerAttachmentProps {
  readonly name: string;
  readonly image: boolean;
  readonly onRemove: () => void;
}

/**
 * One attached file. The label is cap-trimmed like every other chip, and the
 * row keeps its 26px height explicitly so trimming does not shrink the pill.
 */
export function ComposerAttachment({ name, image, onRemove }: ComposerAttachmentProps) {
  return (
    <li className="flex h-[26px] items-center gap-2 rounded-[7px] border border-border bg-surface-3 pl-2 pr-1 text-xs text-text">
      <Icon name={image ? "image" : "file"} size={14} className="shrink-0 text-accent-text" />
      <span className="max-w-[12rem] min-w-0 truncate">
        <CapText>{name}</CapText>
      </span>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-text"
        onClick={onRemove}
      >
        <Icon name="x" size={12} />
      </button>
    </li>
  );
}

/** The live character count in the composer toolbar; quiet until it matters. */
export function ComposerCounter({ value }: { readonly value: string }) {
  const length = value.trim().length;
  const over = length >= MESSAGE_MAX_LENGTH;
  const shown = length >= MESSAGE_MAX_LENGTH * 0.9;
  return (
    <span
      data-testid="composer-counter"
      className={cn(
        "ml-auto h-4 min-w-[4.5rem] shrink-0 pr-1 text-right text-[11px] leading-4 tabular-nums",
        over ? "text-danger-text" : "text-text-muted",
      )}
    >
      {shown ? <CapText>{`${length}/${MESSAGE_MAX_LENGTH}`}</CapText> : null}
    </span>
  );
}
