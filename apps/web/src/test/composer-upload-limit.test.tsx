import { MESSAGE_MAX_LENGTH } from "@aulora/core";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../components/chat/Composer";
import { AttachmentSizeError, attachmentUploadErrorMessage } from "../lib/attachments";

describe("Composer upload limit", () => {
  const base = {
    channelId: "c1",
    members: [{ userId: "u-ada", displayName: "Ada" }],
    roles: [],
    memberIds: ["u-ada", "me"],
    onTyping: vi.fn(),
    onSend: vi.fn(),
  };

  function dropFile(file: File): void {
    fireEvent.drop(window, { dataTransfer: { files: [file], types: ["Files"] } });
  }

  it("sends a body at the trimmed limit even with trailing whitespace", async () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: `${"x".repeat(MESSAGE_MAX_LENGTH)}   ` },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    });
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: "x".repeat(MESSAGE_MAX_LENGTH) }),
    );
  });

  it("gives simultaneous composer errors unique description ids", () => {
    render(
      <>
        <Composer {...base} channelId="channel-errors" />
        <Composer {...base} channelId="thread-errors" />
      </>,
    );
    for (const textbox of screen.getAllByRole("combobox")) {
      fireEvent.change(textbox, { target: { value: "x".repeat(MESSAGE_MAX_LENGTH + 1) } });
    }
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]?.id).not.toBe(alerts[1]?.id);
    for (const alert of alerts) {
      expect(document.querySelector(`[aria-describedby="${alert.id}"]`)).not.toBeNull();
    }
  });

  it("rejects an over-limit file with a specific alert and does not attach it", () => {
    render(<Composer {...base} maxUploadBytes={1000} />);
    const oversized = new File([new Uint8Array(2000)], "big.bin", {
      type: "application/octet-stream",
    });
    dropFile(oversized);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("big.bin");
    expect(alert).toHaveTextContent("2.0 KiB");
    expect(alert).toHaveTextContent("1000 B");
    expect(screen.queryByTestId("composer-attachments")).not.toBeInTheDocument();
  });

  it("attaches a file within the limit and clears the previous error", () => {
    render(<Composer {...base} maxUploadBytes={1000} />);
    dropFile(new File([new Uint8Array(2000)], "big.bin"));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    dropFile(new File(["ok"], "small.txt", { type: "text/plain" }));

    const list = screen.getByTestId("composer-attachments");
    expect(within(list).getByText("small.txt")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("preserves pasted text and rejects an attachment batch exceeding 10 before sending", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    expect(screen.getByRole("combobox")).not.toHaveAttribute("maxlength");
    const files = Array.from({ length: 10 }, (_, i) => new File(["x"], `file-${i}.txt`));
    fireEvent.drop(window, { dataTransfer: { files, types: ["Files"] } });
    expect(within(screen.getByTestId("composer-attachments")).getAllByRole("button")).toHaveLength(
      10,
    );
    dropFile(new File(["x"], "eleventh.txt"));
    expect(screen.getByRole("alert")).toHaveTextContent("up to 10 files");
    expect(screen.queryByText("eleventh.txt")).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("attachmentUploadErrorMessage", () => {
  it("names the file and both sizes for a client-side over-limit error", () => {
    expect(attachmentUploadErrorMessage(new AttachmentSizeError("clip.mov", 2000, 1000))).toBe(
      "clip.mov is 2.0 KiB, over the 1000 B limit.",
    );
  });

  it("reports the server's cap when the error carries it", () => {
    expect(
      attachmentUploadErrorMessage(new Error("File exceeds the upload size cap (26214400 bytes)")),
    ).toBe("That file is over the upload size limit (25 MiB).");
  });

  it("treats a 413 from an intermediary as an oversize rejection", () => {
    expect(attachmentUploadErrorMessage(new Error("Upload failed (HTTP 413)"))).toBe(
      "That file is over the upload size limit.",
    );
  });

  it("treats a network failure as a connection problem", () => {
    expect(attachmentUploadErrorMessage(new TypeError("Failed to fetch"))).toMatch(/connection/i);
  });

  it("hides unrecognized upload details", () => {
    expect(attachmentUploadErrorMessage(new Error("Upload failed (HTTP 500)"))).toBe(
      "Couldn’t upload that attachment.",
    );
  });
});
