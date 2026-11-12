import type { AttachmentDescriptor } from "@aulora/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentView } from "../components/chat/AttachmentView";
import type { ChatRuntime } from "../lib/chat-runtime";

function runtimeWith(bytes: Uint8Array): ChatRuntime {
  return { port: { downloadFile: vi.fn(async () => bytes) } } as unknown as ChatRuntime;
}

function descriptor(mime: string, name: string): AttachmentDescriptor {
  return { fileId: "f1", name, mime, size: 3 };
}

describe("AttachmentView media playback", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:media");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("plays an audio attachment inline once requested", async () => {
    const runtime = runtimeWith(new Uint8Array([1, 2, 3]));
    render(<AttachmentView runtime={runtime} descriptor={descriptor("audio/mpeg", "memo.mp3")} />);
    expect(screen.queryByTestId("audio-f1")).toBeNull();
    expect(runtime.port.downloadFile).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Play memo.mp3" }));

    const player = await screen.findByTestId("audio-f1");
    expect(player.getAttribute("src")).toBe("blob:media");
    expect(screen.queryByRole("button", { name: "Play memo.mp3" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("plays a video attachment inline and releases it on unmount", async () => {
    const runtime = runtimeWith(new Uint8Array([1, 2, 3]));
    const view = render(
      <AttachmentView runtime={runtime} descriptor={descriptor("video/mp4", "demo.mp4")} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Play demo.mp4" }));
    expect((await screen.findByTestId("video-f1")).tagName).toBe("VIDEO");

    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media");
  });

  it("offers only a download for other files", () => {
    const runtime = runtimeWith(new Uint8Array([1]));
    render(
      <AttachmentView runtime={runtime} descriptor={descriptor("application/pdf", "spec.pdf")} />,
    );
    expect(screen.queryByRole("button", { name: /Play/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("renders the server thumbnail without downloading the original", async () => {
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([9, 9, 9]), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const runtime = runtimeWith(new Uint8Array([1, 2, 3]));
    render(
      <AttachmentView
        runtime={runtime}
        descriptor={{
          ...descriptor("image/png", "pic.png"),
          thumbnail: { fileId: "f1", url: "https://example.test/thumb" },
        }}
      />,
    );
    expect(await screen.findByTestId("thumbnail-f1")).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith("https://example.test/thumb");
    // The full original is not fetched for the inline grid.
    expect(runtime.port.downloadFile).not.toHaveBeenCalled();
  });
});

it("revokes a thumbnail that resolves after unmount", async () => {
  let resolve: ((bytes: Uint8Array) => void) | undefined;
  const runtime = {
    port: {
      downloadFile: () =>
        new Promise<Uint8Array>((done) => {
          resolve = done;
        }),
    },
  } as unknown as ChatRuntime;
  URL.createObjectURL = vi.fn(() => "blob:late");
  URL.revokeObjectURL = vi.fn();
  const view = render(
    <AttachmentView
      runtime={runtime}
      descriptor={{ ...descriptor("image/png", "late.png"), thumbnail: { fileId: "thumb" } }}
    />,
  );
  view.unmount();
  resolve?.(new Uint8Array([1]));
  await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:late"));
});

it("labels the lightbox dialog and restores focus to its trigger", async () => {
  URL.createObjectURL = vi.fn(() => "blob:image");
  URL.revokeObjectURL = vi.fn();
  render(
    <AttachmentView
      runtime={runtimeWith(new Uint8Array([1]))}
      descriptor={descriptor("image/png", "photo.png")}
    />,
  );
  const trigger = screen.getByRole("button", { name: /photo.png/ });
  await userEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "photo.png" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  await userEvent.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
});

it("fits the image against a dark backdrop and closes on wrapper clicks", async () => {
  URL.createObjectURL = vi.fn(() => "blob:image");
  URL.revokeObjectURL = vi.fn();
  render(
    <AttachmentView
      runtime={runtimeWith(new Uint8Array([1]))}
      descriptor={descriptor("image/png", "tall.png")}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /tall.png/ }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.parentElement?.className).toContain("bg-black/85");
  const wrapper = screen.getByTestId("attachment-lightbox");
  expect(wrapper.className).toContain("h-full w-full");
  const image = screen.getByTestId("fullimage-f1");
  expect(image.className).toContain("object-contain");
  fireEvent.click(image);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(wrapper);
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
