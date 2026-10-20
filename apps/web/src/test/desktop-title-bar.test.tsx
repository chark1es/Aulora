import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopTitleBar } from "../components/DesktopTitleBar";

const state = vi.hoisted(() => ({
  shows: false,
  name: null as string | null,
}));

vi.mock("../lib/desktop", () => ({
  showsDesktopTitleBar: () => state.shows,
}));

vi.mock("../providers/ProfileProvider", () => ({
  useProfiles: () => ({
    activeProfile: state.name === null ? undefined : { name: state.name },
  }),
}));

beforeEach(() => {
  state.shows = false;
  state.name = null;
});

describe("DesktopTitleBar", () => {
  it("renders nothing outside the macOS shell", () => {
    const { container } = render(<DesktopTitleBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a window drag bar with the active workspace name", () => {
    state.shows = true;
    state.name = "Acme Studio";
    render(<DesktopTitleBar />);
    const label = screen.getByText("Acme Studio");
    expect(label).toBeInTheDocument();
    expect(label.closest("header")).toHaveAttribute("data-tauri-drag-region");
  });

  it("falls back to the app name before a workspace is chosen", () => {
    state.shows = true;
    render(<DesktopTitleBar />);
    expect(screen.getByText("Aulora")).toBeInTheDocument();
  });
});
