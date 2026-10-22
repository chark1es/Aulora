/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { type ChannelSummary, webhookUrl } from "@aulora/core";
import { Button, ConfirmDialog, EmptyState, Icon, Spinner, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { WebhookSummary } from "../../../../../../packages/convex/convex/webhooks";
import { AdminPageHeader } from "../AdminPageHeader";
import { useBotAction } from "../bots/use-bot-action";
import { WebhookDialog } from "./WebhookDialog";
import { WebhookRow } from "./WebhookRow";
import { type WebhookSecret, WebhookSecretNotice } from "./WebhookSecretNotice";
import { webhookChannelLabel } from "./webhook-format";

export interface WebhooksSettingsProps {
  readonly canManageWebhooks: boolean;
  readonly channels: readonly ChannelSummary[];
  readonly channelNames: ReadonlyMap<string, string> | undefined;
  /** Public origin of the workspace; the URL a webhook posts to is built from it. */
  readonly origin: string;
}

type DialogState = { readonly kind: "create" } | { readonly kind: "edit"; readonly id: string };

/**
 * The Webhooks page in Settings: every webhook the viewer can manage, with
 * create, edit, replace-URL and delete. A URL is shown once, when it is made.
 */
export function WebhooksSettings(props: WebhooksSettingsProps) {
  const { canManageWebhooks, channels, channelNames, origin } = props;
  if (!canManageWebhooks) {
    return (
      <Text tone="muted" size="sm" data-testid="webhooks-locked">
        You need the Manage Webhooks permission to manage webhooks.
      </Text>
    );
  }
  return <WebhooksPage channels={channels} channelNames={channelNames} origin={origin} />;
}

function WebhooksPage(props: Omit<WebhooksSettingsProps, "canManageWebhooks">) {
  const { channels, channelNames, origin } = props;
  const webhooks = useQuery(api.webhooks.list, {});
  const rotate = useMutation(api.webhooks.rotateToken);
  const remove = useMutation(api.webhooks.remove);
  const { busy, error, run } = useBotAction();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [secret, setSecret] = useState<WebhookSecret | null>(null);
  const [deleting, setDeleting] = useState<WebhookSummary | null>(null);

  function replaceUrl(webhook: WebhookSummary): void {
    void run(
      () =>
        rotate({ webhookId: webhook.id }).then((result) => {
          setSecret({ name: webhook.name, url: webhookUrl(origin, webhook.id, result.token) });
        }),
      "Could not create a new URL.",
    );
  }

  function confirmDelete(): void {
    const target = deleting;
    setDeleting(null);
    if (target !== null) {
      void run(() => remove({ webhookId: target.id }), "Could not delete the webhook.");
    }
  }

  const editing = dialog?.kind === "edit" ? webhooks?.find((w) => w.id === dialog.id) : undefined;
  const addButton = (
    <Button
      leading={<Icon name="plus" size={14} />}
      onClick={() => {
        setDialog({ kind: "create" });
      }}
    >
      New webhook
    </Button>
  );

  return (
    <div className="flex flex-col gap-8" data-testid="webhooks-settings">
      <AdminPageHeader
        title="Webhooks"
        description="Let other tools post messages into a channel by sending an HTTP request to a secret URL."
        trailing={webhooks !== undefined && webhooks.length > 0 ? addButton : null}
      />

      {secret !== null && (
        <WebhookSecretNotice
          secret={secret}
          onDismiss={() => {
            setSecret(null);
          }}
        />
      )}
      {error !== null && (
        <Text role="alert" tone="danger" size="sm">
          {error}
        </Text>
      )}

      {webhooks === undefined ? (
        <div className="flex justify-center py-8">
          <Spinner size={22} label="Loading webhooks" />
        </div>
      ) : webhooks.length === 0 ? (
        <EmptyState
          icon="link"
          title="No webhooks yet"
          description="Create one, copy its URL into the tool that should post, and messages appear in the channel you chose."
          action={addButton}
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-[12px] bg-surface-2">
          {webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.id}
              webhook={webhook}
              channelLabel={webhookChannelLabel(webhook.channelId, channels, channelNames)}
              busy={busy}
              now={Date.now()}
              onEdit={() => {
                setDialog({ kind: "edit", id: webhook.id });
              }}
              onRotate={() => {
                replaceUrl(webhook);
              }}
              onDelete={() => {
                setDeleting(webhook);
              }}
            />
          ))}
        </ul>
      )}

      {dialog !== null && (dialog.kind === "create" || editing !== undefined) && (
        <WebhookDialog
          key={dialog.kind === "edit" ? dialog.id : "create"}
          open
          channels={channels}
          channelNames={channelNames}
          {...(editing !== undefined ? { webhook: editing } : {})}
          onClose={() => {
            setDialog(null);
          }}
          onCreated={(created) => {
            setDialog(null);
            setSecret({
              name: created.name,
              url: webhookUrl(origin, created.webhookId, created.token),
            });
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title="Delete this webhook?"
        description="Its URL stops working right away. Messages it already posted stay in the channel."
        confirmLabel="Delete webhook"
        variant="danger"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
