import { cn, Text } from "@aulora/ui-web";

/**
 * The update download progress bar, shared by the client update banner and the
 * settings view. It lives alone so the banner (always mounted on desktop) does
 * not pull the whole settings surface into the entry chunk.
 */
export function UpdateProgress(props: {
  readonly percent: number | null;
  readonly text: string | null;
}) {
  const { percent, text } = props;
  return (
    <div className="flex items-center gap-2.5" data-testid="update-progress">
      <div
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label="Update download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div
          className={cn(
            "h-full rounded-full bg-accent transition-[width] duration-300",
            percent === null && "w-1/3 animate-pulse",
          )}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {text !== null && (
        <Text size="xs" tone="muted" className="tabular-nums">
          {text}
        </Text>
      )}
    </div>
  );
}
