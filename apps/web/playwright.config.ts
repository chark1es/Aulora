import { defineConfig } from "@playwright/test";

/**
 * E2E config for the deployed first-run stack.
 *
 * There is no `webServer` here on purpose: the suite runs against a real
 * `docker compose` web origin (see `infra/docker/README.md`). Override the
 * origin and owner credentials with:
 *
 *   AULORA_E2E_BASE_URL        (default http://localhost:8080)
 *   AULORA_E2E_OWNER_EMAIL
 *   AULORA_E2E_OWNER_PASSWORD
 */
const baseURL = process.env.AULORA_E2E_BASE_URL ?? "http://localhost:8080";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
