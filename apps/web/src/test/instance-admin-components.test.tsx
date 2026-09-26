import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LicenseStatusCard } from "../components/admin/instance/LicenseStatusCard";

describe("LicenseStatusCard", () => {
  it("nags an unlicensed install", () => {
    render(
      <LicenseStatusCard
        state="unlicensed"
        tier={null}
        licensee={null}
        maskedKey={null}
        note="No license key. Commercial use needs a license."
      />,
    );
    expect(screen.getByTestId("license-state")).toHaveTextContent("Unlicensed");
    expect(screen.getByText(/Commercial use needs a license/)).toBeInTheDocument();
  });

  it("shows an active commercial license with a masked key", () => {
    render(
      <LicenseStatusCard
        state="active"
        tier="commercial"
        licensee="ACME_CORP"
        maskedKey="AULORA1.…ABCD"
        note="Commercial license for ACME_CORP."
      />,
    );
    expect(screen.getByTestId("license-state")).toHaveTextContent("Active");
    expect(screen.getByText("ACME_CORP")).toBeInTheDocument();
    expect(screen.getByText("AULORA1.…ABCD")).toBeInTheDocument();
  });
});
