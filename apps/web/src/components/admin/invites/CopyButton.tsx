import { Button, Icon } from "@aulora/ui-web";
import { useState } from "react";

/** Copies `value` to the clipboard and confirms for a moment. */
export function CopyButton({
  value,
  label = "Copy",
}: {
  readonly value: string;
  readonly label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1800);
          })
          .catch(() => undefined);
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copied" : label}
    </Button>
  );
}
