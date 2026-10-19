// The runner's HTTP client for the Convex runner API (`/bots/runner/*`).
//
// This is the ONLY module that builds request URLs. Every URL is constructed
// from the base URL in the validated config, so `fetch` is never handed a
// caller-supplied string. The runner token is attached here and never logged.

const REQUEST_TIMEOUT_MS = 15000;

export class RunnerApiError extends Error {
  constructor(status) {
    super(`runner API error (HTTP ${status})`);
    this.name = "RunnerApiError";
    this.status = status;
  }
}

export function createRunnerApi(
  config,
  { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  const base = config.convexHttpUrl;

  async function call(path, { method = "GET", body } = {}) {
    const url = new URL(path, base);
    const headers = { authorization: `Bearer ${config.runnerToken}` };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new RunnerApiError(response.status);
    }
    if (response.status === 204) return null;
    return await response.json();
  }

  return {
    async desired() {
      const result = await call("/bots/runner/desired");
      return Array.isArray(result?.bots) ? result.bots : [];
    },
    async bundle(botId) {
      try {
        return await call(`/bots/runner/bundle?botId=${encodeURIComponent(botId)}`);
      } catch (error) {
        if (error instanceof RunnerApiError && error.status === 404) return null;
        throw error;
      }
    },
    credential(botId) {
      return call("/bots/runner/credential", { method: "POST", body: { botId } });
    },
    report(botId, status, message) {
      const body = { botId, status };
      if (message !== undefined && message.length > 0) body.message = message;
      return call("/bots/runner/report", { method: "POST", body });
    },
    logs(botId, lines) {
      return call("/bots/runner/logs", { method: "POST", body: { botId, lines } });
    },
  };
}
