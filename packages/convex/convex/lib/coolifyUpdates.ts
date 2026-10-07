import { isReleaseTag } from "@aulora/core";

interface CoolifyConfig {
  readonly apiUrl: string;
  readonly token: string;
  readonly applicationUuid: string;
}

export function coolifyConfiguration():
  | { readonly provider: "host"; readonly config: null; readonly error: null }
  | {
      readonly provider: "coolify";
      readonly config: CoolifyConfig | null;
      readonly error: string | null;
    } {
  const raw = process.env.AULORA_COOLIFY_URL?.trim();
  const token = process.env.AULORA_COOLIFY_API_TOKEN?.trim();
  const applicationUuid = process.env.AULORA_COOLIFY_APPLICATION_UUID?.trim();
  if (process.env.AULORA_UPDATE_PROVIDER !== "coolify" && !raw && !token && !applicationUuid)
    return { provider: "host", config: null, error: null };
  const invalid = (error: string) => ({ provider: "coolify" as const, config: null, error });
  if (!raw || !token || !applicationUuid)
    return invalid(
      "Set AULORA_COOLIFY_URL, AULORA_COOLIFY_API_TOKEN, and AULORA_COOLIFY_APPLICATION_UUID to enable installation.",
    );
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid("AULORA_COOLIFY_URL must be a valid HTTP or HTTPS URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/api/v1", "/api/v1/"].includes(url.pathname)
  )
    return invalid(
      "AULORA_COOLIFY_URL must be the Coolify HTTP or HTTPS origin, optionally ending in /api/v1.",
    );
  if (!/^[a-zA-Z0-9_-]+$/.test(applicationUuid))
    return invalid("AULORA_COOLIFY_APPLICATION_UUID must identify one Coolify application.");
  return {
    provider: "coolify",
    config: { apiUrl: `${url.origin}/api/v1`, token, applicationUuid },
    error: null,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("The update service returned an invalid response.");
  return value as Record<string, unknown>;
}

async function requestJson(
  url: string,
  init: RequestInit,
  service: string,
  allowedOrigin: string,
): Promise<unknown> {
  const target = new URL(url);
  if (
    target.origin !== allowedOrigin ||
    !["https:", "http:"].includes(target.protocol) ||
    target.username ||
    target.password
  )
    throw new Error(`${service} request does not match the configured origin.`);
  let response: Response;
  try {
    response = await fetch(target, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`${service} could not be reached. Check the server connection and try again.`);
  }
  // Never expose a response body or fetch exception: either can contain credentials or deployment logs.
  if (!response.ok)
    throw new Error(
      `${service} returned HTTP ${response.status}. Check its configuration and permissions.`,
    );
  try {
    return await response.json();
  } catch {
    throw new Error(`${service} returned an invalid JSON response.`);
  }
}

function assertApplicationRepository(application: Record<string, unknown>, repo: string): void {
  const repository =
    typeof application.git_repository === "string"
      ? application.git_repository
          .replace(/^https?:\/\/github\.com\//, "")
          .replace(/^git@github\.com:/, "")
          .replace(/\.git\/?$/, "")
          .replace(/\/$/, "")
      : null;
  if (
    application.build_pack !== "dockercompose" ||
    repository?.toLowerCase() !== repo.toLowerCase()
  )
    throw new Error(
      "The configured Coolify application must use Docker Compose and the update feed's GitHub repository.",
    );
}

export function createCoolifyUpdater(config: CoolifyConfig) {
  const coolifyOrigin = new URL(config.apiUrl).origin;
  const request = (path: string, method = "GET", body?: unknown) =>
    requestJson(
      `${config.apiUrl}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      "Coolify",
      coolifyOrigin,
    );

  async function deploy(repo: string, gitTag: string): Promise<string> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !isReleaseTag(gitTag))
      throw new Error(
        "The published release does not identify a valid repository and release tag.",
      );
    const application = record(await request(`/applications/${config.applicationUuid}`));
    assertApplicationRepository(application, repo);
    const release = record(
      await requestJson(
        `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(gitTag)}`,
        {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "aulora-updater" },
        },
        "GitHub",
        "https://api.github.com",
      ),
    );
    if (typeof release.sha !== "string" || !/^[a-f0-9]{40}$/i.test(release.sha))
      throw new Error("GitHub did not resolve the release to a commit.");
    // Pin the release commit. Coolify's deploy `tag` parameter selects resource labels, not Git tags.
    await request(`/applications/${config.applicationUuid}`, "PATCH", {
      git_commit_sha: release.sha,
    });
    const result = record(
      await request(`/deploy?uuid=${encodeURIComponent(config.applicationUuid)}`, "POST"),
    );
    const deployments = Array.isArray(result.deployments) ? result.deployments : [];
    const deployment = deployments
      .map(record)
      .find((item) => item.resource_uuid === config.applicationUuid);
    if (
      typeof deployment?.deployment_uuid !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(deployment.deployment_uuid)
    )
      throw new Error(
        "Coolify did not return a deployment ID. Check Coolify before attempting another installation.",
      );
    return deployment.deployment_uuid;
  }

  async function status(deploymentUuid: string): Promise<"installing" | "installed" | "failed"> {
    const deployment = record(await request(`/deployments/${encodeURIComponent(deploymentUuid)}`));
    if (deployment.status === "finished") return "installed";
    if (
      deployment.status === "failed" ||
      (typeof deployment.status === "string" && deployment.status.startsWith("cancelled"))
    )
      return "failed";
    if (!["queued", "in_progress"].includes(String(deployment.status)))
      throw new Error("Coolify returned an unknown deployment status. Check its deployment logs.");
    return "installing";
  }
  return { deploy, status };
}
