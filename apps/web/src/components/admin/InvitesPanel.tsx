import { Button, Heading, Input, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { inviteUrl } from "../../lib/invites";

export interface InvitesPanelProps {
  readonly canCreateInvites: boolean;
  readonly origin: string;
}

const PAGE_SIZE = 25;

/** Create, copy and revoke invite links. The plaintext code is shown once. */
export function InvitesPanel({ canCreateInvites, origin }: InvitesPanelProps) {
  const [cursor, setCursor] = useState<string | null>(null);
  const result = useQuery(
    api.invites.list,
    canCreateInvites ? { paginationOpts: { numItems: PAGE_SIZE, cursor } } : "skip",
  );
  const createInvite = useMutation(api.invites.create);
  const revokeInvite = useMutation(api.invites.revoke);

  const [maxUses, setMaxUses] = useState("0");
  const [latest, setLatest] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canCreateInvites) {
    return (
      <Text tone="muted" size="sm" data-testid="invites-locked">
        You need the Create invites permission to manage invites.
      </Text>
    );
  }

  const invites = result?.page ?? [];
  const latestUrl = latest !== null ? inviteUrl(origin, latest) : null;

  async function run(task: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="invites-panel">
      <Heading level={3}>Invites</Heading>
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      <div className="flex items-end gap-2">
        <div className="w-32">
          <Input
            label="Max uses"
            type="number"
            min={0}
            value={maxUses}
            onChange={(event) => setMaxUses(event.currentTarget.value)}
          />
        </div>
        <Button
          loading={busy}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const uses = Number.parseInt(maxUses, 10);
              const created = await createInvite({
                maxUses: Number.isFinite(uses) && uses > 0 ? uses : 0,
              });
              setLatest(created.code);
              setCopied(false);
            })
          }
        >
          Create invite
        </Button>
      </div>

      {latestUrl !== null && (
        <div className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
          <Text size="xs" tone="muted" mono>
            NEW INVITE LINK
          </Text>
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label="Invite link"
              className="h-9 flex-1 rounded-input border border-border bg-surface-3 px-2 font-mono text-xs text-text"
              value={latestUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void run(async () => {
                  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
                    await navigator.clipboard.writeText(latestUrl);
                  }
                  setCopied(true);
                })
              }
            >
              Copy
            </Button>
          </div>
          {copied && (
            <Text size="xs" tone="secondary" role="status">
              Copied to clipboard.
            </Text>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-1" data-testid="invite-list">
        {invites.map((invite) => (
          <li
            key={invite.id}
            className="flex items-center justify-between rounded-input border border-border bg-surface-2 px-3 py-2"
          >
            <div className="flex flex-col">
              <Text size="sm" mono>
                {invite.uses}/{invite.maxUses === 0 ? "∞" : invite.maxUses} uses
                {invite.revokedAt !== null ? " · revoked" : ""}
              </Text>
              <Text size="xs" tone="muted">
                created {new Date(invite.createdAt).toLocaleString()}
                {invite.expiresAt !== null
                  ? ` · expires ${new Date(invite.expiresAt).toLocaleString()}`
                  : ""}
              </Text>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || invite.revokedAt !== null}
              onClick={() => void run(() => revokeInvite({ inviteId: invite.id as never }))}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>

      {result !== undefined && !result.isDone && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setCursor(result.continueCursor)}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
