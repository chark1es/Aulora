import type { AttachmentDescriptor } from "@aulora/core";
import { render, screen } from "@testing-library/react";
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
});
