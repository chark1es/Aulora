#!/usr/bin/env node
// Container healthcheck: the supervisor is alive when it has refreshed its
// heartbeat file recently. It deliberately does not touch the backend, so a
// Convex outage does not mark the container unhealthy.

import { statSync } from "node:fs";

const file = process.env.BOT_RUNNER_HEALTH_FILE || "/tmp/bot-runner-ready";
const maxAgeMs = Number(process.env.BOT_RUNNER_HEALTH_MAX_AGE_MS || 30000);

try {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `file` is the runner's own heartbeat path from BOT_RUNNER_HEALTH_FILE (a fixed compose value) or the literal default above, never remote input.
  const ageMs = Date.now() - statSync(file).mtimeMs;
  process.exit(ageMs <= maxAgeMs ? 0 : 1);
} catch {
  process.exit(1);
}
