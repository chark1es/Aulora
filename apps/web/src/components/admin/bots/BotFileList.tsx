/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { BOT_LIMITS } from "@aulora/core";
import { Badge, Button, cn, Icon, IconButton, Text } from "@aulora/ui-web";
import type { BotFilesModel } from "./use-bot-files";

interface BotFileListProps {
  readonly model: BotFilesModel;
  readonly entry: string;
  readonly onAdd: () => void;
  readonly onRename: (path: string) => void;
}

/** The bot's files: pick one to edit, or rename, delete and add alongside. */
export function BotFileList({ model, entry, onAdd, onRename }: BotFileListProps) {
  return (
    <section className="flex w-full shrink-0 flex-col gap-2 lg:w-[240px]" aria-label="Bot files">
      <ul className="flex flex-col gap-0.5">
        {model.files.map((file) => {
          const active = file.path === model.activePath;
          return (
            <li
              key={file.path}
              className={cn(
                "group flex items-center gap-1 rounded-[8px] border px-1.5 py-1 transition",
                active
                  ? "border-accent/40 bg-accent-soft"
                  : "border-transparent hover:bg-surface-3",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  model.select(file.path);
                }}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Icon name="file" size={13} className="shrink-0 text-text-muted" />
                <Text as="span" size="xs" mono className="min-w-0 flex-1 truncate">
                  {file.path}
                </Text>
                {file.path === entry && (
                  <Badge size="sm" tone="accent">
                    entry
                  </Badge>
                )}
              </button>
              <IconButton
                label={`Rename ${file.path}`}
                size="sm"
                onClick={() => {
                  onRename(file.path);
                }}
              >
                <Icon name="pencil" size={13} />
              </IconButton>
              <IconButton
                label={`Delete ${file.path}`}
                size="sm"
                variant="danger"
                onClick={() => {
                  model.removeFile(file.path);
                }}
              >
                <Icon name="trash" size={13} />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={model.files.length >= BOT_LIMITS.maxFiles}
        leading={<Icon name="plus" size={13} />}
        onClick={onAdd}
      >
        Add file
      </Button>
    </section>
  );
}
