import type { ResolvedBotConfig } from "./config.js";

export type CallKind = "query" | "mutation" | "action";

export interface EndpointUrls {
  /** `POST {siteUrl}/bots/token`. */
  readonly token: string;
  /** `POST {convexUrl}/api/{kind}`. */
  api(kind: CallKind): string;
}

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * The only module that assembles URLs from configuration. Keeping it here
 * means no call site can fetch an unvalidated string.
 */
export function buildUrls(config: Pick<ResolvedBotConfig, "siteUrl" | "convexUrl">): EndpointUrls {
  const siteOrigin = withTrailingSlash(config.siteUrl);
  const convexOrigin = withTrailingSlash(config.convexUrl);
  return {
    token: new URL("bots/token", siteOrigin).toString(),
    api: (kind) => new URL(`api/${kind}`, convexOrigin).toString(),
  };
}
