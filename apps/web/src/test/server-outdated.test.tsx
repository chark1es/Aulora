import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerUpdateRequired, useOutdatedServer } from "../components/ClientVersionGate";

const mock = vi.hoisted(() => ({ config: undefined as unknown }));

vi.mock("convex/react", () => ({
  useQuery: () => mock.config,
}));

describe("useOutdatedServer", () => {
  beforeEach(() => {
    mock.config = undefined;
  });

  it("is quiet while the server config loads", () => {
    const { result } = renderHook(() => useOutdatedServer());
    expect(result.current).toBeNull();
  });

  it("flags a server from before the release, which never sends `features`", () => {
    mock.config = { version: "1.3.1" };
    const { result } = renderHook(() => useOutdatedServer());
    expect(result.current).toEqual({ version: "1.3.1" });
  });

  it("accepts a current server", () => {
    mock.config = {
      version: "1.4.0",
      features: {
        disableNewCallTransport: false,
        disablePipVideo: false,
        disableAutoDegrade: false,
      },
    };
    const { result } = renderHook(() => useOutdatedServer());
    expect(result.current).toBeNull();
  });
});

describe("ServerUpdateRequired", () => {
  it("names the server version and lets the person switch or retry", async () => {
    const user = userEvent.setup();
    const recovery = { onRetry: vi.fn(), onSwitchServer: vi.fn() };
    render(<ServerUpdateRequired serverVersion="1.3.1" recovery={recovery} />);

    expect(screen.getByTestId("server-update-required")).toBeInTheDocument();
    expect(screen.getByText(/runs Aulora v1\.3\.1/)).toBeInTheDocument();
    expect(screen.getByText(/administrator to update the server/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use a different server" }));
    expect(recovery.onSwitchServer).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(recovery.onRetry).toHaveBeenCalledTimes(1);
  });
});
