import { Button, Icon } from "@aulora/ui-web";

/**
 * Shown in a voice channel when this user is connected from a different
 * device. The live grid stays on that device; this one only offers to move
 * the call over.
 */
export function JoinedElsewhere({
  title,
  pending,
  canConnect,
  onJoin,
}: {
  readonly title: string;
  readonly pending: boolean;
  readonly canConnect: boolean;
  readonly onJoin: () => void;
}) {
  return (
    <div className="pane flex min-h-0 flex-1 flex-col items-center justify-center bg-surface-1 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-[16px] bg-accent-soft text-accent">
        <Icon name="monitor" size={30} />
      </span>
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-text">{title}</h2>
      <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-text-muted">
        You joined this voice channel from another device. This one stays out of the call.
      </p>
      {canConnect ? (
        <Button
          type="button"
          size="lg"
          variant="success"
          className="mt-6"
          disabled={pending}
          leading={<Icon name="phone" size={17} />}
          onClick={onJoin}
        >
          Join here
        </Button>
      ) : (
        <p className="mt-6 text-[13px] text-text-muted">
          You do not have permission to move the call to this device.
        </p>
      )}
    </div>
  );
}
