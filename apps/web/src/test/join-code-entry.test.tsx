import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeEntry } from "../components/join/CodeEntry";

const convex = vi.hoisted(() => ({ redeem: vi.fn() }));

vi.mock("convex/react", () => ({ useMutation: () => convex.redeem }));

describe("CodeEntry", () => {
  it("accepts a six-character custom code as well as a generated one", async () => {
    const user = userEvent.setup();
    render(<CodeEntry />);

    const field = screen.getByLabelText("Invite code or link");
    const join = screen.getByRole("button", { name: "Join workspace" });
    expect(join).toBeDisabled();

    await user.type(field, "TEAM");
    expect(join).toBeDisabled();

    await user.type(field, "-01");
    expect(join).toBeEnabled();

    await user.clear(field);
    await user.type(field, "aulora2026");
    expect(join).toBeEnabled();
  });
});
