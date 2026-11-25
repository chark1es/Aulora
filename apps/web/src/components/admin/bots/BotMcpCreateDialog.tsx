import { Button, Icon, Modal } from "@aulora/ui-web";
import { type ReactMutation, useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import { BotMcpFields, type McpBotOption } from "./BotMcpFields";
import { BotMcpReveal } from "./BotMcpReveal";
import { MCP_INITIAL_FORM, type McpFormState, validateMcpForm } from "./bot-mcp-format";

export interface BotMcpCreateDialogProps {
  readonly bots: readonly McpBotOption[];
  /** The MCP endpoint of this workspace, used in the setup snippets. */
  readonly url: string;
  readonly onClose: () => void;
}

interface FormStatus {
  readonly busy: boolean;
  readonly error: string | null;
  /** The new secret. Held only while the dialog is open, then dropped. */
  readonly token: string | null;
}

type CreateToken = ReactMutation<typeof api.botMcpTokens.create>;

/** Validates the form, then creates the token and reports each step through `setStatus`. */
function submitMcpForm(
  create: CreateToken,
  form: McpFormState,
  setStatus: (status: FormStatus) => void,
): void {
  const invalid = validateMcpForm(form);
  if (invalid !== null) {
    setStatus({ busy: false, error: invalid, token: null });
    return;
  }
  setStatus({ busy: true, error: null, token: null });
  create({
    name: form.name.trim(),
    scope: form.scope,
    botIds: form.access === "all" ? null : (form.botIds as never),
    expiresInDays: form.expiryDays,
  })
    .then((result) => {
      setStatus({ busy: false, error: null, token: result.token });
    })
    .catch((cause: unknown) => {
      const error = cause instanceof Error ? cause.message : "Could not create the token.";
      setStatus({ busy: false, error, token: null });
    });
}

function useMcpTokenForm() {
  const create = useMutation(api.botMcpTokens.create);
  const [form, setForm] = useState<McpFormState>(MCP_INITIAL_FORM);
  const [status, setStatus] = useState<FormStatus>({ busy: false, error: null, token: null });

  function patch(next: Partial<McpFormState>): void {
    setForm((current) => ({ ...current, ...next }));
  }

  function submit(): void {
    submitMcpForm(create, form, setStatus);
  }

  return { form, status, patch, submit };
}

/**
 * Creates an MCP access token in two steps: the form, then a one-time reveal
 * of the secret with client setup. Mount it only while it is open, so closing
 * it discards the token from state.
 */
export function BotMcpCreateDialog({ bots, url, onClose }: BotMcpCreateDialogProps) {
  const { form, status, patch, submit } = useMcpTokenForm();
  const revealed = status.token !== null;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      label={revealed ? "Token created" : "New MCP token"}
      title={revealed ? "Token created" : "New MCP token"}
      description={
        revealed
          ? "Add it to your AI client now. It is not stored and cannot be shown again."
          : "Gives an AI assistant scoped access to manage bots over MCP."
      }
      icon={<Icon name="key" size={18} />}
      footer={
        revealed ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={status.busy} disabled={status.busy} onClick={submit}>
              Create token
            </Button>
          </>
        )
      }
    >
      {status.token !== null ? (
        <BotMcpReveal token={status.token} url={url} />
      ) : (
        <BotMcpFields form={form} bots={bots} error={status.error} onPatch={patch} />
      )}
    </Modal>
  );
}
