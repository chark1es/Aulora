import { Button, Text } from "@aulora/ui-web";
import { CopyButton } from "../invites/CopyButton";

export interface WebhookSecret {
  readonly name: string;
  readonly url: string;
}

interface WebhookSecretNoticeProps {
  readonly secret: WebhookSecret;
  readonly onDismiss: () => void;
}

/** The URL of a new or rotated webhook, shown once because only its hash is kept. */
export function WebhookSecretNotice({ secret, onDismiss }: WebhookSecretNoticeProps) {
  return (
    <div
      className="flex flex-col gap-2 rounded-[12px] border border-accent/40 bg-accent-soft p-3.5"
      data-testid="webhook-secret"
    >
      <Text size="sm" className="font-medium">
        Copy the URL for {secret.name} now. It is shown only once, and anyone who has it can post.
      </Text>
      <div className="flex items-center gap-2">
        <code
          className="min-w-0 flex-1 truncate rounded-[8px] border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-text"
          data-testid="webhook-secret-url"
        >
          {secret.url}
        </code>
        <CopyButton value={secret.url} label="Copy URL" />
      </div>
      <div>
        <Button variant="secondary" size="sm" onClick={onDismiss}>
          I have copied it
        </Button>
      </div>
    </div>
  );
}
