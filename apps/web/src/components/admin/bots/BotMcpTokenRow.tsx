/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Badge, Button, Text } from "@aulora/ui-web";
import type { BotMcpTokenSummary } from "../../../../../../packages/convex/convex/lib/botMcpTypes";
import { formatDate } from "../../../lib/invite-format";
import {
  describeMcpExpiry,
  describeMcpLastUsed,
  maskedMcpToken,
  mcpScopeLabel,
} from "./bot-mcp-format";

export interface BotMcpTokenRowProps {
  readonly token: BotMcpTokenSummary;
  /** "All bots" or the names of the bots the token is limited to. */
  readonly botsLabel: string;
  readonly busy: boolean;
  readonly now: number;
  readonly onRevoke: () => void;
}

function Detail({ label, children }: { readonly label: string; readonly children: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-text-muted">{label}</dt>
      <dd className="truncate text-[12.5px] text-text-secondary" title={children}>
        {children}
      </dd>
    </div>
  );
}

/** One MCP token: what it can do, who made it, when it ends and when it was last used. */
export function BotMcpTokenRow(props: BotMcpTokenRowProps) {
  const { token, botsLabel, busy, now, onRevoke } = props;
  return (
    <li
      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start"
      data-testid={`mcp-token-${token.id}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Text as="span" size="sm" className="truncate font-medium">
            {token.name}
          </Text>
          <Badge tone={token.scope === "write" ? "accent" : "neutral"} size="sm">
            {mcpScopeLabel(token.scope)}
          </Badge>
          {token.expired && (
            <Badge tone="danger" size="sm">
              Expired
            </Badge>
          )}
          <Text as="span" size="xs" tone="muted" className="font-mono text-[12px]">
            {maskedMcpToken(token.tokenLast4)}
          </Text>
        </div>
        <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          <Detail label="Bots">{botsLabel}</Detail>
          <Detail label="Created">{`${token.createdByName} on ${formatDate(token.createdAt)}`}</Detail>
          <Detail label="Expires">{describeMcpExpiry(token.expiresAt, token.expired, now)}</Detail>
          <Detail label="Last used">{describeMcpLastUsed(token.lastUsedAt, now)}</Detail>
        </dl>
      </div>
      <Button
        variant="danger"
        size="sm"
        disabled={busy}
        aria-label={`Revoke ${token.name}`}
        onClick={onRevoke}
      >
        Revoke
      </Button>
    </li>
  );
}
