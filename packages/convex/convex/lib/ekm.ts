/**
 * External Key Manager (EKM) configuration and client.
 *
 * The server-side encryption layer (`lib/sse.ts`) needs one root key — the KEK
 * or master key — that never lives in the database. A self-hoster can keep it
 * in the deployment environment (`local`, derived from `AULORA_ENCRYPTION_KEY`
 * or `INSTANCE_SECRET`) or delegate custody to Vault Transit, AWS KMS, GCP KMS
 * or a small HTTP unwrap proxy.
 *
 * Remote providers are *unwrap-only* and are called exclusively from actions,
 * setup and cron: Convex queries and mutations must stay off the network, so
 * they consume the master key cached by `lib/sse.ts#primeMasterKey`. This
 * module never logs, returns or persists plaintext key material; the wrapped
 * KEK in the environment is the only key-shaped value it accepts.
 */

export type EkmProvider = "local" | "vault" | "aws-kms" | "gcp-kms" | "http";

export interface EkmSettings {
  provider: EkmProvider;
  kekId: string;
  keyVersion: string;
  /** Vault Transit. */
  vaultAddr?: string;
  vaultToken?: string;
  vaultMount?: string;
  vaultNamespace?: string;
  /** AWS KMS. */
  awsRegion?: string;
  awsKmsKeyId?: string;
  /** GCP KMS. */
  gcpKmsKeyName?: string;
  /** HTTP unwrap proxy. */
  proxyUrl?: string;
  proxyToken?: string;
  /** Base64 ciphertext of the master key, sealed by the external KMS. */
  wrappedKek?: string;
  /** Base64 32-byte master key supplied directly (local provider only). */
  directKek?: string;
}

type Env = Record<string, string | undefined>;

/**
 * A byte view guaranteed to sit on a plain `ArrayBuffer` (not a shared one), as
 * the WebCrypto `BufferSource` overloads require under strict TypeScript.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function read(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

const PROVIDERS: readonly EkmProvider[] = ["local", "vault", "aws-kms", "gcp-kms", "http"];

function parseProvider(raw: string | undefined): EkmProvider {
  if (raw !== undefined && (PROVIDERS as readonly string[]).includes(raw)) {
    return raw as EkmProvider;
  }
  return "local";
}

/** Reads EKM configuration, filling in the local-provider defaults. */
export function getEkmSettings(env: Env): EkmSettings {
  const vaultAddr = read(env, "VAULT_ADDR");
  const vaultToken = read(env, "VAULT_TOKEN");
  const vaultNamespace = read(env, "VAULT_NAMESPACE");
  const awsRegion = read(env, "AWS_REGION");
  const awsKmsKeyId = read(env, "AWS_KMS_KEY_ID");
  const gcpKmsKeyName = read(env, "GCP_KMS_KEY_NAME");
  const proxyUrl = read(env, "EKM_PROXY_URL");
  const proxyToken = read(env, "EKM_PROXY_TOKEN");
  const wrappedKek = read(env, "AULORA_KEK_WRAPPED");
  const directKek = read(env, "AULORA_ENCRYPTION_KEY");
  return {
    provider: parseProvider(read(env, "AULORA_EKM_PROVIDER")),
    kekId: read(env, "AULORA_EKM_KEY_ID") ?? "aulora-kek",
    keyVersion: read(env, "AULORA_ENCRYPTION_KEY_VERSION") ?? "1",
    vaultMount: read(env, "VAULT_TRANSIT_MOUNT") ?? "transit",
    ...(vaultAddr !== undefined ? { vaultAddr } : {}),
    ...(vaultToken !== undefined ? { vaultToken } : {}),
    ...(vaultNamespace !== undefined ? { vaultNamespace } : {}),
    ...(awsRegion !== undefined ? { awsRegion } : {}),
    ...(awsKmsKeyId !== undefined ? { awsKmsKeyId } : {}),
    ...(gcpKmsKeyName !== undefined ? { gcpKmsKeyName } : {}),
    ...(proxyUrl !== undefined ? { proxyUrl } : {}),
    ...(proxyToken !== undefined ? { proxyToken } : {}),
    ...(wrappedKek !== undefined ? { wrappedKek } : {}),
    ...(directKek !== undefined ? { directKek } : {}),
  };
}

/** True when the settings carry enough to obtain the master key. */
export function ekmConfigured(settings: EkmSettings): boolean {
  switch (settings.provider) {
    case "local":
      return settings.directKek !== undefined;
    case "vault":
      return (
        settings.vaultAddr !== undefined &&
        settings.vaultToken !== undefined &&
        settings.wrappedKek !== undefined
      );
    case "aws-kms":
      return (
        settings.awsRegion !== undefined &&
        settings.awsKmsKeyId !== undefined &&
        settings.wrappedKek !== undefined
      );
    case "gcp-kms":
      return settings.gcpKmsKeyName !== undefined && settings.wrappedKek !== undefined;
    case "http":
      return settings.proxyUrl !== undefined && settings.wrappedKek !== undefined;
  }
}

export interface EkmMasterKey {
  readonly bytes: Bytes;
  readonly kekId: string;
  readonly keyVersion: string;
  readonly provider: EkmProvider;
}

/** Raised when key material cannot be obtained or was misconfigured. */
export class EkmKeyUnavailableError extends Error {
  constructor(message = "External key manager key is unavailable") {
    super(message);
    this.name = "EkmKeyUnavailableError";
  }
}

export interface EkmClient {
  provider: EkmProvider;
  unwrap?(): Promise<Bytes>;
  wrap?(key: Bytes): Promise<string>;
}

export interface EkmClientDeps {
  readonly fetch?: typeof fetch;
  readonly crypto?: Crypto;
}

function base64ToBytes(value: string): Bytes {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function tryBase64(value: string): Bytes | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return base64ToBytes(padded);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new EkmKeyUnavailableError("EKM response was malformed");
  }
  return value as Record<string, unknown>;
}

/**
 * Pulls one base64 field out of an EKM response. Callers pass an explicit
 * accessor rather than a key path, so no dynamic property lookup can be driven
 * by response content.
 */
function readBase64Field(
  body: unknown,
  select: (envelope: Record<string, unknown>) => unknown,
): Bytes {
  const cursor = select(asRecord(body));
  if (typeof cursor !== "string" || cursor.length === 0) {
    throw new EkmKeyUnavailableError("EKM response did not contain key material");
  }
  const bytes = tryBase64(cursor);
  if (bytes === null || bytes.length === 0) {
    throw new EkmKeyUnavailableError("EKM response key was not valid base64");
  }
  return bytes;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new EkmKeyUnavailableError("EKM response was not valid JSON");
  }
}

async function unwrapHttp(settings: EkmSettings, fetchImpl: typeof fetch): Promise<Bytes> {
  if (settings.proxyUrl === undefined || settings.wrappedKek === undefined) {
    throw new EkmKeyUnavailableError(
      "The http EKM provider needs EKM_PROXY_URL and AULORA_KEK_WRAPPED",
    );
  }
  const base = settings.proxyUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (settings.proxyToken !== undefined) {
    headers.authorization = `Bearer ${settings.proxyToken}`;
  }
  const response = await fetchImpl(`${base}/v1/unwrap`, {
    method: "POST",
    headers,
    body: JSON.stringify({ wrappedKey: settings.wrappedKek, kekId: settings.kekId }),
  });
  if (!response.ok) {
    throw new EkmKeyUnavailableError(`EKM proxy unwrap failed with status ${response.status}`);
  }
  return readBase64Field(await readJson(response), (envelope) => envelope.key);
}

async function unwrapVault(settings: EkmSettings, fetchImpl: typeof fetch): Promise<Bytes> {
  if (
    settings.vaultAddr === undefined ||
    settings.vaultToken === undefined ||
    settings.wrappedKek === undefined
  ) {
    throw new EkmKeyUnavailableError(
      "The vault EKM provider needs VAULT_ADDR, VAULT_TOKEN and AULORA_KEK_WRAPPED",
    );
  }
  const base = settings.vaultAddr.replace(/\/+$/, "");
  const mount = settings.vaultMount ?? "transit";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-vault-token": settings.vaultToken,
  };
  if (settings.vaultNamespace !== undefined) {
    headers["x-vault-namespace"] = settings.vaultNamespace;
  }
  const response = await fetchImpl(`${base}/v1/${mount}/decrypt/${settings.kekId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ciphertext: settings.wrappedKek }),
  });
  if (!response.ok) {
    throw new EkmKeyUnavailableError(`Vault transit decrypt failed with status ${response.status}`);
  }
  return readBase64Field(await readJson(response), (envelope) => asRecord(envelope.data).plaintext);
}

/**
 * AWS KMS decrypt. Real SigV4 signing is out of scope for the Convex runtime,
 * so this path is intentionally minimal: it posts an unsigned
 * `TrentService.Decrypt` call and refuses to run unless a signing fetch is
 * injected (and `AULORA_KEK_WRAPPED` is present). Anything less would silently
 * send an unauthenticated request to AWS.
 */
async function unwrapAwsKms(settings: EkmSettings, deps: EkmClientDeps): Promise<Bytes> {
  if (
    settings.wrappedKek === undefined ||
    settings.awsRegion === undefined ||
    settings.awsKmsKeyId === undefined
  ) {
    throw new EkmKeyUnavailableError(
      "The aws-kms EKM provider needs AWS_REGION, AWS_KMS_KEY_ID and AULORA_KEK_WRAPPED",
    );
  }
  if (deps.fetch === undefined) {
    throw new EkmKeyUnavailableError(
      "The aws-kms EKM provider needs an injected SigV4-signing fetch; none was provided",
    );
  }
  const response = await deps.fetch(`https://kms.${settings.awsRegion}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "TrentService.Decrypt",
    },
    body: JSON.stringify({ CiphertextBlob: settings.wrappedKek, KeyId: settings.awsKmsKeyId }),
  });
  if (!response.ok) {
    throw new EkmKeyUnavailableError(`AWS KMS decrypt failed with status ${response.status}`);
  }
  return readBase64Field(await readJson(response), (envelope) => envelope.Plaintext);
}

async function unwrapGcpKms(settings: EkmSettings, fetchImpl: typeof fetch): Promise<Bytes> {
  if (settings.gcpKmsKeyName === undefined || settings.wrappedKek === undefined) {
    throw new EkmKeyUnavailableError(
      "The gcp-kms EKM provider needs GCP_KMS_KEY_NAME and AULORA_KEK_WRAPPED",
    );
  }
  const name = settings.gcpKmsKeyName.replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (settings.proxyToken !== undefined) {
    headers.authorization = `Bearer ${settings.proxyToken}`;
  }
  const response = await fetchImpl(`${name}:decrypt`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ciphertext: settings.wrappedKek }),
  });
  if (!response.ok) {
    throw new EkmKeyUnavailableError(`GCP KMS decrypt failed with status ${response.status}`);
  }
  return readBase64Field(await readJson(response), (envelope) => envelope.plaintext);
}

/**
 * Builds a client for the configured provider. Only the `local` provider is
 * usable without a network round trip; the remote clients are meant for
 * actions, setup and cron via `lib/sse.ts#primeMasterKey`.
 */
export function createEkmClient(settings: EkmSettings, deps: EkmClientDeps = {}): EkmClient {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  switch (settings.provider) {
    case "local":
      return { provider: "local" };
    case "http":
      return { provider: "http", unwrap: async () => await unwrapHttp(settings, fetchImpl) };
    case "vault":
      return { provider: "vault", unwrap: async () => await unwrapVault(settings, fetchImpl) };
    case "aws-kms":
      return { provider: "aws-kms", unwrap: async () => await unwrapAwsKms(settings, deps) };
    case "gcp-kms":
      return { provider: "gcp-kms", unwrap: async () => await unwrapGcpKms(settings, fetchImpl) };
  }
}

const HKDF_SALT = "aulora/ekm/local";
const HKDF_INFO = "aulora/ekm/master/v1";
const MASTER_KEY_BYTES = 32;

/**
 * Derives the local master key with HKDF-SHA256. IKM is the base64-decoded
 * `AULORA_ENCRYPTION_KEY` (which must be exactly 32 bytes) or, absent that, the
 * utf8 `INSTANCE_SECRET`. Web Crypto is async, so this returns a promise; the
 * intermediate IKM is zeroized after derivation.
 */
export async function deriveLocalMasterKey(env: Env, settings: EkmSettings): Promise<Bytes> {
  const direct = settings.directKek ?? read(env, "AULORA_ENCRYPTION_KEY");
  let ikm: Bytes;
  if (direct !== undefined) {
    const decoded = tryBase64(direct);
    if (decoded === null || decoded.length !== MASTER_KEY_BYTES) {
      throw new EkmKeyUnavailableError(
        "AULORA_ENCRYPTION_KEY must be base64 that decodes to 32 bytes",
      );
    }
    ikm = decoded;
  } else {
    const secret = read(env, "INSTANCE_SECRET");
    if (!secret) {
      throw new EkmKeyUnavailableError(
        "No local master key: set AULORA_ENCRYPTION_KEY or INSTANCE_SECRET",
      );
    }
    ikm = new TextEncoder().encode(secret);
  }
  const subtle = globalThis.crypto.subtle;
  const imported = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(HKDF_SALT),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    imported,
    MASTER_KEY_BYTES * 8,
  );
  ikm.fill(0);
  return new Uint8Array(bits);
}
