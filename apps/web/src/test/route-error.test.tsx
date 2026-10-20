import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RouteError } from "../components/RouteError";

describe("RouteError", () => {
  it("offers a working reset for an unexpected error", () => {
    const reset = vi.fn();
    render(<RouteError error={new Error("Invalid arguments for this query")} reset={reset} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("treats a transient error as reconnecting", () => {
    render(<RouteError error={new Error("Not authenticated")} reset={() => undefined} />);
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });
});
