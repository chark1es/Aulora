import { hslToHex, parseHexColor, rgbToHsl, roleColorRepairs } from "@aulora/core";
import { paletteFor } from "@aulora/tokens";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoleColorPicker } from "../components/admin/RoleColorPicker";

describe("RoleColorPicker", () => {
  it("renders a colour wheel and the preset palette", () => {
    render(<RoleColorPicker value="#7C5CFF" onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: "Hue" })).toBeInTheDocument();
    expect(screen.getByLabelText("Use color #0E9F8E")).toBeInTheDocument();
  });

  it("picks a custom colour from the wheel with the keyboard", () => {
    const onChange = vi.fn();
    render(<RoleColorPicker value="#7C5CFF" onChange={onChange} />);

    fireEvent.change(screen.getByRole("slider", { name: "Hue" }), { target: { value: "290" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatch(/^#[0-9A-F]{6}$/);
    expect(onChange.mock.calls[0]?.[0]).not.toBe("#7C5CFF");
  });

  it("keeps the preset and clear actions working", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RoleColorPicker value="#7C5CFF" onChange={onChange} />);

    await user.click(screen.getByLabelText("Use color #E4571C"));
    expect(onChange).toHaveBeenLastCalledWith("#E4571C");

    await user.click(screen.getByRole("button", { name: "Clear color" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("disables every control when the role is read-only", () => {
    render(<RoleColorPicker value="#7C5CFF" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("slider", { name: "Hue" })).toBeDisabled();
    expect(screen.getByLabelText("Use color #0E9F8E")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear color" })).toBeDisabled();
  });

  it("previews the role name on both real theme surfaces", () => {
    render(<RoleColorPicker value="#7C5CFF" roleName="Moderator" onChange={vi.fn()} />);

    expect(screen.getByTestId("role-color-preview-light")).toBeInTheDocument();
    expect(screen.getByTestId("role-color-preview-dark")).toBeInTheDocument();
    expect(screen.getByTestId("role-color-preview-name-light")).toHaveTextContent("Moderator");
    expect(screen.getByTestId("role-color-preview-name-dark")).toHaveTextContent("Moderator");
    expect(screen.getByTestId("role-color-preview-light")).toHaveStyle({
      backgroundColor: "#FFFFFF",
    });
    expect(screen.getByTestId("role-color-preview-dark")).toHaveStyle({
      backgroundColor: "#1C1C1E",
    });
  });

  it("states each theme’s contrast verdict in words, not colour alone", () => {
    render(<RoleColorPicker value="#7C5CFF" onChange={vi.fn()} />);

    const light = screen.getByTestId("role-color-preview-verdict-light");
    const dark = screen.getByTestId("role-color-preview-verdict-dark");
    expect(light).toHaveTextContent(/Low contrast|Hard to read|Passes AA/);
    expect(dark).toHaveTextContent(/Low contrast|Hard to read|Passes AA/);
    expect(light.textContent).toMatch(/\d\.\d:1/);
    expect(dark.textContent).toMatch(/\d\.\d:1/);
  });

  it("offers a readable shade that keeps the hue and can be applied", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RoleColorPicker value="#7C5CFF" roleName="Moderator" onChange={onChange} />);

    const suggestion = screen.getAllByTestId("role-color-suggestion")[0];
    if (suggestion === undefined) throw new Error("Missing suggestion");
    expect(suggestion).toHaveTextContent(/Readable on light/);
    expect(suggestion).toHaveTextContent(/keeps the hue/);
    expect(suggestion).toHaveTextContent(/Now/);
    expect(suggestion).toHaveTextContent(/Suggested/);

    await user.click(screen.getByRole("button", { name: "Make readable on light" }));
    const applied = onChange.mock.calls.at(-1)?.[0] as string | undefined;
    expect(applied).toMatch(/^#[0-9A-F]{6}$/);
    expect(applied).not.toBe("#7C5CFF");
  });

  it("shows the default-color message and no suggestion when cleared", () => {
    render(<RoleColorPicker value="" onChange={vi.fn()} />);
    expect(screen.getByTestId("role-color-preview-no-color")).toHaveTextContent(
      /normal text color/,
    );
    expect(screen.queryByTestId("role-color-suggestion")).not.toBeInTheDocument();
    expect(screen.queryByTestId("role-color-preview-verdict-light")).not.toBeInTheDocument();
  });

  it("shows the @role mention sample only for mentionable roles", () => {
    const { unmount } = render(
      <RoleColorPicker value="#0E9F8E" roleName="Moderator" mentionable onChange={vi.fn()} />,
    );
    expect(screen.getByTestId("role-color-preview-mention-light")).toHaveTextContent("@Moderator");
    unmount();

    render(<RoleColorPicker value="#0E9F8E" roleName="Moderator" onChange={vi.fn()} />);
    expect(screen.queryByTestId("role-color-preview-mention-light")).not.toBeInTheDocument();
  });

  it("disables the shade suggestion for read-only roles", () => {
    render(<RoleColorPicker value="#7C5CFF" roleName="Moderator" disabled onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Make readable on light" })).toBeDisabled();
  });

  it("keeps the lightness thumb in range for any shade a suggestion can paint", () => {
    const surfaces = [
      { theme: "light" as const, background: paletteFor("light").chat },
      { theme: "dark" as const, background: paletteFor("dark").chat },
    ];
    const extremes = new Set<string>(["#050505", "#FAFAFA"]);
    for (let hue = 0; hue < 360; hue += 40) {
      for (const color of [hslToHex(hue, 0.9, 0.5), hslToHex(hue, 0.2, 0.5)]) {
        for (const repair of roleColorRepairs(color, surfaces)) {
          if (repair.suggestion !== null) extremes.add(repair.suggestion.color);
        }
      }
    }
    // Suggestions reach well outside the old 20–80% clamp (e.g. a very light dark-theme shade).
    expect(
      [...extremes].some((color) => {
        const l = rgbToHsl(parseHexColor(color) ?? { r: 0, g: 0, b: 0 }).l;
        return l < 0.2 || l > 0.8;
      }),
    ).toBe(true);
    for (const color of extremes) {
      const { unmount } = render(<RoleColorPicker value={color} onChange={vi.fn()} />);
      const slider = screen.getByRole("slider", { name: /Lightness/ }) as HTMLInputElement;
      const lightness = Math.round(rgbToHsl(parseHexColor(color) ?? { r: 0, g: 0, b: 0 }).l * 100);
      expect(Number(slider.min)).toBeLessThanOrEqual(lightness);
      expect(Number(slider.max)).toBeGreaterThanOrEqual(lightness);
      expect(Number(slider.value)).toBe(lightness);
      unmount();
    }
  });

  it("never claims a colour is readable on both themes", () => {
    render(<RoleColorPicker value="#7C5CFF" onChange={vi.fn()} />);
    const preview = screen.getByTestId("role-color-preview");
    expect(preview).toHaveTextContent("Passes AA on neither theme");
    expect(preview).not.toHaveTextContent(/Readable on both/);
  });

  it("shows what a repair does to both themes, not only the repaired one", () => {
    render(<RoleColorPicker value="#7C5CFF" roleName="Moderator" onChange={vi.fn()} />);
    const [light, dark] = screen.getAllByTestId("role-color-suggestion-note");
    expect(light).toHaveTextContent("Light 4.3:1 → 4.5:1 · Dark 3.9:1 → 3.7:1");
    expect(dark).toHaveTextContent("Light 4.3:1 → 3.7:1 · Dark 3.9:1 → 4.5:1");
  });

  it("reads a sub-percent repair as 'Slightly darker', never 'Darker 0%'", () => {
    render(<RoleColorPicker value="#1C80AF" roleName="Moderator" onChange={vi.fn()} />);
    const [light] = screen.getAllByTestId("role-color-suggestion");
    expect(light).toHaveTextContent("Slightly darker · keeps the hue");
    expect(light).not.toHaveTextContent(/0%/);
  });

  it("says 'No color set' for a value that is not a colour", () => {
    render(<RoleColorPicker value="nope" onChange={vi.fn()} />);
    const preview = screen.getByTestId("role-color-preview");
    expect(preview).toHaveTextContent("No color set");
    expect(preview).not.toHaveTextContent("Passes AA on neither theme");
    expect(screen.queryByTestId("role-color-suggestion")).not.toBeInTheDocument();
  });

  it("says why no suggestion appears when fixing one theme would break the other", () => {
    render(<RoleColorPicker value="#C2410C" roleName="Moderator" onChange={vi.fn()} />);
    const preview = screen.getByTestId("role-color-preview");
    expect(preview).toHaveTextContent("Passes AA on light only");
    expect(screen.getByTestId("role-color-repair-blocked")).toHaveTextContent(
      "No shade fixes dark without dropping light below 4.5:1",
    );
    expect(screen.queryByTestId("role-color-suggestion")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make readable/ })).not.toBeInTheDocument();
  });
});
