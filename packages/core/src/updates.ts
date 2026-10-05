/**
 * Release checks shared by the desktop updater feed and the self-hosted
 * workspace. A release is a semver tag. The workspace never downgrades, and a
 * stable channel ignores prereleases.
 */

export const DEFAULT_UPDATE_MANIFEST_URL =
  "https://github.com/chark1es/Aulora/releases/latest/download/latest.json";

export const DEFAULT_UPDATE_GITHUB_REPO = "chark1es/Aulora";

const NUMERIC_IDENTIFIER = /^(0|[1-9]\d*)$/;
const DOT_SEPARATED_IDENTIFIER = /^[0-9A-Za-z.-]+$/;

const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const VERSION_EXPORT = /export const AULORA_VERSION = "([^"]+)";/;

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

export type UpdateChannel = "stable" | "beta";

export type WorkspaceApply = "none" | "fast-forward" | "redeploy";

export interface WorkspaceUpdatePlan {
  readonly currentVersion: string;
  readonly sourceVersion: string;
  readonly deployedVersion: string | null;
  readonly latestVersion: string | null;
  readonly updateAvailable: boolean;
  readonly apply: WorkspaceApply;
  readonly notes: string | null;
  readonly pubDate: string | null;
  readonly gitTag: string | null;
  readonly channel: UpdateChannel;
  readonly error: string | null;
}

export interface PublishedRelease {
  readonly manifest?: unknown;
  readonly githubRelease?: unknown;
  readonly error: string | null;
}

type FetchLike = typeof fetch;

export function updateChannel(value: string | undefined): UpdateChannel {
  return value?.trim().toLowerCase() === "beta" ? "beta" : "stable";
}

export function autoUpdateEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function parseSemver(input: string): Semver | null {
  let rest = input.trim();
  if (rest.startsWith("v")) {
    rest = rest.slice(1);
  }
  const buildIndex = rest.indexOf("+");
  if (buildIndex !== -1) {
    if (!DOT_SEPARATED_IDENTIFIER.test(rest.slice(buildIndex + 1))) {
      return null;
    }
    rest = rest.slice(0, buildIndex);
  }
  let prerelease: string[] = [];
  const prereleaseIndex = rest.indexOf("-");
  if (prereleaseIndex !== -1) {
    const prereleaseText = rest.slice(prereleaseIndex + 1);
    if (!DOT_SEPARATED_IDENTIFIER.test(prereleaseText)) {
      return null;
    }
    prerelease = prereleaseText.split(".");
    rest = rest.slice(0, prereleaseIndex);
  }
  const parts = rest.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [major, minor, patch] = parts as [string, string, string];
  if (
    !NUMERIC_IDENTIFIER.test(major) ||
    !NUMERIC_IDENTIFIER.test(minor) ||
    !NUMERIC_IDENTIFIER.test(patch)
  ) {
    return null;
  }
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease,
  };
}

export function compareSemver(left: Semver, right: Semver): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }
  if (left.prerelease.length === 0) {
    return 1;
  }
  if (right.prerelease.length === 0) {
    return -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease.at(index);
    const b = right.prerelease.at(index);
    if (a === undefined) {
      return -1;
    }
    if (b === undefined) {
      return 1;
    }
    const compared = compareIdentifier(a, b);
    if (compared !== 0) {
      return compared;
    }
  }
  return 0;
}

export function isReleaseTag(tag: string): boolean {
  const parsed = parseSemver(tag);
  if (parsed === null) {
    return false;
  }
  const prerelease = parsed.prerelease.length > 0 ? `-${parsed.prerelease.join(".")}` : "";
  return tag === `v${parsed.major}.${parsed.minor}.${parsed.patch}${prerelease}`;
}

export function releaseTag(version: string): string | null {
  const parsed = parseSemver(version);
  if (parsed === null) {
    return null;
  }
  const prerelease = parsed.prerelease.length > 0 ? `-${parsed.prerelease.join(".")}` : "";
  const tag = `v${parsed.major}.${parsed.minor}.${parsed.patch}${prerelease}`;
  return isReleaseTag(tag) ? tag : null;
}

/** Reads `AULORA_VERSION` out of `packages/convex/convex/lib/env.ts`. */
export function readDeclaredVersion(source: string): string | null {
  return VERSION_EXPORT.exec(source)?.[1] ?? null;
}

export function resolveManifestUrl(
  value: string | undefined,
): { readonly url: string } | { readonly error: string } {
  const raw = value?.trim();
  if (raw === undefined || raw === "") {
    return { url: DEFAULT_UPDATE_MANIFEST_URL };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "Update manifest URL is invalid." };
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) {
    return { url: url.toString() };
  }
  return { error: "Update manifest URL must use https." };
}

export function resolveGitHubRepo(
  value: string | undefined,
): { readonly repo: string } | { readonly error: string } {
  const trimmed = value?.trim();
  const raw = trimmed === undefined || trimmed === "" ? DEFAULT_UPDATE_GITHUB_REPO : trimmed;
  if (!GITHUB_REPO.test(raw)) {
    return { error: "Update repository must look like owner/name." };
  }
  return { repo: raw };
}

interface ResolvedRelease {
  readonly version: string;
  readonly prerelease: boolean;
  readonly notes: string | null;
  readonly pubDate: string | null;
  readonly gitTag: string;
}

export function planWorkspaceUpdate(input: {
  readonly sourceVersion: string;
  readonly deployedVersion?: string | null;
  readonly channel: UpdateChannel;
  readonly manifest?: unknown;
  readonly githubRelease?: unknown;
}): WorkspaceUpdatePlan {
  const deployedVersion =
    input.deployedVersion === undefined || input.deployedVersion === null
      ? null
      : input.deployedVersion.trim();
  const base = {
    currentVersion: deployedVersion ?? input.sourceVersion,
    sourceVersion: input.sourceVersion,
    deployedVersion,
    latestVersion: null,
    updateAvailable: false,
    apply: "none" as const,
    notes: null,
    pubDate: null,
    gitTag: null,
    channel: input.channel,
  };
  const source = parseSemver(input.sourceVersion);
  if (source === null) {
    return { ...base, error: "The checkout version is not valid semver." };
  }
  const deployed = deployedVersion === null ? source : parseSemver(deployedVersion);
  if (deployed === null) {
    return { ...base, error: "The deployed version is not valid semver." };
  }
  if (input.manifest === undefined && input.githubRelease === undefined) {
    return { ...base, error: "No release information." };
  }
  const parsed =
    input.manifest !== undefined
      ? parseManifestRelease(input.manifest)
      : parseGitHubRelease(input.githubRelease);
  if (!parsed.ok) {
    return { ...base, error: parsed.error };
  }
  if (input.channel === "stable" && parsed.release.prerelease) {
    return { ...base, error: null };
  }
  const latest = parseSemver(parsed.release.version);
  if (latest === null) {
    return { ...base, error: "The published version is not valid semver." };
  }
  const aheadOfSource = compareSemver(latest, source) > 0;
  const containersBehind =
    !aheadOfSource &&
    deployedVersion !== null &&
    compareSemver(latest, deployed) > 0 &&
    compareSemver(source, latest) >= 0;
  const apply: WorkspaceApply = aheadOfSource
    ? "fast-forward"
    : containersBehind
      ? "redeploy"
      : "none";
  return {
    ...base,
    latestVersion: parsed.release.version,
    updateAvailable: apply !== "none",
    apply,
    notes: parsed.release.notes,
    pubDate: parsed.release.pubDate,
    gitTag: parsed.release.gitTag,
    error: null,
  };
}

export async function loadPublishedRelease(options: {
  readonly manifestUrl: string;
  readonly githubRepo: string;
  readonly channel: UpdateChannel;
  readonly fetchImpl?: FetchLike;
}): Promise<PublishedRelease> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const manifest = await fetchJson(fetchImpl, options.manifestUrl);
  const manifestError = manifest.ok ? null : manifest.error;
  if (manifest.ok) {
    const version = manifestVersion(manifest.body);
    const prerelease = version !== null && (parseSemver(version)?.prerelease.length ?? 0) > 0;
    if (options.channel === "beta" || !prerelease) {
      return { manifest: manifest.body, error: null };
    }
  }

  if (options.channel === "beta") {
    const list = await fetchJson(
      fetchImpl,
      `https://api.github.com/repos/${options.githubRepo}/releases?per_page=20`,
    );
    if (!list.ok) {
      return { error: manifestError ?? list.error };
    }
    const best = pickHighestRelease(list.body);
    if (best === null) {
      return { error: "No published release found." };
    }
    return { githubRelease: best, error: null };
  }

  const latest = await fetchJson(
    fetchImpl,
    `https://api.github.com/repos/${options.githubRepo}/releases/latest`,
  );
  if (!latest.ok) {
    return { error: manifestError ?? latest.error };
  }
  return { githubRelease: latest.body, error: null };
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^(0|[1-9]\d*)$/.test(left);
  const rightNumeric = /^(0|[1-9]\d*)$/.test(right);
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }
  if (leftNumeric) {
    return -1;
  }
  if (rightNumeric) {
    return 1;
  }
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function clip(value: string | null, max = 4000): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseManifestRelease(
  body: unknown,
):
  | { readonly ok: true; readonly release: ResolvedRelease }
  | { readonly ok: false; readonly error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Update manifest is not an object." };
  }
  const workspace = isRecord(body.workspace) ? body.workspace : null;
  const version =
    (workspace !== null ? stringField(workspace.version) : null) ?? stringField(body.version);
  if (version === null) {
    return { ok: false, error: "Update manifest has no version." };
  }
  const parsed = parseSemver(version);
  if (parsed === null) {
    return { ok: false, error: "Update manifest version is not valid semver." };
  }
  const declaredTag = workspace !== null ? stringField(workspace.gitTag) : null;
  const gitTag = declaredTag ?? releaseTag(version);
  if (gitTag === null || !isReleaseTag(gitTag)) {
    return { ok: false, error: "Update manifest git tag is not a release tag." };
  }
  const tagVersion = parseSemver(gitTag);
  if (tagVersion === null || compareSemver(tagVersion, parsed) !== 0) {
    return { ok: false, error: "Update manifest git tag does not match its version." };
  }
  return {
    ok: true,
    release: {
      version: `${parsed.major}.${parsed.minor}.${parsed.patch}${
        parsed.prerelease.length > 0 ? `-${parsed.prerelease.join(".")}` : ""
      }`,
      prerelease: parsed.prerelease.length > 0,
      notes: clip(stringField(body.notes)),
      pubDate: stringField(body.pub_date) ?? stringField(body.pubDate),
      gitTag,
    },
  };
}

function parseGitHubRelease(
  body: unknown,
):
  | { readonly ok: true; readonly release: ResolvedRelease }
  | { readonly ok: false; readonly error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "GitHub release is not an object." };
  }
  if (body.draft === true) {
    return { ok: false, error: "Draft releases are not installable." };
  }
  const tag = stringField(body.tag_name);
  if (tag === null || !isReleaseTag(tag)) {
    return { ok: false, error: "GitHub release tag is not a version tag." };
  }
  const parsed = parseSemver(tag);
  if (parsed === null) {
    return { ok: false, error: "GitHub release tag is not valid semver." };
  }
  return {
    ok: true,
    release: {
      version: `${parsed.major}.${parsed.minor}.${parsed.patch}${
        parsed.prerelease.length > 0 ? `-${parsed.prerelease.join(".")}` : ""
      }`,
      prerelease: body.prerelease === true || parsed.prerelease.length > 0,
      notes: clip(stringField(body.body)),
      pubDate: stringField(body.published_at),
      gitTag: tag,
    },
  };
}

function manifestVersion(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const workspace = isRecord(body.workspace) ? body.workspace : null;
  return (workspace !== null ? stringField(workspace.version) : null) ?? stringField(body.version);
}

function pickHighestRelease(body: unknown): Record<string, unknown> | null {
  if (!Array.isArray(body)) {
    return null;
  }
  let best: { readonly record: Record<string, unknown>; readonly version: Semver } | null = null;
  for (const entry of body) {
    if (!isRecord(entry) || entry.draft === true) {
      continue;
    }
    const tag = stringField(entry.tag_name);
    if (tag === null) {
      continue;
    }
    const version = parseSemver(tag);
    if (version === null || !isReleaseTag(tag)) {
      continue;
    }
    if (best === null || compareSemver(version, best.version) > 0) {
      best = { record: entry, version };
    }
  }
  return best?.record ?? null;
}

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
): Promise<
  { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly error: string }
> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json, application/json",
        "user-agent": "aulora-updater",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) {
      return { ok: false, error: "No published release found." };
    }
    if (!response.ok) {
      return { ok: false, error: `Update check returned ${response.status}.` };
    }
    return { ok: true, body: await response.json() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Update check failed.",
    };
  }
}
