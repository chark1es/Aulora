export class ServerUrlError extends Error {
  readonly input: string;

  constructor(message: string, input: string) {
    super(message);
    this.name = "ServerUrlError";
    this.input = input;
  }
}

function stripPort(hostPort: string): string {
  const value = hostPort.trim();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.indexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

/**
 * True for localhost, loopback, RFC 1918 / link-local IPv4 literals, the
 * IPv4 CGNAT range used by Tailscale (`100.64.0.0/10`) and the IPv6 Tailscale
 * ULA prefix (`fd7a:115c:a1e0::/48`).
 */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") {
    return true;
  }
  if (host.endsWith(".localhost")) {
    return true;
  }
  if (host.startsWith("fd7a:115c:a1e0")) {
    return true;
  }
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [a, b] = octets as [number, number, number, number];
  if (a === 127 || a === 10 || a === 0) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  return false;
}

/**
 * Canonicalizes a server address into a base URL.
 *
 * - A missing scheme defaults to `https://`, except for localhost/LAN hosts, which
 *   default to `http://`.
 * - An explicit `http://` scheme is rejected unless the host is localhost/LAN.
 * - Trailing slashes are removed, host is lower-cased, credentials and query/hash
 *   are rejected.
 *
 * Throws {@link ServerUrlError} for empty or invalid input.
 */
export function normalizeServerUrl(input: string): string {
  if (typeof input !== "string") {
    throw new ServerUrlError("Server URL must be a string.", String(input));
  }

  const raw = input.trim();
  if (raw.length === 0) {
    throw new ServerUrlError("Server URL must not be empty.", input);
  }
  if (/\s/.test(raw)) {
    throw new ServerUrlError("Server URL must not contain whitespace.", input);
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
  let candidate: string;

  if (hasScheme) {
    candidate = raw;
  } else {
    const withoutSlashes = raw.startsWith("//") ? raw.slice(2) : raw;
    const hostPort = withoutSlashes.split(/[/?#]/, 1)[0] ?? "";
    const host = stripPort(hostPort);
    if (host.length === 0) {
      throw new ServerUrlError("Server URL is missing a host.", input);
    }
    const scheme = isLocalHostname(host) ? "http" : "https";
    candidate = `${scheme}://${withoutSlashes}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ServerUrlError("Server URL is not a valid URL.", input);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ServerUrlError("Server URL must use http or https.", input);
  }
  if (url.hostname.length === 0) {
    throw new ServerUrlError("Server URL is missing a host.", input);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new ServerUrlError("Server URL must not embed credentials.", input);
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new ServerUrlError("Server URL must not include a query or fragment.", input);
  }

  const local = isLocalHostname(url.hostname);
  if (url.protocol === "http:" && !local) {
    throw new ServerUrlError(
      "Insecure http:// is only allowed for localhost or LAN addresses.",
      input,
    );
  }

  const host = url.hostname.toLowerCase();
  const port = url.port.length > 0 ? `:${url.port}` : "";
  let path = url.pathname.replace(/\/+$/, "");
  if (path.length > 0 && !path.startsWith("/")) {
    path = `/${path}`;
  }

  return `${url.protocol}//${host}${port}${path}`;
}

/** Non-throwing variant: returns `null` when the input cannot be normalized. */
export function tryNormalizeServerUrl(input: string): string | null {
  try {
    return normalizeServerUrl(input);
  } catch {
    return null;
  }
}

/** Builds the well-known endpoint URL for a base URL. */
export function wellKnownUrl(baseUrl: string): string {
  return `${normalizeServerUrl(baseUrl)}/.well-known/aulora.json`;
}
