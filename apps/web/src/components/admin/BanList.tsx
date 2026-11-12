/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button } from "@aulora/ui-web";
import { PersonAvatar } from "../chat/member-avatars";

export interface BanEntry {
  readonly id: string;
  readonly userId: string;
  readonly name: string | null;
  readonly actorName: string | null;
  readonly reason: string | null;
  readonly expiresAt: number | null;
}

/** "Permanent", or when the ban lifts on its own. */
function banTerm(expiresAt: number | null): string {
  if (expiresAt === null) {
    return "Permanent";
  }
  const until = new Date(expiresAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `Until ${until}`;
}

/** The second line of a ban: its term, who issued it, and why. */
function banDetails(entry: BanEntry): string {
  const parts = [banTerm(entry.expiresAt)];
  if (entry.actorName !== null) {
    parts.push(`by ${entry.actorName}`);
  }
  if (entry.reason !== null && entry.reason.length > 0) {
    parts.push(`“${entry.reason}”`);
  }
  return parts.join(" · ");
}

function BanRow(props: {
  readonly entry: BanEntry;
  readonly busy: boolean;
  readonly onUnban: () => void;
}) {
  const { entry, busy, onUnban } = props;
  return (
    <li className="flex items-center gap-3 rounded-[9px] px-2 py-2">
      <PersonAvatar userId={entry.userId} size={32} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-text">
          {entry.name ?? "Former member"}
        </span>
        <span className="block truncate text-[12px] text-text-muted">{banDetails(entry)}</span>
      </span>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onUnban}>
        Unban
      </Button>
    </li>
  );
}

/**
 * People who cannot rejoin, each with their picture, name, the ban’s term and
 * reason, and an Unban action. Lives in the Banned members dialog.
 */
export function BanList(props: {
  readonly bans: readonly BanEntry[];
  readonly busy: boolean;
  readonly onUnban: (userId: string) => void;
}) {
  const { bans, busy, onUnban } = props;
  if (bans.length === 0) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-dashed border-border px-5 py-6">
        <div className="flex items-baseline gap-3">
          <span
            aria-hidden="true"
            className="text-[40px] font-semibold leading-none tracking-[-0.03em] text-text-muted/60 [font-variant-numeric:tabular-nums]"
          >
            0
          </span>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text">
            Nobody is banned
          </h3>
        </div>
        <p className="max-w-[46ch] text-[13px] leading-relaxed text-text-muted">
          To ban someone, open their panel in the member list and choose Ban. They will appear here
          with the length of the ban and the reason you gave.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border/60 border-y border-border/60">
      {bans.map((entry) => (
        <BanRow
          key={entry.id}
          entry={entry}
          busy={busy}
          onUnban={() => {
            onUnban(entry.userId);
          }}
        />
      ))}
    </ul>
  );
}
