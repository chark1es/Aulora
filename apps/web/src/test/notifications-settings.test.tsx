import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationsSettingsSection } from "../components/chat/NotificationsSettingsSection";

describe("NotificationsSettingsSection", () => {
  it("renders each cue label once and keeps a bare toggle", () => {
    render(<NotificationsSettingsSection />);

    expect(screen.getAllByText("Message received")).toHaveLength(1);
    expect(screen.getAllByText("Incoming call")).toHaveLength(1);
    expect(screen.getAllByRole("switch", { name: "Message received" })).toHaveLength(1);
  });
});
