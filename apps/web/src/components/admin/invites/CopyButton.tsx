import { Button, Icon } from "@aulora/ui-web";
import { useClipboardCopy } from "../useClipboardCopy";

/** Copies `value` to the clipboard and confirms for a moment. */
export function CopyButton({
  value,
  label = "Copy",
}: {
  readonly value: string;
  readonly label?: string;
}) {
  const { copied, copy } = useClipboardCopy(value);
  return (
    <Button type="button" variant="secondary" size="sm" onClick={copy}>
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copied" : label}
    </Button>
  );
}
