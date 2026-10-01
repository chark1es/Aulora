import type { AttachmentDescriptor } from "@aulora/core";
import { Icon, Text } from "@aulora/ui-web";
import { useCallback, useEffect, useRef, useState } from "react";
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
 * One attachment. Images show a small thumbnail (with a blurhash placeholder)
 * and open the full image on click; other files download locally. The server
 * seals the bytes at rest and returns them to this device decrypted.
 */
export function AttachmentView({ runtime, descriptor }: AttachmentViewProps) {
  const isImage = descriptor.mime.startsWith("image/") || descriptor.thumbnail !== undefined;
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [fullUrl, setFullUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // Defer thumbnail download until the image is near the viewport, so a long
  // channel does not fetch every image's bytes as soon as it loads.
  const [visible, setVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (visible) {
      return;
    }
    const node = buttonRef.current;
    if (node === null || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (runtime === undefined || !isImage || !visible) {
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
        if (!cancelled) {
          setThumbnailError(true);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [runtime, descriptor, isImage, visible]);

  const openFull = useCallback(() => {
    if (runtime === undefined || fullUrl !== undefined) {
      return;
    }
    setBusy(true);
    void loadAttachmentUrl(runtime.port, descriptor)
      .then((url) => {
        setFullUrl(url);
        setThumbnailError(false);
      })
      .catch(() => {
        setError("Unable to open this attachment.");
      })
      .finally(() => setBusy(false));
  }, [runtime, descriptor, fullUrl]);

  const closeFull = useCallback(() => {
    setFullUrl((current) => {
      if (current !== undefined) {
        URL.revokeObjectURL(current);
      }
      return undefined;
    });
  }, []);

  // Close the lightbox on Escape while it is open.
  useEffect(() => {
    if (fullUrl === undefined) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeFull();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullUrl, closeFull]);

  // If the dedicated thumbnail is unavailable, show the full image
  // as the inline preview instead, so an image always renders.
  useEffect(() => {
    if (runtime === undefined || !isImage || !thumbnailError || !visible) {
      return;
    }
    let cancelled = false;
    void loadAttachmentUrl(runtime.port, descriptor)
      .then((url) => {
        if (!cancelled) {
          setThumbnailUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Unable to open this attachment.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, descriptor, isImage, thumbnailError, visible]);

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
      .catch(() => setError("Unable to open this attachment."))
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
          ref={buttonRef}
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
              loading="lazy"
              decoding="async"
              className="h-auto w-full"
            />
          ) : (
            <span className="block h-32 w-full" aria-hidden="true" />
          )}
          {busy && (
            <span className="absolute bottom-1 right-1 rounded-pill bg-bg/80 px-2 py-0.5 text-xs text-text-muted">
              Loading…
            </span>
          )}
        </button>
        <Text size="xs" tone="muted" mono className="truncate">
          {descriptor.name}
        </Text>
        {fullUrl !== undefined && (
          // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes the lightbox; Escape already handled
          <div
            data-testid="attachment-lightbox"
            className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 p-6"
            onClick={closeFull}
            role="presentation"
          >
            <img
              src={fullUrl}
              alt={descriptor.name}
              data-testid={`fullimage-${descriptor.fileId}`}
              decoding="async"
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
      <Icon name="paperclip" size={20} className="text-text-muted" />
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
