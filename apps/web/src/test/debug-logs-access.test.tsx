import { debugLog } from "@aulora/core";
import { ContextMenuProvider } from "@aulora/ui-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DebugLogsAccess } from "../components/DebugLogsAccess";

afterEach(() => {
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  debugLog.clear();
});

function setup(desktop = false) {
  if (desktop) (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
  render(
    <ContextMenuProvider>
      <DebugLogsAccess />
      <div data-testid="connect">Connect to a server</div>
      <input aria-label="Server address" />
      <a href="https://example.test">Example link</a>
    </ContextMenuProvider>,
  );
}

describe("signed-out debug logs", () => {
  for (const desktop of [false, true]) {
    it(`opens local logs without any server providers (${desktop ? "desktop" : "browser"})`, async () => {
      setup(desktop);
      // Retry the interaction until the lazy desktop policy has mounted.
      await waitFor(() => {
        fireEvent.contextMenu(screen.getByTestId("connect"));
        expect(screen.getByRole("menuitem", { name: "Debug logs" })).toBeInTheDocument();
      });
      await userEvent.click(await screen.findByRole("menuitem", { name: "Debug logs" }));
      expect(await screen.findByRole("dialog", { name: "Debug logs" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Download debug report" })).toBeInTheDocument();
    });
  }

  it("preserves browser editing and link menus", () => {
    setup();
    expect(fireEvent.contextMenu(screen.getByLabelText("Server address"))).toBe(true);
    expect(fireEvent.contextMenu(screen.getByText("Example link"))).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
