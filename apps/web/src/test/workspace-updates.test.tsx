import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceUpdates, WorkspaceUpdateProvider } from "../providers/WorkspaceUpdateProvider";

const mocks = vi.hoisted(() => ({
  host: null as unknown,
  check: vi.fn(),
  request: vi.fn(),
  reads: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    mocks.reads(getFunctionName(reference), args);
    if (args === "skip") return undefined;
    return getFunctionName(reference) === "updates:version" ? "0.1.0" : mocks.host;
  },
  useAction: () => mocks.check,
  useMutation: () => mocks.request,
}));
const release = {
  currentVersion: "0.1.0",
  latestVersion: "0.2.0",
  updateAvailable: true,
  notes: null,
  error: null,
  phase: "idle",
  hostSeenAt: Date.now(),
  checkedAt: Date.now(),
  autoUpdate: false,
};
function Surface() {
  const update = useWorkspaceUpdates();
  return (
    <>
      {update.available && <span>Workspace settings dot</span>}
      {update.settings}
    </>
  );
}
beforeEach(() => {
  mocks.host = null;
  mocks.check.mockReset().mockResolvedValue(release);
  mocks.request.mockReset().mockResolvedValue(null);
  mocks.reads.mockClear();
});

describe("workspace update settings", () => {
  it("renders workspace controls separately and hides all status when owner authority is lost", async () => {
    const view = render(
      <WorkspaceUpdateProvider isOwner>
        <Surface />
      </WorkspaceUpdateProvider>,
    );
    expect(await screen.findByText("Workspace settings dot")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Workspace instance updates" })).toBeInTheDocument();
    expect(screen.queryByText("Desktop app")).not.toBeInTheDocument();
    view.rerender(
      <WorkspaceUpdateProvider isOwner={false}>
        <Surface />
      </WorkspaceUpdateProvider>,
    );
    expect(screen.queryByText("Workspace settings dot")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace instance")).not.toBeInTheDocument();
    expect(mocks.reads).toHaveBeenCalledWith("updates:status", "skip");
  });
  it("does not check releases or subscribe to workspace status for a member", async () => {
    render(
      <WorkspaceUpdateProvider isOwner={false}>
        <Surface />
      </WorkspaceUpdateProvider>,
    );
    await act(async () => {});
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.reads).toHaveBeenCalledWith("updates:version", "skip");
    expect(mocks.reads).toHaveBeenCalledWith("updates:status", "skip");
  });
  it("disables installation when the watcher is offline and enables explicit restart only when ready", async () => {
    const user = userEvent.setup();
    const view = render(
      <WorkspaceUpdateProvider isOwner>
        <Surface />
      </WorkspaceUpdateProvider>,
    );
    expect(await screen.findByRole("button", { name: "Download update" })).toBeDisabled();
    mocks.host = { ...release, phase: "ready", hostSeenAt: Date.now() };
    view.rerender(
      <WorkspaceUpdateProvider isOwner>
        <Surface />
      </WorkspaceUpdateProvider>,
    );
    expect(screen.queryByRole("button", { name: "Download update" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(mocks.request).toHaveBeenCalledWith({ command: "restart" });
  });
});
