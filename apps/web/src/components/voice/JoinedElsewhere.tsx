import { Button, EmptyState, Icon } from "@aulora/ui-web";

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
    <div className="pane flex min-h-0 flex-1 flex-col bg-surface-1">
      <EmptyState
        align="center"
        icon="monitor"
        title={title}
        description="You joined this voice channel from another device. This one stays out of the call."
        className="px-8 py-10"
        action={
          canConnect ? (
            <Button
              type="button"
              size="lg"
              variant="success"
              disabled={pending}
              leading={<Icon name="phone" size={17} />}
              onClick={onJoin}
            >
              Join here
            </Button>
          ) : (
            <p className="text-[13px] text-text-muted">
              You do not have permission to move the call to this device.
            </p>
          )
        }
      />
    </div>
  );
}
