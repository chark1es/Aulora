/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Text } from "@aulora/ui-web";
import type { WebhookSummary } from "../../../../../../packages/convex/convex/webhooks";
import { describeLastUsed } from "./webhook-format";

export interface WebhookRowProps {
  readonly webhook: WebhookSummary;
  readonly channelLabel: string;
  readonly busy: boolean;
  readonly now: number;
  readonly onEdit: () => void;
  readonly onRotate: () => void;
  readonly onDelete: () => void;
}

export function WebhookRow(props: WebhookRowProps) {
  const { webhook, channelLabel, busy, now, onEdit, onRotate, onDelete } = props;
  return (
    <li
      className="flex min-h-[52px] flex-wrap items-center gap-3 px-4 py-2"
      data-testid={`webhook-row-${webhook.id}`}
    >
      <div className="min-w-0 flex-1">
        <Text as="span" size="sm" className="block truncate font-medium">
          {webhook.name}
        </Text>
        <Text as="span" size="xs" tone="muted" className="block truncate text-[12px]">
          {channelLabel} · ends in {webhook.tokenLast4 ?? "????"} ·{" "}
          {describeLastUsed(webhook.lastUsedAt, now)}
        </Text>
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="sm" disabled={busy} onClick={onEdit}>
          Edit
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={onRotate}>
          New URL
        </Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </li>
  );
}
