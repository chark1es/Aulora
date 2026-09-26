/**
 * Typed errors for the Aulora MLS engine.
 *
 * Nothing here ever carries plaintext, key material or tokens in its message:
 * only structural/operation context, so errors are safe to log and to send
 * across a Worker boundary.
 */
export type MlsEngineErrorCode =
  | "decode"
  | "no-active-group"
  | "unknown-key-package"
  | "welcome-missing"
  | "not-application-message"
  | "unsupported-message"
  | "not-implemented";

export class MlsEngineError extends Error {
  readonly code: MlsEngineErrorCode;

  constructor(code: MlsEngineErrorCode, message: string) {
    super(message);
    this.name = "MlsEngineError";
    this.code = code;
  }
}
