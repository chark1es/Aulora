import { WEBHOOK_TOKEN_PREFIX } from "@aulora/core";
import { hashBotToken } from "./botAuth";

/** A new webhook secret: `awh_` plus 256 random bits as 43 base64url characters. */
export function generateWebhookToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${WEBHOOK_TOKEN_PREFIX}${encoded}`;
}

/** SHA-256 hex of a secret; the only form that is stored or looked up. */
export async function hashWebhookToken(token: string): Promise<string> {
  return await hashBotToken(token);
}

export function webhookTokenLast4(token: string): string {
  return token.slice(-4);
}
