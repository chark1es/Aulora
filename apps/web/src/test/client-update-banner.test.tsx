import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientUpdateBanner } from "../components/ClientUpdateBanner";
import type { TauriGlobal } from "../lib/desktop";
import { DesktopUpdateProvider } from "../providers/DesktopUpdateProvider";

const shell = globalThis as { __TAURI__?: TauriGlobal };
const saved = shell.__TAURI__;
const available = {
  updateAvailable: true,
  currentVersion: "1.1.0",
  version: "1.2.0",
  notes: "Faster calls.",
  error: null,
  pubDate: 1_700_000_000,
};
let invoke = vi.fn();
function setup() {
  return render(
    <DesktopUpdateProvider>
      <ClientUpdateBanner />
    </DesktopUpdateProvider>,
  );
}
beforeEach(() => {
  invoke = vi.fn(async (command: string) =>
    command === "app_version"
      ? "1.1.0"
      : command === "check_for_app_update"
        ? available
        : undefined,
  );
  shell.__TAURI__ = {
    core: { invoke },
    event: {
      listen: async () => () => {},
    },
  };
});
afterEach(() => {
  if (saved === undefined) delete shell.__TAURI__;
  else shell.__TAURI__ = saved;
});

describe("client update banner", () => {
  it("shows the available update with a version badge and primary action", async () => {
    setup();
    expect(await screen.findByTestId("client-update-banner")).toBeInTheDocument();
    expect(screen.getByText("v1.1.0 → v1.2.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
  });

  it("dismisses the banner for the current version with Later", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByTestId("client-update-banner");
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByTestId("client-update-banner")).not.toBeInTheDocument();
  });

  it("offers a restart action once the update is downloaded", async () => {
    const user = userEvent.setup();
    invoke.mockImplementation(async (command: string) =>
      command === "app_version"
        ? "1.1.0"
        : command === "check_for_app_update"
          ? available
          : undefined,
    );
    setup();
    await user.click(await screen.findByRole("button", { name: "Update now" }));
    expect(await screen.findByRole("button", { name: "Restart to finish" })).toBeInTheDocument();
  });

  it("renders nothing outside the desktop shell", async () => {
    delete shell.__TAURI__;
    setup();
    await waitFor(() => {
      expect(invoke).not.toHaveBeenCalled();
    });
    expect(screen.queryByTestId("client-update-banner")).not.toBeInTheDocument();
  });
});
