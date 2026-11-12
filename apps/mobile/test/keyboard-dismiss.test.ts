import { expect, it, vi } from "vitest";

const dismissKeyboard = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/keyboard", () => ({ dismissKeyboard }));

import {
  buildAttachMenu,
  buildInputRow,
  type ComposerContext,
} from "../src/components/chat/composer-view-props";

function context(overrides: Partial<ComposerContext>) {
  return overrides as unknown as ComposerContext;
}

it("drops the keyboard before opening the attachment menu", () => {
  const setMenuOpen = vi.fn();
  const row = buildInputRow(
    context({
      props: { channelId: "channel" } as never,
      attach: { busy: false } as never,
      typing: { ping: vi.fn(), stop: vi.fn() } as never,
      setMenuOpen,
    }),
  );
  row.onAttach();
  expect(dismissKeyboard).toHaveBeenCalledTimes(1);
  expect(setMenuOpen).toHaveBeenCalledWith(true);
});

it("drops the keyboard again when an attachment source is picked", () => {
  const setMenuOpen = vi.fn();
  const pick = vi.fn(async () => undefined);
  const menu = buildAttachMenu(context({ setMenuOpen, attach: { pick } as never, menuOpen: true }));
  menu.onPick({ key: "files" } as never);
  expect(dismissKeyboard).toHaveBeenCalledTimes(1);
  expect(setMenuOpen).toHaveBeenCalledWith(false);
  expect(pick).toHaveBeenCalledWith({ key: "files" });
});
