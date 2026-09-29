import { Button, Heading, Icon, Input, Spinner, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { inviteUrl } from "../../lib/invites";

export interface InviteManagerProps {
  readonly canCreateInvites: boolean;
  readonly origin: string;
}

const PAGE = { numItems: 50, cursor: null } as const;

function expiryLabel(expiresAt: number | null): string {
  if (expiresAt === null) {
    return "Never expires";
  }
  return expiresAt <= Date.now()
    ? "Expired"
    : `Expires ${new Date(expiresAt).toLocaleDateString()}`;
}

/**
 * Invite management: create a link (optionally emailing it), copy the magic
 * link, and review or revoke outstanding invites. The plaintext code is only
 * returned once, at creation, and is shown/copied right away.
 */
export function InviteManager({ canCreateInvites, origin }: InviteManagerProps) {
  const list = useQuery(api.invites.list, canCreateInvites ? { paginationOpts: PAGE } : "skip");
  const create = useMutation(api.invites.create);
  const revoke = useMutation(api.invites.revoke);

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!canCreateInvites) {
    return (
      <Text tone="muted" size="sm" data-testid="invites-locked">
        You need the Create invites permission to manage invites.
      </Text>
    );
  }

  const link = created !== null ? inviteUrl(origin, created.code) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="invite-manager">
      <header className="flex flex-col gap-1">
        <Heading level={3}>Invites</Heading>
        <Text size="sm" tone="muted">
          Every new link lasts 7 days and can be copied or emailed.
        </Text>
      </header>

      <form
        className="flex flex-col gap-3 rounded-[12px] border border-border bg-surface-2 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setCopied(false);
          setBusy(true);
          const recipient = email.trim();
          void create({
            ...(recipient.length > 0 ? { email: recipient } : {}),
          })
            .then((result) => {
              setCreated({ code: result.code, emailed: recipient.length > 0 });
              setEmail("");
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "Could not create the invite."),
            )
            .finally(() => setBusy(false));
        }}
      >
        <Input
          label="Email (optional)"
          type="email"
          placeholder="teammate@example.com"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          hint="Leave blank to just generate a link."
        />
        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Create invite
          </Button>
        </div>

        {created !== null && link !== null && (
          <div className="flex flex-col gap-2 rounded-[10px] border border-accent/30 bg-accent-soft/40 p-3">
            <Text size="xs" tone="secondary">
              {created.emailed ? "Invite created and emailed. " : "Invite created. "}
              Copy the link now — it is only shown once.
            </Text>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[7px] border border-border bg-surface-1 px-2 py-1.5 font-mono text-[12px] text-text">
                {link}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(link)
                    .then(() => setCopied(true))
                    .catch(() => undefined);
                }}
              >
                <Icon name="file" size={14} />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}

        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}
      </form>

      {list === undefined && (
        <div className="flex justify-center py-8">
          <Spinner size={22} label="Loading invites" />
        </div>
      )}

      {list !== undefined && (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-[12px] border border-border bg-surface-2">
          {list.page.map((invite) => (
            <li key={invite.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <Text size="sm" className="truncate">
                  {invite.revokedAt !== null ? "Revoked" : expiryLabel(invite.expiresAt)}
                </Text>
                <Text size="xs" tone="muted" className="truncate">
                  {invite.uses}
                  {invite.maxUses > 0 ? ` / ${invite.maxUses}` : ""} uses
                </Text>
              </div>
              {invite.revokedAt === null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void revoke({ inviteId: invite.id })}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
          {list.page.length === 0 && (
            <li className="px-3.5 py-3">
              <Text tone="muted" size="sm">
                No invites yet.
              </Text>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
