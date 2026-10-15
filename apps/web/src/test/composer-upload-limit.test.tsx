import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("includes the underlying error for anything else", () => {
    expect(attachmentUploadErrorMessage(new Error("Upload failed (HTTP 500)"))).toBe(
      "Couldn't upload that attachment: Upload failed (HTTP 500)",
    );
  });
});
