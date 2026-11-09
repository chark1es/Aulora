import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MembershipGate } from "../components/MembershipGate";

const harness = vi.hoisted(() => ({
  me: undefined as unknown,
}));

vi.mock("convex/react", () => ({
  useQuery: () => harness.me,
}));

vi.mock("../components/JoinGate", () => ({
  JoinGate: () => <div>Join workspace</div>,
}));

function renderGate() {
  return render(
    <MembershipGate
      workspaceIconSeed="acme"
      signedInAs="ada@example.com"
      onSignOut={() => undefined}
    >
      <div>Chat surface</div>
    </MembershipGate>,
  );
}

beforeEach(() => {
  harness.me = { member: { userId: "u1" }, isOwner: false };
});

afterEach(() => {
  harness.me = undefined;
});

describe("MembershipGate", () => {
  it("keeps the chat surface when the membership answer briefly disappears", () => {
    const view = renderGate();
    expect(screen.getByText("Chat surface")).toBeInTheDocument();

    harness.me = undefined;
    view.rerender(
      <MembershipGate
        workspaceIconSeed="acme"
        signedInAs="ada@example.com"
        onSignOut={() => undefined}
      >
        <div>Chat surface</div>
      </MembershipGate>,
    );

    expect(screen.getByText("Chat surface")).toBeInTheDocument();
    expect(screen.queryByText("Loading workspace")).not.toBeInTheDocument();
  });

  it("still shows the join screen for a non-member", () => {
    harness.me = { member: null, isOwner: false };
    renderGate();
    expect(screen.getByText("Join workspace")).toBeInTheDocument();
  });
});
