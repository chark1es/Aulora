import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UserSettingsView } from "../components/chat/UserSettingsView";
import { useSettingsNavigation } from "../lib/use-settings-navigation";

it("defers dirty settings navigation until discard and supports cancellation", () => {
  const action = vi.fn();
  const { result, rerender } = renderHook(({ open, dirty }) => useSettingsNavigation(open, dirty), {
    initialProps: { open: true, dirty: true },
  });
  act(() => result.current.navigate(action));
  expect(action).not.toHaveBeenCalled();
  act(() => result.current.cancel());
  expect(result.current.pending).toBeNull();
  expect(action).not.toHaveBeenCalled();
  act(() => result.current.navigate(action));
  act(() => result.current.discard());
  expect(action).toHaveBeenCalledOnce();
  rerender({ open: true, dirty: false });
  act(() => result.current.navigate(action));
  expect(action).toHaveBeenCalledTimes(2);
});
it("reports profile dirty state to the navigation owner and clears it on unmount", () => {
  const onDirtyChange = vi.fn();
  const view = render(
    <UserSettingsView
      ownUserId="me"
      ownName="Me"
      alignment="left"
      canEditNickname
      isOwner={false}
      onBack={vi.fn()}
      onSave={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  );
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByRole("textbox", { name: "Nickname" }), {
    target: { value: "Unsaved" },
  });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  view.unmount();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});
