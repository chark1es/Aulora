import { expect, test } from "@playwright/test";

/**
 * Phase 4.3 deep-link and web-push surface. These specs need only the deployed
 * web origin (no owner credentials), so they run on any fresh stack:
 *   - `?server=` prefills the connect screen (the web half of `aulora://connect`)
 *   - `/invite/:code` renders the invite route (the web half of `aulora://invite`)
 *   - the push service worker is served at the site root
 */
test.describe("phase 4.3 deep links and push worker", () => {
  test("prefills the connect screen from ?server", async ({ page }) => {
    await page.goto("/connect?server=chat.acme.com");
    await expect(page.getByLabel("Server address")).toHaveValue("chat.acme.com");
  });

  test("renders the invite route from a link", async ({ page }) => {
    await page.goto("/invite/ABC123");
    await expect(page.getByRole("heading", { name: "Connect first" })).toBeVisible();
  });

  test("serves the push service worker as JavaScript", async ({ request }) => {
    const response = await request.get("/push-sw.js");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"] ?? "").toContain("javascript");
  });
});
