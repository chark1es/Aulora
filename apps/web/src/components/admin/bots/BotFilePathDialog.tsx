/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Icon, Input, Modal } from "@aulora/ui-web";
import { useState } from "react";
import { validateBotPath } from "./bot-format";

export interface BotFilePathDialogProps {
  readonly mode: "add" | "rename";
  readonly initialPath: string;
  readonly takenPaths: readonly string[];
  readonly onCancel: () => void;
  readonly onSubmit: (path: string) => void;
}

/**
 * A small dialog for a new or renamed file path. The server owns the rule;
 * this mirrors it so an obviously bad path never leaves the browser.
 */
export function BotFilePathDialog({
  mode,
  initialPath,
  takenPaths,
  onCancel,
  onSubmit,
}: BotFilePathDialogProps) {
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState<string | null>(null);
  const adding = mode === "add";

  function submit(): void {
    const invalid = validateBotPath(path, takenPaths);
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    onSubmit(path);
  }

  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      label={adding ? "Add file" : "Rename file"}
      title={adding ? "Add file" : "Rename file"}
      icon={<Icon name="file" size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit}>{adding ? "Add file" : "Rename"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="File path"
          value={path}
          autoComplete="off"
          placeholder="lib/util.ts"
          className="font-mono"
          {...(error !== null ? { error } : {})}
          hint="Relative to the bot’s folder."
          onChange={(event) => {
            setPath(event.currentTarget.value);
            setError(null);
          }}
        />
      </div>
    </Modal>
  );
}
