/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { BOT_ENTRY_FILES, BOT_LIMITS } from "@aulora/core";
import { Button, EmptyState, Text } from "@aulora/ui-web";
import { useState } from "react";
import type { BotDetail } from "../../../../../../packages/convex/convex/lib/botTypes";
import { BotFileEditor } from "./BotFileEditor";
import { BotFileList } from "./BotFileList";
import { BotFilePathDialog } from "./BotFilePathDialog";
import { botFileBytes, formatBytes } from "./bot-format";
import { type BotFilesModel, useBotFiles } from "./use-bot-files";

function BotCodeLimits({
  model,
  entry,
}: {
  readonly model: BotFilesModel;
  readonly entry: string;
}) {
  const total = model.files.reduce((sum, file) => sum + botFileBytes(file.content), 0);
  return (
    <Text size="xs" tone="muted">
      Entry file <span className="font-mono">{entry}</span> · {model.files.length}/
      {BOT_LIMITS.maxFiles} files · {formatBytes(total)} of {formatBytes(BOT_LIMITS.maxTotalBytes)}
    </Text>
  );
}

function BotEditorPane({ model }: { readonly model: BotFilesModel }) {
  const file = model.files.find((entry) => entry.path === model.activePath) ?? null;
  if (file === null) {
    return (
      <EmptyState
        size="sm"
        icon="file"
        title="No file selected"
        description="Pick a file on the left, or add one."
        className="flex-1"
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <BotFileEditor
        path={file.path}
        content={file.content}
        disabled={model.busy}
        onChange={(content) => {
          model.changeContent(content);
        }}
      />
      {model.limitError !== null && (
        <Text role="alert" tone="danger" size="sm">
          {model.limitError}
        </Text>
      )}
      {model.error !== null && (
        <Text role="alert" tone="danger" size="sm">
          {model.error}
        </Text>
      )}
      <div className="flex items-center gap-2">
        <Button
          loading={model.busy}
          disabled={model.busy || !model.dirty || model.limitError !== null}
          onClick={() => {
            model.save();
          }}
        >
          Save files
        </Button>
        {model.dirty && (
          <Text size="xs" tone="muted">
            Unsaved changes
          </Text>
        )}
      </div>
    </div>
  );
}

interface DialogState {
  readonly mode: "add" | "rename";
  readonly path: string;
}

/** The Code tab: the file list beside a dependency-free editor and Save. */
export function BotCodeTab({ bot }: { readonly bot: BotDetail }) {
  const model = useBotFiles(bot);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const entry = BOT_ENTRY_FILES[bot.language];

  return (
    <div className="flex flex-col gap-4" data-testid="bot-code">
      <BotCodeLimits model={model} entry={entry} />
      <div className="flex flex-col gap-4 lg:flex-row">
        <BotFileList
          model={model}
          entry={entry}
          onAdd={() => {
            setDialog({ mode: "add", path: "" });
          }}
          onRename={(path) => {
            setDialog({ mode: "rename", path });
          }}
        />
        <BotEditorPane model={model} />
      </div>
      {dialog !== null && (
        <BotFilePathDialog
          mode={dialog.mode}
          initialPath={dialog.path}
          takenPaths={
            dialog.mode === "rename"
              ? model.files.filter((file) => file.path !== dialog.path).map((file) => file.path)
              : model.files.map((file) => file.path)
          }
          onCancel={() => {
            setDialog(null);
          }}
          onSubmit={(path) => {
            if (dialog.mode === "add") {
              model.addFile(path);
            } else {
              model.renameFile(dialog.path, path);
            }
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
