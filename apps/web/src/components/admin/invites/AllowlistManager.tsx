import { parseAllowlistEntry } from "@aulora/core";
import { Button, EmptyState, Icon, Input, Spinner, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import { allowlistKindLabel, formatDate } from "../../../lib/invite-format";

export interface AllowlistManagerProps {
  readonly canAdd: boolean;
  readonly canRemove: boolean;
}

/**
 * Pre-approved addresses. Anyone who signs in with a matching address can join
 * an invite-only workspace without a link, once they have confirmed they own
 * it (a verified provider address joins directly; otherwise a code is emailed).
 */
export function AllowlistManager({ canAdd, canRemove }: AllowlistManagerProps) {
  const entries = useQuery(api.inviteAllowlist.list, {});
  const remove = useMutation(api.inviteAllowlist.remove);
  const [removeError, setRemoveError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4" data-testid="allowlist-manager">
      <Text size="sm" tone="muted">
        People whose email is listed can join without an invite after confirming they own the
        address. Use <span className="font-mono text-[12px]">@example.com</span> to approve everyone
        at a domain.
      </Text>

      {canAdd && <AllowlistAddForm />}

      {removeError !== null && (
        <Text tone="danger" size="sm" role="alert">
          {removeError}
        </Text>
      )}

      {entries === undefined ? (
        <div className="flex justify-center py-8">
          <Spinner size={22} label="Loading allowlist" />
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-[12px] bg-surface-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="group flex min-h-[44px] items-center gap-3 px-4 py-2.5"
              data-testid="allowlist-row"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-3 text-text-muted">
                <Icon name={entry.kind === "domain" ? "users" : "user-plus"} size={14} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[13px] text-text">{entry.pattern}</span>
                  <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-text-muted">
                    {allowlistKindLabel(entry.kind)}
                  </span>
                </div>
                <span className="truncate text-[12px] text-text-muted">
                  Added by {entry.addedByName ?? "a former member"} · {formatDate(entry.addedAt)}
                  {entry.note !== null && ` · ${entry.note}`}
                </span>
              </div>
              {canRemove && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  aria-label={`Remove ${entry.pattern}`}
                  onClick={() => {
                    setRemoveError(null);
                    void remove({ entryId: entry.id }).catch((cause: unknown) => {
                      setRemoveError(
                        cause instanceof Error ? cause.message : "Could not remove that entry.",
                      );
                    });
                  }}
                >
                  <Icon name="trash" size={14} />
                </Button>
              )}
            </li>
          ))}
          {entries.length === 0 && (
            <li className="px-4 py-2">
              <EmptyState
                size="sm"
                icon="mail"
                title="Nobody is pre-approved yet"
                description="Add an email address or domain above to let those people join without an invite."
              />
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function AllowlistAddForm() {
  const add = useMutation(api.inviteAllowlist.add);
  const [entry, setEntry] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = parseAllowlistEntry(entry) !== null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    void add({ entry, ...(note.trim().length > 0 ? { note: note.trim() } : {}) })
      .then(() => {
        setEntry("");
        setNote("");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not add that entry.");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <form className="flex flex-col gap-3 rounded-[12px] bg-surface-2 p-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Email or domain"
          placeholder="sam@acme.com or @acme.com"
          autoComplete="off"
          value={entry}
          onChange={(event) => {
            setEntry(event.currentTarget.value);
          }}
        />
        <Input
          label="Note (optional)"
          maxLength={80}
          value={note}
          onChange={(event) => {
            setNote(event.currentTarget.value);
          }}
        />
      </div>
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      <div>
        <Button type="submit" variant="secondary" loading={busy} disabled={!valid || busy}>
          Add to allowlist
        </Button>
      </div>
    </form>
  );
}
