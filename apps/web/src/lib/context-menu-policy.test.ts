import { describe, expect, it, type Mock, vi } from "vitest";
import {
  buildContextMenu,
  type ContextMenuEventLike,
  type ContextMenuHandlerDeps,
  decideContextMenu,
  handleContextMenuEvent,
  isEditableTarget,
  mediaFileName,
  mediaTarget,
} from "./context-menu-policy";

interface MockEvent extends ContextMenuEventLike {
  readonly preventDefault: Mock;
  readonly stopPropagation: Mock;
}

function eventFor(
  target: Element | null,
  init: { readonly defaultPrevented?: boolean; readonly shiftKey?: boolean } = {},
): MockEvent {
  return {
    target,
    defaultPrevented: init.defaultPrevented ?? false,
    shiftKey: init.shiftKey ?? false,
    clientX: 40,
    clientY: 80,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

interface MockDeps extends ContextMenuHandlerDeps {
  readonly copyText: Mock;
  readonly openExternal: Mock;
  readonly saveMedia: Mock;
  readonly selectAll: Mock;
  readonly openMenu: Mock;
}

function deps(overrides: Partial<ContextMenuHandlerDeps> = {}): MockDeps {
  return {
    dev: false,
    selectionText: () => "",
    copyText: vi.fn(),
    openExternal: vi.fn(),
    saveMedia: vi.fn(),
    selectAll: vi.fn(),
    openMenu: vi.fn(),
    ...overrides,
  } as MockDeps;
}

function element(markup: string): Element {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host.firstElementChild as Element;
}

function decisionFor(
  target: Element | null,
  init: {
    readonly defaultPrevented?: boolean;
    readonly shiftKey?: boolean;
    readonly dev?: boolean;
    readonly selectionText?: string;
  } = {},
) {
  return decideContextMenu(eventFor(target, init), {
    dev: init.dev ?? false,
    selectionText: init.selectionText ?? "",
  });
}

describe("decideContextMenu", () => {
  it("leaves the native menu for text inputs, textareas and contenteditable", () => {
    expect(decisionFor(element('<input type="text" />'))).toEqual({
      action: "leave",
      reason: "editable",
    });
    expect(decisionFor(element("<textarea></textarea>"))).toEqual({
      action: "leave",
      reason: "editable",
    });
    const host = element('<div contenteditable="true"><span>text</span></div>');
    expect(decisionFor(host.querySelector("span"))).toEqual({
      action: "leave",
      reason: "editable",
    });
  });

  it("does not treat non-text inputs as editable", () => {
    expect(isEditableTarget(element('<input type="checkbox" />'))).toBe(false);
    expect(decisionFor(element('<input type="checkbox" />'))).toEqual({
      action: "suppress",
      reason: "plain",
    });
  });

  it("leaves an event another capture handler already cancelled", () => {
    const event = eventFor(element("<div></div>"), { defaultPrevented: true });
    expect(decideContextMenu(event, { dev: false, selectionText: "selected" })).toEqual({
      action: "leave",
      reason: "already-handled",
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("offers link actions for http(s) anchors", () => {
    const target = element('<a href="https://example.com/doc">docs</a>');
    expect(decisionFor(target)).toEqual({
      action: "menu",
      target: { kind: "link", href: "https://example.com/doc" },
    });
  });

  it("suppresses anchors with a scheme the shell refuses to open", () => {
    expect(decisionFor(element('<a href="javascript:alert(1)">x</a>'))).toEqual({
      action: "suppress",
      reason: "plain",
    });
  });

  it("offers media actions only for marked user media", () => {
    const marked = element(
      '<img data-context-menu-media src="blob:https://app/abc" alt="photo.png" />',
    );
    expect(mediaTarget(marked)).toEqual({
      kind: "media",
      media: "image",
      url: "blob:https://app/abc",
      name: "photo.png",
    });
    expect(decisionFor(marked)).toEqual({
      action: "menu",
      target: {
        kind: "media",
        media: "image",
        url: "blob:https://app/abc",
        name: "photo.png",
      },
    });
    // An avatar or logo is decorative: no image menu should replace the row's.
    expect(decisionFor(element('<img src="https://cdn/avatar.png" alt="" />'))).toEqual({
      action: "suppress",
      reason: "plain",
    });
  });

  it("offers copy actions for a live text selection", () => {
    expect(
      decisionFor(element("<span>selected words</span>"), {
        selectionText: "selected words",
      }),
    ).toEqual({ action: "menu", target: { kind: "selection", text: "selected words" } });
  });

  it("prefers media and links over an incidental selection", () => {
    expect(
      decisionFor(element('<a href="https://example.com">link</a>'), {
        selectionText: "link",
      }),
    ).toEqual({ action: "menu", target: { kind: "link", href: "https://example.com" } });
  });

  it("suppresses plain text and empty areas", () => {
    expect(decisionFor(element("<div>hello</div>"))).toEqual({
      action: "suppress",
      reason: "plain",
    });
    expect(decisionFor(document.body)).toEqual({ action: "suppress", reason: "plain" });
  });

  it("leaves the native menu on Shift+right-click only in development", () => {
    const target = element("<div></div>");
    expect(decisionFor(target, { shiftKey: true, dev: true })).toEqual({
      action: "leave",
      reason: "dev-native",
    });
    expect(decisionFor(target, { shiftKey: true, dev: false })).toEqual({
      action: "suppress",
      reason: "plain",
    });
  });

  it("keeps the native menu for editable fields even in production", () => {
    expect(
      decisionFor(element('<input type="search" />'), {
        shiftKey: true,
        dev: false,
      }),
    ).toEqual({ action: "leave", reason: "editable" });
  });
});

describe("handleContextMenuEvent", () => {
  it("cancels the native menu and does not stop propagation for plain surfaces", () => {
    const event = eventFor(element("<div></div>"));
    const d = deps();
    const decision = handleContextMenuEvent(event, d);
    expect(decision).toEqual({ action: "suppress", reason: "plain" });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    // Component handlers still run, so an app-owned row still opens its menu.
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(d.openMenu).not.toHaveBeenCalled();
  });

  it("does nothing at all for an already-handled event", () => {
    const event = eventFor(element("<div></div>"), { defaultPrevented: true });
    const d = deps();
    handleContextMenuEvent(event, d);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(d.openMenu).not.toHaveBeenCalled();
  });

  it("opens the link menu and pre-empts the row handler", () => {
    const event = eventFor(element('<a href="https://example.com/x">x</a>'));
    const d = deps();
    handleContextMenuEvent(event, d);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(d.openMenu).toHaveBeenCalledWith({
      clientX: 40,
      clientY: 80,
      label: "Link",
      items: [
        expect.objectContaining({ id: "open-link", label: "Open link" }),
        expect.objectContaining({ id: "copy-link", label: "Copy link address" }),
      ],
    });
    const menu = d.openMenu.mock.calls[0]?.[0] as {
      items: { id: string; onSelect: () => void }[];
    };
    menu.items[0]?.onSelect();
    expect(d.openExternal).toHaveBeenCalledWith("https://example.com/x");
    menu.items[1]?.onSelect();
    expect(d.copyText).toHaveBeenCalledWith("https://example.com/x");
  });

  it("disables address actions for blob media but still saves it", () => {
    const event = eventFor(
      element('<img data-context-menu-media src="blob:https://app/1" alt="cat.png" />'),
    );
    const d = deps();
    handleContextMenuEvent(event, d);
    const menu = d.openMenu.mock.calls[0]?.[0] as {
      label: string;
      items: { id: string; label: string; disabled?: boolean; onSelect: () => void }[];
    };
    expect(menu.label).toBe("Image");
    expect(menu.items.find((item) => item.id === "open-media")?.disabled).toBe(true);
    expect(menu.items.find((item) => item.id === "copy-media")?.disabled).toBe(true);
    const save = menu.items.find((item) => item.id === "save-media");
    expect(save?.label).toBe("Save image as…");
    save?.onSelect();
    expect(d.saveMedia).toHaveBeenCalledWith("blob:https://app/1", "cat.png");
  });

  it("copies a selection and selects the marked message body", () => {
    const body = element("<div data-context-menu-text><span>hello world</span></div>");
    const event = eventFor(body.querySelector("span"));
    const d = deps({ selectionText: () => "hello world" });
    handleContextMenuEvent(event, d);
    const menu = d.openMenu.mock.calls[0]?.[0] as {
      label: string;
      items: { id: string; onSelect: () => void; disabled?: boolean }[];
    };
    expect(menu.label).toBe("Text selection");
    menu.items[0]?.onSelect();
    expect(d.copyText).toHaveBeenCalledWith("hello world");
    menu.items[1]?.onSelect();
    expect(d.selectAll).toHaveBeenCalledWith(body);
  });

  it("leaves editable fields to the webview", () => {
    const event = eventFor(element("<textarea></textarea>"));
    const d = deps();
    handleContextMenuEvent(event, d);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(d.openMenu).not.toHaveBeenCalled();
  });
});

describe("menu helpers", () => {
  it("prefers the author's media name and falls back to the URL", () => {
    expect(mediaFileName("blob:https://app/abc", "image", "photo.jpg")).toBe("photo.jpg");
    expect(mediaFileName("https://cdn.example/a/b/clip.mp4", "video")).toBe("clip.mp4");
    expect(mediaFileName("blob:https://app/abc", "audio")).toBe("audio.webm");
  });

  it("does not offer select all without a text scope", () => {
    const menu = buildContextMenu(
      { kind: "selection", text: "x" },
      { copyText: vi.fn(), openExternal: vi.fn(), saveMedia: vi.fn(), selectAll: vi.fn() },
      null,
    );
    expect(menu.items.find((item) => item.id === "select-all")?.disabled).toBe(true);
  });
});
