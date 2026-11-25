import type { BotMcpScope } from "@aulora/core";
import type { Id } from "../_generated/dataModel";

/** One MCP access token as shown in Workspace settings -> Bots -> MCP access. */
export interface BotMcpTokenSummary {
  readonly id: Id<"botMcpTokens">;
  readonly name: string;
  readonly scope: BotMcpScope;
  /** `null` means every bot; otherwise the token only reaches these bots. */
  readonly botIds: Id<"bots">[] | null;
  /** Last four characters of the secret, to tell tokens apart. */
  readonly tokenLast4: string;
  /** User id of the admin who issued the token. */
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly lastUsedAt: number | null;
  /** True once `expiresAt` has passed; such a token no longer authenticates. */
  readonly expired: boolean;
}

/** What `botMcpTokens.create` returns. `token` is shown exactly once. */
export interface BotMcpTokenCreated {
  readonly tokenId: Id<"botMcpTokens">;
  readonly token: string;
}
