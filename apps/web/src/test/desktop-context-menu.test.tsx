import { ContextMenuProvider, useContextMenu } from "@aulora/ui-web";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopContextMenuPolicy } from "../components/DesktopContextMenuPolicy";

interface TauriTestGlobal {
  __TAURI__?: unknown;
}

function installTauri(): void {
  const host = globalThis as TauriTestGlobal;
  host.__TAURI__ = {};
}

afterEach(() => {
  const host = globalThis as TauriTestGlobal;
  delete host.__TAURI__;
});

/** A row with its own app menu, like a message or a member row. */
function AppRow() {
  const openMenu = useContextMenu();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: fixture mirrors an app row's right-click menu
    <div
      data-testid="row"
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu({
          clientX: 1,
          clientY: 2,
          label: "Row",
          items: [{ id: "row-action", label: "Row action", onSelect: () => undefined }],
        });
      }}
    >
      row content
      <a href="https://example.com/doc">linked doc</a>
    </div>
  );
}

function renderShell() {
  installTauri();
  render(
    <ContextMenuProvider>
      <DesktopContextMenuPolicy />
      <AppRow />
      <textarea data-testid="composer" />
    </ContextMenuProvider>,
  );
}

describe("DesktopContextMenu", () => {
  it("includes debug access in desktop link menus", async () => {
    installTauri();
    const showLogs = vi.fn();
    render(
      <ContextMenuProvider>
        <DesktopContextMenuPolicy onOpenDebugLogs={showLogs} />
        <a href="https://example.test">linked page</a>
      </ContextMenuProvider>,
    );
    fireEvent.contextMenu(screen.getByText("linked page"));
    expect(await screen.findByText("Copy link address")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Debug logs" }));
    expect(showLogs).toHaveBeenCalledOnce();
  });
  it("suppresses the webview menu without pre-empting an app row's own menu", async () => {
    renderShell();
    const prevented = !fireEvent.contextMenu(screen.getByTestId("row"));
    expect(prevented).toBe(true);
    expect(await screen.findByText("Row action")).toBeInTheDocument();
  });

  it("replaces a row menu with link actions when the link itself is right-clicked", async () => {
    renderShell();
    fireEvent.contextMenu(screen.getByText("linked doc"));
    expect(await screen.findByText("Copy link address")).toBeInTheDocument();
    expect(screen.queryByText("Row action")).not.toBeInTheDocument();
  });

  it("leaves editable fields to the webview's native menu", () => {
    renderShell();
    // `fireEvent` returns false when the event was cancelled.
    expect(fireEvent.contextMenu(screen.getByTestId("composer"))).toBe(true);
  });
});
