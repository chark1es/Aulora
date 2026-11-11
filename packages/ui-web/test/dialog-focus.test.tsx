import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Modal, Select } from "../src";

afterEach(() => vi.restoreAllMocks());

function Fixture({ onChange = vi.fn() }: { onChange?: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal open={open} onClose={() => setOpen(false)} label="Editor">
        <input aria-label="Name" />
        <Select
          label="Choice"
          value="a"
          options={[
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ]}
          onChange={onChange}
        />
        <button type="button">Last</button>
      </Modal>
    </>
  );
}

function key(key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  act(() => {
    document.activeElement?.dispatchEvent(event);
  });
  return event;
}

async function openDialog() {
  render(<Fixture />);
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveFocus());
  return opener;
}

it("focuses a dialog opened after mounting closed, traps native Tab, handles Escape and restores the opener", async () => {
  // jsdom has no layout: expose the same visible controls the browser reports.
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.parentElement;
  });
  const opener = await openDialog();
  screen.getByRole("button", { name: "Last" }).focus();
  expect(key("Tab").defaultPrevented).toBe(true);
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  expect(key("Tab", true).defaultPrevented).toBe(true);
  expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  key("Escape");
  await waitFor(() => expect(opener).toHaveFocus());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("focuses the portaled listbox, commits native arrow/Enter, and reserves Escape for the popup", async () => {
  const onChange = vi.fn();
  render(<Fixture onChange={onChange} />);
  fireEvent.click(screen.getByText("Open"));
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveFocus());
  const trigger = screen.getByRole("button", { name: "Choice Alpha" });
  fireEvent.click(trigger);
  expect(screen.getByRole("listbox")).toHaveFocus();
  expect(screen.getByRole("listbox").parentElement).toBe(document.body);
  key("ArrowDown");
  key("Enter");
  expect(onChange).toHaveBeenCalledWith("b");
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  key("Escape");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(trigger).toHaveFocus();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Choice")).toHaveAttribute("for", trigger.id);
});

it("consumes the backdrop click that dismisses the popup, then allows a subsequent backdrop click", async () => {
  await openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Choice Alpha" }));
  const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
  fireEvent.pointerDown(backdrop);
  fireEvent.click(backdrop);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(backdrop);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("keeps touch option presses selectable and closes when focus leaves", async () => {
  await openDialog();
  const trigger = screen.getByRole("button", { name: "Choice Alpha" });
  fireEvent.click(trigger);
  const option = screen.getByRole("option", { name: "Beta" });
  fireEvent.pointerDown(option, { pointerType: "touch" });
  act(() => option.focus());
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  fireEvent.click(option);
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  act(() => screen.getByRole("textbox").focus());
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("flips above a low trigger and recomputes its viewport position on scroll and resize", async () => {
  await openDialog();
  const trigger = screen.getByRole("button", { name: "Choice Alpha" });
  let top = 700;
  vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => ({
    x: 30,
    y: top,
    top,
    bottom: top + 36,
    left: 30,
    right: 230,
    width: 200,
    height: 36,
    toJSON() {},
  }));
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(180);
  fireEvent.click(trigger);
  const list = screen.getByRole("listbox");
  expect(list.style.bottom).toBe(`${window.innerHeight - top + 4}px`);
  expect(list.style.width).toBe("200px");
  top = 100;
  fireEvent.scroll(window);
  expect(list.style.top).toBe("140px");
  expect(list.style.bottom).toBe("");
  top = 200;
  fireEvent.resize(window);
  expect(list.style.top).toBe("240px");
});

it("focuses the panel when requested and traps Tab even without controls", async () => {
  const view = (open: boolean) => (
    <Modal open={open} onClose={vi.fn()} label="Notice" initialFocus="panel" hideClose>
      Read this notice
    </Modal>
  );
  const { rerender } = render(view(false));
  rerender(view(true));
  const panel = screen.getByRole("dialog");
  await waitFor(() => expect(panel).toHaveFocus());
  expect(key("Tab").defaultPrevented).toBe(true);
  expect(panel).toHaveFocus();
  expect(key("Tab", true).defaultPrevented).toBe(true);
  expect(panel).toHaveFocus();
});

it("consumes a held backdrop press after 700ms without dismissing the dialog", async () => {
  await openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Choice Alpha" }));
  const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
  vi.useFakeTimers();
  try {
    fireEvent.pointerDown(backdrop);
    act(() => vi.advanceTimersByTime(700));
    fireEvent.click(backdrop);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    act(() => vi.advanceTimersByTime(200));
  } finally {
    vi.useRealTimers();
  }
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("lets the first outside press focus a field and activate Save", async () => {
  const save = vi.fn();
  render(
    <>
      <Select value="a" options={[{ value: "a", label: "Alpha" }]} onChange={vi.fn()} />
      <input aria-label="Other field" />
      <button type="button" onClick={save}>
        Save
      </button>
    </>,
  );
  const trigger = screen.getByRole("button", { name: "Alpha" });
  fireEvent.click(trigger);
  const field = screen.getByRole("textbox");
  act(() => {
    field.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    field.focus();
    field.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(field).toHaveFocus();
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  const button = screen.getByRole("button", { name: "Save" });
  fireEvent.pointerDown(button);
  fireEvent.click(button);
  expect(save).toHaveBeenCalledOnce();
});

it("preserves native keyboard highlight when a parent recreates inline options", () => {
  const change = vi.fn();
  const view = () => (
    <Select
      value="a"
      options={[
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ]}
      onChange={change}
    />
  );
  const { rerender } = render(view());
  fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
  key("ArrowDown");
  const active = document.activeElement?.getAttribute("aria-activedescendant");
  rerender(view());
  expect(document.activeElement?.getAttribute("aria-activedescendant")).toBe(active);
  key("Enter");
  expect(change).toHaveBeenCalledWith("b");
});

it("ignores listbox scrolling when repositioning the popup", async () => {
  await openDialog();
  const trigger = screen.getByRole("button", { name: "Choice Alpha" });
  const measure = vi.spyOn(trigger, "getBoundingClientRect");
  fireEvent.click(trigger);
  measure.mockClear();
  fireEvent.scroll(screen.getByRole("listbox"));
  expect(measure).not.toHaveBeenCalled();
  fireEvent.scroll(window);
  expect(measure).toHaveBeenCalledOnce();
});

it("follows layout shifts each frame and cancels tracking on close and unmount", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  const { unmount } = render(
    <Select value="a" options={[{ value: "a", label: "Alpha" }]} onChange={vi.fn()} />,
  );
  const trigger = screen.getByRole("button", { name: "Alpha" });
  let bottom = 100;
  vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(
    () => ({ left: 20, top: bottom - 30, bottom, width: 120 }) as DOMRect,
  );
  fireEvent.click(trigger);
  expect(screen.getByRole("listbox").style.top).toBe("104px");
  expect(frames.size).toBe(1);
  bottom = 220;
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame(16);
  });
  expect(screen.getByRole("listbox").style.top).toBe("224px");
  expect(frames.size).toBe(1);
  key("Escape");
  expect(frames.size).toBe(0);
  fireEvent.click(trigger);
  expect(frames.size).toBe(1);
  unmount();
  expect(frames.size).toBe(0);
});
