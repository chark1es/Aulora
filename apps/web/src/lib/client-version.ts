/** The version of this web bundle, injected from `apps/web/package.json`. */
export function readClientVersion(): string {
  return typeof __AULORA_CLIENT_VERSION__ === "string" && __AULORA_CLIENT_VERSION__.length > 0
    ? __AULORA_CLIENT_VERSION__
    : "0.0.0-dev";
}

export const CLIENT_VERSION = readClientVersion();
