/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, ConfirmDialog } from "@aulora/ui-web";
import { useState } from "react";

export interface ConnectionRecoveryActionsProps {
  /** Named in the removal confirmation; omit when the name is unknown. */
  readonly serverName?: string;
  /** Only saved servers can be removed; absent profiles hide the action. */
  readonly canRemoveServer?: boolean;
  readonly onRetry: () => void;
  readonly onSwitchServer: () => void;
  readonly onRemoveServer?: () => void;
}

/**
 * The recovery row shown when a server-dependent wait runs too long: retry the
 * connection, remove the saved server, or switch to a different one. Removal
 * confirms first; the caller decides what removal does.
 */
export function ConnectionRecoveryActions(props: ConnectionRecoveryActionsProps) {
  const { serverName, canRemoveServer = false, onRetry, onSwitchServer, onRemoveServer } = props;
  const [confirming, setConfirming] = useState(false);
  const canRemove = canRemoveServer && onRemoveServer !== undefined;

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="md" onClick={onRetry}>
          Try again
        </Button>
        <Button size="md" variant="ghost" onClick={onSwitchServer}>
          Use a different server
        </Button>
        {canRemove && (
          <Button
            size="md"
            variant="ghost"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Remove this server
          </Button>
        )}
      </div>
      {canRemove && (
        <RemoveConfirmation
          serverName={serverName}
          open={confirming}
          onClose={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            setConfirming(false);
            // `canRemove` narrows onRemoveServer to defined at the JSX site.
            onRemoveServer();
          }}
        />
      )}
    </>
  );
}

function RemoveConfirmation({
  serverName,
  open,
  onClose,
  onConfirm,
}: {
  readonly serverName?: string | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Remove this server?"
      description={
        serverName !== undefined
          ? `Aulora will forget ${serverName} on this device. You can add it again later.`
          : "Aulora will forget this server on this device. You can add it again later."
      }
      confirmLabel="Remove server"
      variant="danger"
      onConfirm={onConfirm}
    />
  );
}
