/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { type ChannelSummary, WEBHOOK_LIMITS } from "@aulora/core";
import { Button, Icon, Input, Modal, Select, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { WebhookSummary } from "../../../../../../packages/convex/convex/webhooks";
import { postableChannels, validateWebhookName, webhookChannelLabel } from "./webhook-format";

export interface WebhookCreated {
  readonly webhookId: string;
  readonly token: string;
  readonly name: string;
}

export interface WebhookDialogProps {
  readonly open: boolean;
  readonly channels: readonly ChannelSummary[];
  readonly channelNames: ReadonlyMap<string, string> | undefined;
  /** Present when editing; absent when creating. */
  readonly webhook?: WebhookSummary;
  readonly onClose: () => void;
  readonly onCreated: (created: WebhookCreated) => void;
}

interface WebhookFormState {
  readonly name: string;
  readonly channelId: string;
  readonly busy: boolean;
  readonly error: string | null;
}

function useWebhookForm(props: WebhookDialogProps) {
  const { webhook, onClose, onCreated } = props;
  const create = useMutation(api.webhooks.create);
  const update = useMutation(api.webhooks.update);
  const [state, setState] = useState<WebhookFormState>({
    name: webhook?.name ?? "",
    channelId: webhook?.channelId ?? "",
    busy: false,
    error: null,
  });

  function patch(next: Partial<WebhookFormState>): void {
    setState((current) => ({ ...current, ...next }));
  }

  function submit(): void {
    const invalid = validateWebhookName(state.name);
    if (invalid !== null) {
      patch({ error: invalid });
      return;
    }
    if (state.channelId.length === 0) {
      patch({ error: "Pick a channel." });
      return;
    }
    patch({ busy: true, error: null });
    const channelId = state.channelId as never;
    const name = state.name.trim();
    const task =
      webhook === undefined
        ? create({ channelId, name }).then((result) => {
            onCreated({ webhookId: result.webhookId, token: result.token, name });
          })
        : update({ webhookId: webhook.id, name, channelId }).then(onClose);
    task
      .catch((cause: unknown) => {
        patch({ error: cause instanceof Error ? cause.message : "Could not save the webhook." });
      })
      .finally(() => {
        patch({ busy: false });
      });
  }

  return { state, patch, submit };
}

export function WebhookDialog(props: WebhookDialogProps) {
  const { open, channels, channelNames, webhook, onClose } = props;
  const { state, patch, submit } = useWebhookForm(props);
  const options = postableChannels(channels).map((channel) => ({
    value: channel.id,
    label: webhookChannelLabel(channel.id, channels, channelNames),
  }));
  const editing = webhook !== undefined;
  const title = editing ? "Edit webhook" : "New webhook";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      label={title}
      title={title}
      description="Anything that can send an HTTP request can post to the channel with the URL."
      icon={<Icon name="link" size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={state.busy} disabled={state.busy} onClick={submit}>
            {editing ? "Save" : "Create webhook"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Input
          label="Name"
          value={state.name}
          maxLength={WEBHOOK_LIMITS.maxNameLength}
          autoComplete="off"
          hint="Shown as the author of every message it posts."
          onChange={(event) => {
            patch({ name: event.currentTarget.value });
          }}
        />
        <Select
          label="Channel"
          value={state.channelId}
          options={options}
          placeholder="Choose a channel"
          onChange={(channelId) => {
            patch({ channelId });
          }}
        />
        {state.error !== null && (
          <Text role="alert" tone="danger" size="sm">
            {state.error}
          </Text>
        )}
      </div>
    </Modal>
  );
}
