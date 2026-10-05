import { Button, Icon, Text } from "@aulora/ui-web";

export function SaveRow({
  busy,
  dirty,
  saved,
  error,
}: {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly saved: boolean;
  readonly error: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
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
