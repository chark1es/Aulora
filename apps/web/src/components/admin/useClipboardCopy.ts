import { useState } from "react";

/** Copies text to the clipboard and reports `copied` for a moment afterwards. */
export function useClipboardCopy(value: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  function copy(): void {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 1800);
      })
      .catch(() => undefined);
  }
  return { copied, copy };
}
