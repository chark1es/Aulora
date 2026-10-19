/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import type { BotDetail } from "../../../../../../packages/convex/convex/lib/botTypes";
import {
  addBotFile,
  type BotFileInput,
  botFilesLimitError,
  botSaveArgs,
  filesDiff,
  removeBotFile,
  renameBotFile,
  setBotFileContent,
} from "./bot-format";
import { useBotAction } from "./use-bot-action";

export interface BotFilesModel {
  readonly files: readonly BotFileInput[];
  readonly activePath: string | null;
  readonly dirty: boolean;
  readonly limitError: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly select: (path: string) => void;
  readonly changeContent: (content: string) => void;
  readonly addFile: (path: string) => void;
  readonly renameFile: (from: string, to: string) => void;
  readonly removeFile: (path: string) => void;
  readonly save: () => void;
}

/**
 * The Code tab's draft state: a working copy of the bot's files with add,
 * rename, delete and save. Only files that actually changed are sent to
 * `bots.saveFiles`, along with the paths the admin deleted.
 */
export function useBotFiles(bot: BotDetail): BotFilesModel {
  const saveFiles = useMutation(api.bots.saveFiles);
  const { busy, error, run } = useBotAction();
  const [files, setFiles] = useState<readonly BotFileInput[]>(() =>
    bot.files.map((file) => ({ path: file.path, content: file.content })),
  );
  const [activePath, setActivePath] = useState<string | null>(() => bot.files.at(0)?.path ?? null);

  const diff = filesDiff(bot.files, files);
  const limitError = botFilesLimitError(files);

  const changeContent = (content: string): void => {
    setFiles((current) => setBotFileContent(current, activePath, content));
  };
  const addFile = (path: string): void => {
    setFiles((current) => addBotFile(current, path));
    setActivePath(path);
  };
  const renameFile = (from: string, to: string): void => {
    setFiles((current) => renameBotFile(current, from, to));
    setActivePath((current) => (current === from ? to : current));
  };
  const removeFile = (path: string): void => {
    setFiles((current) => removeBotFile(current, path));
    setActivePath((current) => (current === path ? null : current));
  };
  const save = (): void => {
    if (!diff.dirty || limitError !== null) {
      return;
    }
    void run(() => saveFiles({ botId: bot.id, ...botSaveArgs(diff) }), "Could not save the files.");
  };

  return {
    files,
    activePath,
    dirty: diff.dirty,
    limitError,
    busy,
    error,
    select: setActivePath,
    changeContent,
    addFile,
    renameFile,
    removeFile,
    save,
  };
}
