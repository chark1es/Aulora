import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InviteCreated } from "../components/admin/invites/InviteCreated";
import { InviteCreateForm } from "../components/admin/invites/InviteCreateForm";
import { InviteList, type InviteRow } from "../components/admin/invites/InviteList";

const convex = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("convex/react", () => ({ useMutation: () => convex.create }));

const NOW = Date.now();

function row(overrides: Partial<InviteRow>): InviteRow {
  return {
    id: "i1",
    kind: "link",
    status: "active",
    createdBy: "u1",
    createdByName: "Ada Lovelace",
    note: null,
    codeHint: "ab12",
    restrictedEmail: null,
    emailStatus: null,
    maxUses: 0,
    uses: 0,
    expiresAt: null,
    createdAt: NOW,
    redemptions: [],
    ...overrides,
  };
}

const handlers = {
  canLoadMore: false,
  onLoadMore: () => {},
  onRevoke: () => {},
  onDelete: () => {},
};

describe("InviteList", () => {
  const rows = [
    row({
      id: "a",
      note: "Design team",
      kind: "code",
      maxUses: 1,
      restrictedEmail: "sam@acme.com",
    }),
    row({ id: "b", status: "expired", kind: "email", uses: 1, maxUses: 1 }),
  ];

  it("shows creator, method, expiry, limit and recipient for active invites", () => {
    render(<InviteList rows={rows} canDelete {...handlers} />);
    const item = screen.getByTestId("invite-row");
    expect(within(item).getByText("Code invite")).toBeInTheDocument();
    expect(within(item).getByText("Design team")).toBeInTheDocument();
    expect(within(item).getByText("By Ada Lovelace")).toBeInTheDocument();
    expect(within(item).getByText("Never expires")).toBeInTheDocument();
    expect(within(item).getByText("One time")).toBeInTheDocument();
    expect(within(item).getByText("For sam@acme.com")).toBeInTheDocument();
  });

  it("filters ended invites", async () => {
    const user = userEvent.setup();
    render(<InviteList rows={rows} canDelete {...handlers} />);
    expect(screen.getAllByTestId("invite-row")).toHaveLength(1);
    await user.click(screen.getByLabelText("Ended"));
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("hides revoke and delete without the delete permission", () => {
    render(<InviteList rows={rows} canDelete={false} {...handlers} />);
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete invite" })).toBeNull();
  });

  it("asks before revoking", async () => {
    const onRevoke = vi.fn();
    const user = userEvent.setup();
    render(<InviteList rows={rows} canDelete {...handlers} onRevoke={onRevoke} />);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(onRevoke).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(onRevoke).toHaveBeenCalledWith("a");
  });
});

describe("InviteCreateForm custom code", () => {
  it("validates a chosen code and submits it", async () => {
    convex.create.mockReset();
    convex.create.mockResolvedValue({
      inviteId: "i1",
      code: "WELCOME-TEAM",
      kind: "code",
      custom: true,
    });
    const user = userEvent.setup();
    render(<InviteCreateForm origin="https://x" />);

    await user.click(screen.getByRole("radio", { name: "Code" }));
    expect(screen.queryByLabelText("Custom code")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Choose my own" }));
    const field = screen.getByLabelText("Custom code");

    await user.type(field, "short");
    expect(screen.getByText(/at least 6/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create invite" })).toBeEnabled();

    await user.clear(field);
    await user.type(field, "welcome-team");
    expect(screen.queryByText(/at least 6/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Create invite" }));
    await waitFor(() => {
      expect(convex.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "code", customCode: "welcome-team" }),
      );
    });
  });

  it("shows the server's duplicate-code refusal inline", async () => {
    convex.create.mockReset();
    convex.create.mockRejectedValue(new Error("That code is already in use"));
    const user = userEvent.setup();
    render(<InviteCreateForm origin="https://x" />);

    await user.click(screen.getByRole("radio", { name: "Code" }));
    await user.click(screen.getByRole("radio", { name: "Choose my own" }));
    await user.type(screen.getByLabelText("Custom code"), "welcome-team");
    await user.click(screen.getByRole("button", { name: "Create invite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That code is already in use");
  });
});

describe("InviteCreated", () => {
  it("shows a grouped access code beside the link", () => {
    render(
      <InviteCreated
        invite={{
          code: "7QXM2KD9TV4B",
          kind: "code",
          link: "https://x/invite/7QXM2KD9TV4B",
          emailedTo: null,
          custom: false,
        }}
      />,
    );
    expect(screen.getByText("7QXM-2KD9-TV4B")).toBeInTheDocument();
    expect(screen.getByText("https://x/invite/7QXM2KD9TV4B")).toBeInTheDocument();
  });

  it("shows a custom code exactly as chosen", () => {
    render(
      <InviteCreated
        invite={{
          code: "HELLO2026XYZ",
          kind: "code",
          link: "https://x/invite/HELLO2026XYZ",
          emailedTo: null,
          custom: true,
        }}
      />,
    );
    expect(screen.getByText("HELLO2026XYZ")).toBeInTheDocument();
  });

  it("says where an emailed invite went", () => {
    render(
      <InviteCreated
        invite={{
          code: "abc",
          kind: "email",
          link: "https://x/invite/abc",
          emailedTo: "sam@acme.com",
          custom: false,
        }}
      />,
    );
    expect(screen.getByText(/on its way to sam@acme.com/)).toBeInTheDocument();
  });
});
