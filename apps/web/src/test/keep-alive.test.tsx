import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { KeepAlive } from "../components/KeepAlive";

let mounts = 0;

function Probe() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <p>Loaded notes</p>;
}

function Harness() {
  const [active, setActive] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setActive((current) => !current);
        }}
      >
        toggle
      </button>
      <KeepAlive active={active}>
        <Probe />
      </KeepAlive>
    </>
  );
}

function wrapperOf(text: string): HTMLElement {
  const node = screen.getByText(text).closest("[aria-hidden]");
  if (node === null) {
    throw new Error("KeepAlive wrapper not found");
  }
  return node as HTMLElement;
}

describe("KeepAlive", () => {
  it("keeps a hidden view mounted instead of unmounting it", () => {
    mounts = 0;
    render(<Harness />);
    expect(mounts).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByText("Loaded notes")).toBeInTheDocument();
    expect(wrapperOf("Loaded notes")).toHaveAttribute("aria-hidden", "true");
    expect(wrapperOf("Loaded notes")).toHaveClass("hidden");

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(wrapperOf("Loaded notes")).toHaveAttribute("aria-hidden", "false");
    expect(wrapperOf("Loaded notes")).toHaveClass("flex");
    expect(mounts).toBe(1);
  });
});
