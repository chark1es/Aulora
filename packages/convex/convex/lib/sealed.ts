import { type EncryptionContext, isSealed, openString, SseError } from "./sse";

/**
 * Reads a server-sealed column for a client. Values without an `aulora-sse-*`
 * envelope (legacy or plaintext dev data) pass through unchanged; a sealed value
 * that fails to open is a real error and is surfaced.
 */
export async function openContent(context: EncryptionContext, sealed: string): Promise<string> {
  if (!isSealed(sealed)) {
    return sealed;
  }
  try {
    return await openString(context, sealed);
  } catch (error) {
    if (error instanceof SseError && error.code === "not-sealed") {
      return sealed;
    }
    throw error;
  }
}

/** Like {@link openContent} but preserves a null that means "column absent". */
export async function openContentOptional(
  context: EncryptionContext,
  sealed: string | undefined,
): Promise<string | null> {
  if (sealed === undefined) {
    return null;
  }
  return await openContent(context, sealed);
}
