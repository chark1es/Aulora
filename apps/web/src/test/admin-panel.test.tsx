import { Permission } from "@aulora/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPanel, type AdminPanelViewer } from "../components/admin/AdminPanel";
import type { RoleView } from "../lib/workspace-admin";

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ url: "https://chat.example.com" }),
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : state.values.get(getFunctionName(reference)),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (!state.mutations.has(name)) {
      state.mutations.set(name, vi.fn().mockResolvedValue(undefined));
    }
    return state.mutations.get(name);
  },
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));

const FULL_PERMISSIONS =
  Permission.ManageWorkspace |
  Permission.ManageRoles |
  Permission.ManageChannels |
  Permission.CreateInvites |
  Permission.DeleteInvites |
  Permission.Ban |
  Permission.Kick |
  Permission.Timeout |
  Permission.ManageNicknames |
  Permission.ManageBots |
  Permission.ViewAuditLog;

const moderator: RoleView = {
  id: "r1",
  key: null,
  name: "Moderator",
  color: null,
  position: 1,
  permissions: Permission.Kick,
  hoisted: false,
  mentionable: false,
  isEveryone: false,
};

function viewer(permissions = FULL_PERMISSIONS, isOwner = true): AdminPanelViewer {
  return { userId: "u1", isOwner, roleIds: [moderator.id], permissions, topPosition: 10 };
}

function renderPanel(overrides: Partial<Parameters<typeof AdminPanel>[0]> = {}) {
  return render(
    <AdminPanel
      viewer={viewer()}
      ownerId="u1"
      roles={[moderator]}
      members={[]}
      categories={[]}
      channels={[]}
      origin="https://chat.example.com"
      onClose={() => {}}
      {...overrides}
    />,
  );
}

function nav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Settings sections" });
}

beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.values.set("roles:list", [moderator]);
  state.values.set("members:list", []);
  state.values.set("members:listBans", []);
  state.values.set("notes:list", []);
});

describe("AdminPanel layout", () => {
  it("renders one grouped rail and no separate Admin badge", () => {
    renderPanel();
    const rail = nav();
    expect(within(rail).getByText("Workspace")).toBeInTheDocument();
    expect(within(rail).getByText("People")).toBeInTheDocument();
    expect(within(rail).getByText("Channels")).toBeInTheDocument();
    expect(within(rail).getByText("Server")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workspace settings" })).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("shows the General page first and switches pages from the rail", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(within(nav()).getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(within(nav()).getByRole("button", { name: "Members" }));
    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(within(nav()).getByRole("button", { name: "Members" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("only lists sections the viewer can open", () => {
    renderPanel({ viewer: viewer(Permission.ManageWorkspace, false) });
    const rail = nav();
    expect(within(rail).getByRole("button", { name: "General" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Addons" })).toBeInTheDocument();
    expect(within(rail).queryByRole("button", { name: "Roles" })).not.toBeInTheDocument();
    expect(within(rail).queryByText("Server")).not.toBeInTheDocument();
  });

  it("moves focus between sections with the arrow keys", async () => {
    const user = userEvent.setup();
    renderPanel();
    const general = within(nav()).getByRole("button", { name: "General" });
    general.focus();
    await user.keyboard("{ArrowDown}");
    expect(within(nav()).getByRole("button", { name: "Addons" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(general).toHaveFocus();
  });
});

describe("AdminPanel drill-in pages", () => {
  it("uses a breadcrumb back to the Roles list", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(within(nav()).getByRole("button", { name: "Roles" }));

    const row = screen.getByTestId("role-row-Moderator");
    await user.click(within(row).getByRole("button", { name: /^Moderator/ }));

    const heading = screen.getByRole("heading", { name: "Moderator" });
    const header = heading.closest("header");
    expect(header).not.toBeNull();
    const back = within(header as HTMLElement).getByRole("button", { name: "Roles" });
    await user.click(back);

    expect(screen.getByRole("heading", { name: "Roles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New role" })).toBeInTheDocument();
  });
});
