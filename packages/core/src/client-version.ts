import { compareSemver, parseSemver } from "./updates";

/**
 * How compatible the running client is with the server's advertised version
 * policy.
 *
 * - `ok`: no required or recommended update.
 * - `recommended`: the client still works but an update is advised.
 * - `required`: the client is older than `minClientVersion` and must update
 *   before it can be used safely against this server.
 */
export type ClientVersionState = "ok" | "recommended" | "required";

/**
 * Version policy advertised by `server.publicConfig`. Both fields are optional
 * and absent by default, so a deployment that does not set them keeps its
 * previous behaviour.
 */
export interface ClientVersionPolicy {
  readonly minClientVersion?: string | null;
  readonly recommendedClientVersion?: string | null;
}

/**
 * Compares two version strings with the same SemVer rules as the workspace
 * updater. Returns `null` when either side is not a parseable version, so a
 * development build with no injected version is never misclassified.
 */
export function compareClientVersions(current: string, reference: string): number | null {
  const left = parseSemver(current);
  const right = parseSemver(reference);
  return left === null || right === null ? null : compareSemver(left, right);
}

/**
 * Resolves the update state for a running client. The required gate wins over
 * the recommended notice; an unparseable version or policy is ignored rather
 * than blocking a client we cannot compare.
 */
export function clientVersionState(
  currentVersion: string,
  policy: ClientVersionPolicy | null | undefined,
): ClientVersionState {
  const minimum = policy?.minClientVersion?.trim();
  if (minimum !== undefined && minimum.length > 0) {
    const compared = compareClientVersions(currentVersion, minimum);
    if (compared !== null && compared < 0) {
      return "required";
    }
  }
  const recommended = policy?.recommendedClientVersion?.trim();
  if (recommended !== undefined && recommended.length > 0) {
    const compared = compareClientVersions(currentVersion, recommended);
    if (compared !== null && compared < 0) {
      return "recommended";
    }
  }
  return "ok";
}
