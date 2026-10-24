import { Button, Icon, Text } from "@aulora/ui-web";

export interface SaveRowProps {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly saved: boolean;
  readonly error: string | null;
  /** When provided, a Discard action resets the draft to the stored values. */
  readonly onDiscard?: () => void;
  /** Keep the bar inside its column instead of bleeding to the page padding. */
  readonly inset?: boolean;
}

/**
 * The save bar for an editing page. It only appears while there is something to
 * report — unsaved edits, a save in flight, or the result of one — and sticks to
 * the bottom of the content column so the action stays in reach.
 */
export function SaveRow({ busy, dirty, saved, error, onDiscard, inset = false }: SaveRowProps) {
  if (!dirty && !busy && !saved && error === null) {
    return null;
  }
  return (
    <div
      className={
        inset
          ? "sticky bottom-0 z-[1] flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5"
          : "sticky bottom-0 z-[1] -mx-8 flex flex-wrap items-center gap-3 border-t border-border bg-surface-1/95 px-8 py-3 backdrop-blur-sm"
      }
    >
      {onDiscard !== undefined && (
        <Button type="button" variant="ghost" disabled={busy} onClick={onDiscard}>
          Discard
        </Button>
      )}
      <Button type="submit" loading={busy} disabled={busy || !dirty}>
        Save changes
      </Button>
      {saved && (
        <span
          className="flex animate-fade-in items-center gap-1 text-[12px] font-medium text-secondary"
          role="status"
        >
          <Icon name="check" size={13} />
          Saved
        </span>
      )}
      {!saved && dirty && !busy && (
        <Text size="xs" tone="muted">
          Unsaved changes
        </Text>
      )}
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
}
