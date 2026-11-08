/**
 * The public branding a server advertises through Convex, read before anyone
 * has signed in. Only ever decoration: a missing or refused answer falls back
 * to the generated workspace mark.
 */
export interface Branding {
  readonly description: string;
  readonly logoUrl: string | null;
}

/** The slice of a Convex client this module needs. */
export interface BrandingClient {
  query(reference: unknown, args: unknown): Promise<unknown>;
  close(): void;
}

export type BrandingClientFactory = (convexUrl: string) => BrandingClient;

const NO_BRANDING: Branding = { description: "", logoUrl: null };

/**
 * Best-effort branding read from the server's public config.
 *
 * Never throws or rejects. `new ConvexReactClient(url)` throws for an address
 * that is not absolute — a well-known document only promises `convexUrl` is a
 * non-empty string, so a self-hosted server can advertise `chat.acme.com` —
 * and that throw outside a `try` would surface as an unhandled rejection while
 * the preview is on screen. Construction, the query and `close()` are each
 * guarded so the connect screen always keeps a usable preview.
 */
export async function fetchBranding(
  convexUrl: string,
  createClient: BrandingClientFactory,
  reference: unknown,
): Promise<Branding> {
  let client: BrandingClient;
  try {
    client = createClient(convexUrl);
  } catch {
    return NO_BRANDING;
  }
  try {
    const config = await client.query(reference, {});
    if (typeof config !== "object" || config === null) {
      return NO_BRANDING;
    }
    const record = config as { readonly description?: unknown; readonly logoUrl?: unknown };
    return {
      description: typeof record.description === "string" ? record.description : "",
      logoUrl:
        typeof record.logoUrl === "string" && record.logoUrl.length > 0 ? record.logoUrl : null,
    };
  } catch {
    return NO_BRANDING;
  } finally {
    try {
      client.close();
    } catch {
      // Closing twice or after a failed connect is not this screen's problem.
    }
  }
}
