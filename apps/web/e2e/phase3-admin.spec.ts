import { type Browser, expect, test } from "@playwright/test";
import { baseURL, connectAndSignIn, createChannel, hasOwnerCredentials } from "./helpers";

/**
 * Phase 3 gate: the admin surfaces against a real `docker compose` stack.
 *
 * 1. Owner-only: create/edit a role, set a channel override, create and revoke
 *    an invite, read the audit log and save workspace settings.
 * 2. A second account signs up from an invite link and joins; the owner assigns
 *    a role, sets a nickname, times out and kicks them through the member
 *    manager. This proves the invite redeem route and member management.
 *
 * Credentials come from the environment and are never committed.
 */
test.skip(!hasOwnerCredentials, "set AULORA_E2E_OWNER_EMAIL and AULORA_E2E_OWNER_PASSWORD");

/** Signs a second account up through an invite link and joins the workspace. */
async function createSecondAccount(browser: Browser, invitePath: string) {
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  const signupEmail = `phase3-${Date.now()}@example.com`;
  const signupPassword = "phase3-test-password-1234567890";

  await pageB.goto("/");
  await expect(pageB.getByRole("heading", { name: "Connect to a server" })).toBeVisible();
  await pageB.getByLabel("Server address").fill(baseURL);
  await pageB.getByRole("button", { name: "Connect" }).click();
  await expect(pageB.getByRole("button", { name: "Continue" })).toBeVisible();
  await pageB.getByRole("button", { name: "Continue" }).click();

  await pageB.goto(invitePath);
  await expect(pageB.getByRole("heading", { name: /^Sign in to / })).toBeVisible({
    timeout: 30_000,
  });
  await pageB.getByRole("button", { name: "Create an account" }).click();
  await pageB.getByLabel("Name").fill("Phase Three");
  await pageB.getByLabel("Email").fill(signupEmail);
  await pageB.getByLabel("Password").fill(signupPassword);
  await pageB.getByRole("button", { name: "Create account" }).click();

  await expect(pageB.getByTestId("redeem-card")).toBeVisible({ timeout: 30_000 });
  await pageB.getByRole("button", { name: "Join workspace" }).click();
  await expect(pageB.getByRole("button", { name: "Sign out" })).toBeVisible({
    timeout: 30_000,
  });
  return contextB;
}

test.describe
  .serial("phase 3 admin", () => {
    test("roles, overrides, invites, audit log and workspace settings", async ({ page }) => {
      await connectAndSignIn(page);

      const channelName = `phase3-${Date.now()}`;
      await createChannel(page, channelName);

      await page.getByRole("button", { name: "Workspace settings" }).click();
      await expect(page.getByTestId("admin-panel")).toBeVisible();

      // --- Roles: create ------------------------------------------------------
      await page.getByRole("button", { name: "Roles", exact: true }).click();
      await page.getByRole("button", { name: "New role" }).click();
      const roleName = `phase3-mod-${Date.now()}`;
      await page.getByLabel("Role name").fill(roleName);
      await page.getByLabel("Kick members").check();
      await page.getByLabel("Mentionable").check();
      await page.getByRole("button", { name: "Create role" }).click();
      await expect(page.getByTestId(`role-row-${roleName}`)).toBeVisible({ timeout: 15_000 });

      // --- Roles: edit --------------------------------------------------------
      const renamed = `${roleName}-2`;
      await page.getByTestId(`role-row-${roleName}`).getByRole("button").first().click();
      await page.getByLabel("Role name").fill(renamed);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByTestId(`role-row-${renamed}`)).toBeVisible({ timeout: 15_000 });

      // --- Channel overrides --------------------------------------------------
      await page.getByRole("button", { name: "Permissions", exact: true }).click();
      await page.getByLabel("Override scope").selectOption({ label: `Channel · ${channelName}` });
      await page
        .getByLabel(`Channel · ${channelName} target`)
        .selectOption({ label: "Role · @everyone" });
      await page.getByLabel("Kick members allow").click();
      await page.getByRole("button", { name: "Save overrides" }).click();
      await expect(page.getByTestId("override-list")).toContainText("@everyone", {
        timeout: 15_000,
      });

      // --- Invites ------------------------------------------------------------
      await page.getByRole("button", { name: "Invites", exact: true }).click();
      await page.getByRole("button", { name: "Create invite" }).click();
      const link = page.getByLabel("Invite link");
      await expect(link).toBeVisible({ timeout: 15_000 });
      await expect(link).toHaveValue(/\/invite\//);
      await page.getByRole("button", { name: "Copy" }).click();
      // Newest invite is listed; revoke it.
      await page.getByRole("button", { name: "Revoke" }).first().click();
      await expect(page.getByTestId("invite-list")).toContainText("revoked", { timeout: 15_000 });

      // --- Audit log ----------------------------------------------------------
      await page.getByRole("button", { name: "Audit log", exact: true }).click();
      await expect(page.getByTestId("audit-row").first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("audit-log")).toContainText("Created role");

      // --- Workspace settings -------------------------------------------------
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByLabel("Invite only").check();
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByText("Settings saved.")).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: "Close admin panel" }).click();
      await expect(page.getByTestId("admin-panel")).toBeHidden();
    });

    test("invite redeem and member management with a second account", async ({ browser, page }) => {
      await connectAndSignIn(page);

      // Make sure local sign-up is allowed on this stack.
      await page.getByRole("button", { name: "Workspace settings" }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByLabel("Allow new accounts to sign up").check();
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByText("Settings saved.")).toBeVisible({ timeout: 15_000 });

      // Owner creates a usable invite.
      await page.getByRole("button", { name: "Invites", exact: true }).click();
      await page.getByRole("button", { name: "Create invite" }).click();
      const link = page.getByLabel("Invite link");
      await expect(link).toBeVisible({ timeout: 15_000 });
      const inviteUrl = await link.inputValue();
      const invitePath = new URL(inviteUrl).pathname;

      // Owner creates a role to assign later.
      await page.getByRole("button", { name: "Roles", exact: true }).click();
      await page.getByRole("button", { name: "New role" }).click();
      const roleName = `phase3-assign-${Date.now()}`;
      await page.getByLabel("Role name").fill(roleName);
      await page.getByLabel("Kick members").check();
      await page.getByRole("button", { name: "Create role" }).click();
      await expect(page.getByTestId(`role-row-${roleName}`)).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Close admin panel" }).click();

      // Second account: connect to the server, then open the invite link.
      const contextB = await createSecondAccount(browser, invitePath);

      // Owner assigns the role, sets a nickname, times out and kicks the new member.
      await page.getByRole("button", { name: "Workspace settings" }).click();
      await page.getByRole("button", { name: "Members", exact: true }).click();
      const rows = page.locator('[data-testid^="member-row-"]');
      await expect(rows).toHaveCount(2, { timeout: 30_000 });

      const target = rows.last();
      await target.getByLabel(/^Add role to /).selectOption({ label: roleName });
      await target.getByRole("button", { name: "Add", exact: true }).click();
      await expect(target.getByText(roleName)).toBeVisible({ timeout: 15_000 });

      await target.getByLabel("Nickname").fill("Newbie");
      await target.getByRole("button", { name: "Save", exact: true }).click();
      await expect(target.getByText("Newbie")).toBeVisible({ timeout: 15_000 });

      await target.getByRole("button", { name: "Timeout 60s" }).click();
      await expect(target.getByText(/timed out/)).toBeVisible({ timeout: 15_000 });
      await target.getByRole("button", { name: "Clear timeout" }).click();

      await target.getByRole("button", { name: "Kick", exact: true }).click();
      await expect(rows).toHaveCount(1, { timeout: 15_000 });

      await contextB.close();
    });
  });
