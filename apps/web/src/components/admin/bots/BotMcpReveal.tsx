import { Text } from "@aulora/ui-web";
import { CopyButton } from "../invites/CopyButton";
import { claudeCodeCommand, mcpJsonConfig } from "./bot-mcp-format";

export interface BotMcpRevealProps {
  readonly token: string;
  readonly url: string;
}

function SnippetBlock(props: {
  readonly title: string;
  readonly code: string;
  readonly testId: string;
}) {
  const { title, code, testId } = props;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Text size="xs" tone="muted" className="font-semibold">
          {title}
        </Text>
        <CopyButton value={code} label="Copy" />
      </div>
      <pre
        className="overflow-x-auto rounded-[10px] border border-border bg-surface-1 p-3 font-mono text-[12px] text-text-secondary"
        data-testid={testId}
      >
        {code}
      </pre>
    </div>
  );
}

/**
 * The step after a token is created: the secret itself, shown once, and the
 * client setup with the workspace URL and the token already filled in.
 */
export function BotMcpReveal({ token, url }: BotMcpRevealProps) {
  return (
    <div className="flex flex-col gap-5" data-testid="mcp-reveal">
      <div className="flex flex-col gap-2 rounded-[12px] border border-accent/40 bg-accent-soft p-3.5">
        <Text size="sm" className="font-medium">
          Copy this token now. You will not see it again.
        </Text>
        <div className="flex items-center gap-2">
          <code
            className="min-w-0 flex-1 truncate rounded-[8px] border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-text"
            data-testid="mcp-token-value"
          >
            {token}
          </code>
          <CopyButton value={token} label="Copy token" />
        </div>
      </div>
      <SnippetBlock
        title="Claude Code"
        code={claudeCodeCommand(url, token)}
        testId="mcp-snippet-claude"
      />
      <SnippetBlock
        title="Other clients (mcpServers JSON)"
        code={mcpJsonConfig(url, token)}
        testId="mcp-snippet-json"
      />
    </div>
  );
}
