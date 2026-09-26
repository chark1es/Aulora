import type { AttachmentDescriptor } from "@aulora/core";
import { Text } from "@aulora/ui-web";
import { useCallback, useEffect, useState } from "react";
import { loadAttachmentUrl, loadThumbnailUrl } from "../../lib/attachments";
import type { ChatRuntime } from "../../lib/chat-runtime";
import { blurhashToDataUrl } from "../../lib/image";

export interface AttachmentViewProps {
  readonly runtime: ChatRuntime | undefined;
  readonly descriptor: AttachmentDescriptor;
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One decrypted attachment. Images show an encrypted thumbnail (with a blurhash
 * placeholder) and open the decrypted full image on click; other files download
 * locally after decrypting.
 */
export function AttachmentView({ runtime, descriptor }: AttachmentViewProps) {
  const isImage = descriptor.mime.startsWith("image/") || descriptor.thumbnail !== undefined;
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);
  const [fullUrl, setFullUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (runtime === undefined || !isImage) {
      return;
    }
    let cancelled = false;
    let objectUrl: string | undefined;
    void loadThumbnailUrl(runtime.port, descriptor)
      .then((url) => {
        objectUrl = url;
        if (!cancelled && url !== undefined) {
          setThumbnailUrl(url);
        }
      })
      .catch(() => {
        // Thumbnail is best-effort; the full image still works.
      });
    return () => {
      cancelled = true;
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [runtime, descriptor, isImage]);

  const openFull = useCallback(() => {
    if (runtime === undefined || fullUrl !== undefined) {
      return;
    }
    setBusy(true);
    void loadAttachmentUrl(runtime.port, descriptor)
      .then((url) => {
        setFullUrl(url);
      })
      .catch(() => {
        setError("Unable to decrypt this attachment.");
      })
      .finally(() => setBusy(false));
  }, [runtime, descriptor, fullUrl]);

  const closeFull = useCallback(() => {
    if (fullUrl !== undefined) {
      URL.revokeObjectURL(fullUrl);
    }
    setFullUrl(undefined);
  }, [fullUrl]);

  const download = useCallback(() => {
    if (runtime === undefined) {
      return;
    }
    setBusy(true);
    void loadAttachmentUrl(runtime.port, descriptor)
      .then((url) => {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = descriptor.name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      })
      .catch(() => setError("Unable to decrypt this attachment."))
      .finally(() => setBusy(false));
  }, [runtime, descriptor]);

  if (error !== undefined) {
    return (
      <Text size="xs" tone="danger">
        {error}
      </Text>
    );
  }

  if (isImage) {
    const placeholder = descriptor.blurhash ?? descriptor.thumbnail?.blurhash;
    const background = placeholder !== undefined ? blurhashToDataUrl(placeholder) : undefined;
    return (
      <>
        <button
          type="button"
          onClick={openFull}
          data-testid={`attachment-${descriptor.fileId}`}
          className="relative w-56 overflow-hidden rounded-input border border-border bg-surface-3"
          style={
            background !== undefined && thumbnailUrl === undefined
              ? { backgroundImage: `url(${background})`, backgroundSize: "cover" }
              : undefined
          }
          aria-label={`View ${descriptor.name}`}
        >
          {thumbnailUrl !== undefined ? (
            <img
              src={thumbnailUrl}
              alt={descriptor.name}
              data-testid={`thumbnail-${descriptor.fileId}`}
              className="h-auto w-full"
            />
          ) : (
            <span className="block h-32 w-full" aria-hidden="true" />
          )}
          {busy && (
            <span className="absolute bottom-1 right-1 rounded-pill bg-bg/80 px-2 py-0.5 text-xs text-text-muted">
              Decrypting…
            </span>
          )}
        </button>
        <Text size="xs" tone="muted" mono className="truncate">
          {descriptor.name}
        </Text>
        {fullUrl !== undefined && (
          <div
            data-testid="attachment-lightbox"
            className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 p-6"
            onClick={closeFull}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeFull();
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-label={descriptor.name}
          >
            <img
              src={fullUrl}
              alt={descriptor.name}
              data-testid={`fullimage-${descriptor.fileId}`}
              className="max-h-full max-w-full rounded-card"
            />
          </div>
        )}
      </>
    );
  }

  return (
    <div
      data-testid={`attachment-${descriptor.fileId}`}
      className="flex w-72 items-center gap-2 rounded-input border border-border bg-surface-2 px-3 py-2"
    >
      <span aria-hidden="true" className="text-lg">
        📎
      </span>
      <div className="min-w-0 flex-1">
        <Text size="sm" className="truncate">
          {descriptor.name}
        </Text>
        <Text size="xs" tone="muted" mono>
          {formatBytes(descriptor.size)}
        </Text>
      </div>
      <button
        type="button"
        onClick={download}
        className="rounded-pill border border-border px-2 py-0.5 text-xs text-text-muted hover:text-text"
      >
        Download
      </button>
    </div>
  );
}
