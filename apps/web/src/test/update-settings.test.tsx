import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopUpdateSettings } from "../components/UpdateSettings";
import type { TauriGlobal } from "../lib/desktop";
import { DesktopUpdateProvider, useDesktopUpdates } from "../providers/DesktopUpdateProvider";

const shell = globalThis as { __TAURI__?: TauriGlobal };
const saved = shell.__TAURI__;
const available = {
  updateAvailable: true,
  currentVersion: "0.1.0",
  version: "0.2.0",
  notes: "Better calls.",
  error: null,
};
let invoke = vi.fn();
const listeners = new Map<string, (event: { payload: unknown }) => void>();
function Indicator() {
  const update = useDesktopUpdates();
  return update.status?.updateAvailable ? <span>Settings update dot</span> : null;
}
function setup() {
  return render(
    <DesktopUpdateProvider>
      <Indicator />
      <DesktopUpdateSettings />
    </DesktopUpdateProvider>,
  );
}
beforeEach(() => {
  listeners.clear();
  invoke = vi.fn(async (command: string) =>
    command === "app_version"
      ? "0.1.0"
      : command === "check_for_app_update"
        ? available
        : undefined,
  );
  shell.__TAURI__ = {
    core: { invoke },
    event: {
      listen: async (name, handler) => {
        listeners.set(name, handler);
        return () => {
          listeners.delete(name);
        };
      },
    },
  };
});
afterEach(() => {
  if (saved === undefined) delete shell.__TAURI__;
  else shell.__TAURI__ = saved;
});

describe("desktop settings updates", () => {
  it("downloads first, keeps the indicator, and installs only on explicit restart", async () => {
    const user = userEvent.setup();
    setup();
    expect(await screen.findByText("Current version: v0.1.0")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Download update" });
    expect(screen.getByText("Settings update dot")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart to update" })).not.toBeInTheDocument();
    let finish: (() => void) | undefined;
    invoke.mockImplementation(async (command: string) => {
      if (command === "download_app_update")
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      return undefined;
    });
    await user.click(screen.getByRole("button", { name: "Download update" }));
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeDisabled();
    await act(async () => {
      listeners.get("aulora://app-update-progress")?.({
        payload: { downloaded: 50, contentLength: 100 },
      });
    });
    expect(screen.getByText("50% downloaded")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("install_app_update", undefined);
    await act(async () => finish?.());
    await user.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(invoke).toHaveBeenCalledWith("install_app_update", undefined);
    expect(screen.getByText("Settings update dot")).toBeInTheDocument();
  });

  it("preserves version and available update after a failed check, and retries a failed download", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("button", { name: "Download update" });
    invoke.mockRejectedValue(new Error("Connection failed."));
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection failed.");
    expect(screen.getByText("Current version: v0.1.0")).toBeInTheDocument();
    expect(screen.getByText("Settings update dot")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download update" }));
    expect(screen.queryByRole("button", { name: "Restart to update" })).not.toBeInTheDocument();
    invoke.mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Download update" }));
    expect(await screen.findByRole("button", { name: "Restart to update" })).toBeEnabled();
  });

  it("retains a verified download after failed installation so restart can be retried", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Download update" }));
    invoke.mockRejectedValue(new Error("Installer failed."));
    await user.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Installer failed.");
    expect(screen.getByRole("button", { name: "Restart to update" })).toBeEnabled();
  });

  it("reads the installed version even when the release feed is unavailable and unsubscribes", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "app_version") return "0.1.0";
      throw new Error("Offline.");
    });
    const view = setup();
    expect(await screen.findByText("Current version: v0.1.0")).toBeInTheDocument();
    await waitFor(() => expect(listeners.size).toBe(2));
    view.unmount();
    expect(listeners.size).toBe(0);
  });
});
