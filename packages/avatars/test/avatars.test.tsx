import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, avatarRadius, avatarSvg, serverAvatarSeed, userAvatarSeed } from "../src";

describe("avatarSvg", () => {
  it("returns a deterministic raw SVG string", () => {
    const first = avatarSvg("aulora:user:8f3a1c");
    const second = avatarSvg("aulora:user:8f3a1c");
    expect(first).toBe(second);
    expect(first).toContain("<svg");
    expect(first).not.toBe(avatarSvg("aulora:user:8f3a1d"));
  });

  it("derives stable seeds from ids, not display names", () => {
    expect(userAvatarSeed("8f3a1c")).toBe("aulora:user:8f3a1c");
    expect(serverAvatarSeed("acme")).toBe("aulora:server:acme");
  });
});

describe("Avatar", () => {
  it("renders a static image with an accessible label when titled", () => {
    render(<Avatar seed={userAvatarSeed("8f3a1c")} size={40} title="Ada" />);
    const image = screen.getByRole("img", { name: "Ada" });
    expect(image.tagName).toBe("IMG");
    expect(image).toHaveAttribute("width", "40");
  });

  it("is decorative when no title is given", () => {
    const { container } = render(<Avatar seed="aulora:user:8f3a1c" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("draws a 2px role-color ring", () => {
    const { container } = render(
      <Avatar seed="aulora:user:8f3a1c" size={32} roleColor="#F5A45B" />,
    );
    const wrapper = container.querySelector("span");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.style.boxShadow).toContain("2px");
    expect(wrapper?.style.boxShadow).toContain("#F5A45B");
  });

  it("renders inline SVG when animated", () => {
    const { container } = render(<Avatar seed="aulora:user:8f3a1c" animate="always" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("avatar shape", () => {
  it("rounds people fully and servers as a squircle", () => {
    expect(avatarRadius(40)).toBe(20);
    expect(avatarRadius(40, "squircle")).toBe(12);
    const { container } = render(<Avatar seed="aulora:server:acme" size={40} shape="squircle" />);
    expect(container.querySelector("span")?.style.borderRadius).toBe("12px");
  });
});
