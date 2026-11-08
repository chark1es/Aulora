import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ClientVersionNotice, ClientVersionRequired } from "../components/ClientVersionGate";
import { CLIENT_VERSION } from "../lib/client-version";

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("client version gate", () => {
  it("reports the injected client version", () => {
    expect(CLIENT_VERSION).not.toBe("0.0.0-dev");
  });

  it("shows the required update screen with both versions and an action", () => {
    render(<ClientVersionRequired policy={{ minClientVersion: "9.0.0" }} />);
    expect(screen.getByTestId("client-update-required")).toBeInTheDocument();
    expect(screen.getByText(/needs Aulora v9\.0\.0 or newer/)).toBeInTheDocument();
    expect(
      screen.getByText((text) => text.includes(`running v${CLIENT_VERSION}`)),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload to update" })).toBeInTheDocument();
  });

  it("shows a recommended update notice and dismisses it for that version", async () => {
    const user = userEvent.setup();
    render(<ClientVersionNotice recommendedVersion="9.0.0" />);
    expect(screen.getByTestId("client-version-notice")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByTestId("client-version-notice")).not.toBeInTheDocument();
    expect(globalThis.localStorage.getItem("aulora:client-version-dismissed")).toBe("9.0.0");
  });

  it("renders no notice when the client meets the recommendation", () => {
    render(<ClientVersionNotice recommendedVersion={CLIENT_VERSION} />);
    expect(screen.queryByTestId("client-version-notice")).not.toBeInTheDocument();
  });
});
