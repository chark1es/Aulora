import { beforeEach, expect, it, vi } from "vitest";

const dismissKeyboard = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/keyboard", () => ({ dismissKeyboard }));

import {
  buildAttachMenu,
  buildInputRow,
  type ComposerContext,
} from "../src/components/chat/composer-view-props";

beforeEach(() => {
  dismissKeyboard.mockClear();
});

function input(isFocused: boolean) {
  return { current: { isFocused: () => isFocused, focus: vi.fn() } };
}

function context(overrides: Partial<ComposerContext>) {
  return overrides as unknown as ComposerContext;
}

function openMenu(focused: boolean) {
  const setMenuOpen = vi.fn();
  const inputRef = input(focused);
  const attach = { busy: false, pick: vi.fn() };
  const ctx = context({
    props: { channelId: "channel" } as never,
    attach: attach as never,
    typing: { ping: vi.fn(), stop: vi.fn() } as never,
    inputRef: inputRef as never,
    menuFocus: { current: false },
    setMenuOpen,
    menuOpen: true,
  });
  const row = buildInputRow(ctx);
  const menu = buildAttachMenu(ctx);
  row.onAttach();
  return { attach, ctx, inputRef, menu, setMenuOpen };
}

it("drops the keyboard before opening the attachment menu", () => {
  const { setMenuOpen, inputRef } = openMenu(true);
  expect(dismissKeyboard).toHaveBeenCalledTimes(1);
  expect(setMenuOpen).toHaveBeenCalledWith(true);
  // Opening the sheet never focuses the input while the sheet is up.
  expect(inputRef.current.focus).not.toHaveBeenCalled();
});

it("puts the caret back when the attach sheet is cancelled while typing", () => {
  const { inputRef, menu } = openMenu(true);
  menu.onClose();
  expect(inputRef.current.focus).toHaveBeenCalledTimes(1);
});

it("leaves the keyboard down when the attach sheet is cancelled from an unfocused composer", () => {
  const { inputRef, menu } = openMenu(false);
  menu.onClose();
  expect(inputRef.current.focus).not.toHaveBeenCalled();
});

it("drops the keyboard again when an attachment source is picked", () => {
  const { attach, menu, setMenuOpen } = openMenu(true);
  const option = { key: "files" };
  menu.onPick(option as never);
  expect(dismissKeyboard).toHaveBeenCalledTimes(2);
  expect(setMenuOpen).toHaveBeenLastCalledWith(false);
  expect(attach.pick).toHaveBeenCalledWith(option);
});

it("does not restore the keyboard after a file is picked", () => {
  const { inputRef, menu } = openMenu(true);
  menu.onPick({ key: "files" } as never);
  // The sheet later reports its dismiss after the picker closes.
  menu.onClose();
  expect(inputRef.current.focus).not.toHaveBeenCalled();
});

it("does not restore focus twice if the sheet reports another close", () => {
  const { inputRef, menu } = openMenu(true);
  menu.onClose();
  menu.onClose();
  expect(inputRef.current.focus).toHaveBeenCalledTimes(1);
});
