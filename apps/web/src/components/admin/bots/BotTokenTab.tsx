/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { BotDetail } from "../../../../../../packages/convex/convex/lib/botTypes";
import { CopyButton } from "../invites/CopyButton";
import { useBotAction } from "./use-bot-action";

/**
 * API tokens for running a bot outside the hosted runner. A new token is shown
 * exactly once; dismissing it clears it from memory for good.
 */
export function BotTokenTab({ bot }: { readonly bot: BotDetail }) {
  const rotate = useMutation(api.bots.rotateToken);
  const revoke = useMutation(api.bots.revokeToken);
  const { busy, error, run } = useBotAction();
  const [token, setToken] = useState<string | null>(null);

  function generate(): void {
    void run(
      () =>
        rotate({ botId: bot.id }).then((result) => {
          setToken(result.token);
        }),
      "Could not create a token.",
    );
  }

  function revokeToken(): void {
    setToken(null);
    void run(() => revoke({ botId: bot.id }), "Could not revoke the token.");
  }

  return (
    <div className="flex flex-col gap-4" data-testid="bot-token">
      <Text size="sm" tone="muted">
        Hosted bots do not need a token — the runner injects a credential automatically. Create one
        only to run the bot outside this server.
      </Text>

      {token !== null ? (
        <div className="flex flex-col gap-2 rounded-[12px] border border-accent/40 bg-accent-soft p-3.5">
          <Text size="sm" className="font-medium">
            Copy this token now. It is shown only once.
          </Text>
          <div className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate rounded-[8px] border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-text"
              data-testid="bot-token-value"
            >
              {token}
            </code>
            <CopyButton value={token} label="Copy token" />
          </div>
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setToken(null);
              }}
            >
              I have copied it
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button loading={busy} disabled={busy} onClick={generate}>
            {bot.hasToken ? "Replace token" : "Generate token"}
          </Button>
          {bot.hasToken && bot.tokenLast4 !== null && (
            <Text size="sm" tone="muted">
              Current token ends in <span className="font-mono">{bot.tokenLast4}</span>.
            </Text>
          )}
          {bot.hasToken && (
            <Button variant="danger" disabled={busy} onClick={revokeToken}>
              Revoke token
            </Button>
          )}
        </div>
      )}

      {error !== null && (
        <Text role="alert" tone="danger" size="sm">
          {error}
        </Text>
      )}

      <div className="flex flex-col gap-1.5">
        <Text size="xs" tone="muted" className="font-semibold">
          Outside the server
        </Text>
        <pre className="overflow-x-auto rounded-[10px] border border-border bg-surface-1 p-3 font-mono text-[12px] text-text-secondary">
          {`AULORA_TOKEN=${token ?? "YOUR_TOKEN"}\nAULORA_SITE_URL=https://your-site-url\nAULORA_CONVEX_URL=https://your-convex-url`}
        </pre>
      </div>
    </div>
  );
}
