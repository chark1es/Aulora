import { expect, test } from "@playwright/test";

/**
 * First-run happy path against a real self-hosted stack:
 * connect by URL -> read /.well-known/aulora.json -> sign in with the owner
 * account -> land on the signed-in shell.
 *
 * Credentials come from the environment and are never committed.
 */
const baseURL = process.env.AULORA_E2E_BASE_URL ?? "http://localhost:8080";
const ownerEmail = process.env.AULORA_E2E_OWNER_EMAIL ?? "";
const ownerPassword = process.env.AULORA_E2E_OWNER_PASSWORD ?? "";

test.describe("connect and sign in", () => {
  test("connects by URL, signs in as the owner and shows the shell", async ({ page }) => {
    test.skip(
      ownerEmail === "" || ownerPassword === "",
      "set AULORA_E2E_OWNER_EMAIL and AULORA_E2E_OWNER_PASSWORD",
    );

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Connect to a server" })).toBeVisible();
    await page.getByLabel("Server address").fill(baseURL);
    await page.getByRole("button", { name: "Connect" }).click();

    // Preview is built from the real well-known document.
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: /^Sign in to / })).toBeVisible();
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByLabel("Password").fill(ownerPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    // The Phase 2 shell renders the encrypted chat surface, not a "Connected
    // to" line, so assert the message list and the sign-out control.
    await expect(page.getByTestId("message-list")).toBeVisible({ timeout: 30_000 });
  });
});
