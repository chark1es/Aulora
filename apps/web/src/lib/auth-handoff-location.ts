/**
 * Cheap detection of an OAuth finish redirect in the address bar.
 *
 * Boot only pays for `lib/oauth-start` (the exchange, its crypto and the
 * desktop deep-link completion) when one of these parameters is actually
 * present; an ordinary page load must not download that code. This is a
 * subset check, not a parser: a false positive simply runs the full
 * `readAuthHandoff`, which is where the parameters are validated.
 */

/** `readAuthHandoff`'s parameter names, all prefixed except the echoed `tx`. */
const HANDOFF_PARAM_PREFIX = "aulora-auth-";
const HANDOFF_TX = "tx";

/** Whether the fragment or query carries anything the finish step reads. */
export function hasAuthHandoffParams(hash: string, search: string): boolean {
  if (hash.includes(HANDOFF_PARAM_PREFIX) || search.includes(HANDOFF_PARAM_PREFIX)) {
    return true;
  }
  return (
    new URLSearchParams(hash.replace(/^#/, "")).has(HANDOFF_TX) ||
    new URLSearchParams(search.replace(/^\?/, "")).has(HANDOFF_TX)
  );
}
