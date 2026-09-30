import { useWorkspaceUpdates } from "../../../providers/WorkspaceUpdateProvider";

export function UpdatesCard() {
  const updates = useWorkspaceUpdates();
  return (
    <div className="flex flex-col gap-6" data-testid="instance-updates">
      {updates.settings}
    </div>
  );
}
