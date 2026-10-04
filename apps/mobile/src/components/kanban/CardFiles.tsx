import { isKanbanGithubLink } from "@aulora/core";
import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { useState } from "react";
import { Linking, Pressable, TextInput, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { field } from "./CardChecklist";
import { SectionTitle } from "./parts";
import type { CardEditor } from "./use-card-editor";
import type { CardFiles } from "./use-card-files";

interface SectionProps {
  readonly editor: CardEditor;
}

interface RemoveButtonProps {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

function RemoveButton({ label, disabled = false, onPress }: RemoveButtonProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      className="h-9 w-9 items-center justify-center rounded-input active:bg-surface-3"
      onPress={onPress}
    >
      <Icon name="x" size={16} color={palette["text-muted"]} />
    </Pressable>
  );
}

function AddLink({ editor }: SectionProps) {
  const palette = usePalette();
  const [text, setText] = useState("");
  const { draft } = editor;
  const add = () => {
    const url = text.trim();
    if (!isKanbanGithubLink(url)) {
      editor.setError("Paste the link of a GitHub repository, issue or pull request.");
      return;
    }
    editor.setError(undefined);
    editor.setDraft({ ...draft, githubLinks: [...new Set([...draft.githubLinks, url])] });
    setText("");
  };
  return (
    <View className="flex-row gap-2">
      <TextInput
        accessibilityLabel="GitHub link"
        placeholder="Paste a GitHub link"
        placeholderTextColor={palette["text-muted"]}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="done"
        submitBehavior="submit"
        value={text}
        onChangeText={setText}
        onSubmitEditing={add}
        className={`flex-1 ${field}`}
      />
      <Button variant="secondary" disabled={!text.trim()} onPress={add}>
        Link
      </Button>
    </View>
  );
}

/** Repositories, issues and pull requests linked to the card. */
export function CardLinks({ editor }: SectionProps) {
  const { draft } = editor;
  return (
    <View className="gap-2">
      <SectionTitle icon="link" title="GitHub links" />
      {draft.githubLinks.map((url) => (
        <Animated.View
          key={url}
          entering={FadeInDown.duration(180)}
          exiting={FadeOut.duration(120)}
          className="flex-row items-center"
        >
          <Pressable
            accessibilityRole="link"
            className="min-h-11 flex-1 justify-center active:opacity-70"
            onPress={() => {
              void Linking.openURL(url);
            }}
          >
            <Text size="sm" tone="accent" numberOfLines={2}>
              {url.replace("https://github.com/", "")}
            </Text>
          </Pressable>
          {editor.canEdit && (
            <RemoveButton
              label={`Unlink ${url}`}
              onPress={() => {
                editor.setDraft({
                  ...draft,
                  githubLinks: draft.githubLinks.filter((entry) => entry !== url),
                });
              }}
            />
          )}
        </Animated.View>
      ))}
      {draft.githubLinks.length === 0 && !editor.canEdit && (
        <Text size="sm" tone="muted">
          No linked repositories, issues or pull requests.
        </Text>
      )}
      {editor.canEdit && draft.githubLinks.length < 20 && <AddLink editor={editor} />}
    </View>
  );
}

type StoredFile = NonNullable<CardFiles["files"]>[number];

interface FileRowProps extends SectionProps {
  readonly file: StoredFile;
  readonly files: CardFiles;
}

function FileRow({ editor, file, files }: FileRowProps) {
  const palette = usePalette();
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOut.duration(120)}
      className="flex-row items-center gap-2"
    >
      <Icon name="file" size={18} color={palette["text-muted"]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Download ${file.name ?? "attachment"}`}
        disabled={editor.busy}
        className="min-h-11 flex-1 justify-center active:opacity-70"
        onPress={() => {
          files.share(file);
        }}
      >
        <Text size="sm" numberOfLines={1}>
          {file.name ?? "Attachment"}
        </Text>
        <Text size="xs" tone="muted">
          {Math.ceil(file.sizeBytes / 1024)} KB
        </Text>
      </Pressable>
      {editor.canAttach && (
        <RemoveButton
          label={`Remove attachment ${file.name ?? ""}`}
          disabled={editor.busy}
          onPress={() => {
            files.remove(file.id);
          }}
        />
      )}
    </Animated.View>
  );
}

/** Files attached to the card; a tap hands one to the system share sheet. */
export function CardAttachments({ editor, files }: SectionProps & { readonly files: CardFiles }) {
  const palette = usePalette();
  const blocked = editor.busy || editor.card.fileIds.length >= 20;
  return (
    <View className="gap-2">
      <SectionTitle icon="paperclip" title="Attachments" />
      {files.files?.map((file) => (
        <FileRow key={file.id} editor={editor} file={file} files={files} />
      ))}
      {editor.card.fileIds.length === 0 && !editor.canAttach && (
        <Text size="sm" tone="muted">
          No attachments.
        </Text>
      )}
      {editor.canAttach && (
        <Pressable
          accessibilityRole="button"
          disabled={blocked}
          className={`min-h-11 flex-row items-center gap-2 self-start rounded-input pr-3 active:bg-surface-3 ${
            blocked ? "opacity-50" : ""
          }`}
          onPress={() => {
            editor.setPicker("attach");
          }}
        >
          <Icon name="plus" size={18} color={palette["text-muted"]} />
          <Text size="sm" tone="muted">
            Add an attachment
          </Text>
        </Pressable>
      )}
    </View>
  );
}
