/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Input, Text } from "@aulora/ui-native";
import { useMutation } from "convex/react";
import { useState } from "react";
import { View } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { failure } from "../../lib/kanban";
import { Sheet } from "../chat/Sheet";
import { Toggle } from "./settings-parts";

export function NewBoardSheet({
  ownUserId,
  onCreated,
  onClose,
}: {
  readonly ownUserId: string;
  readonly onCreated: (boardId: string) => void;
  readonly onClose: () => void;
}) {
  const create = useMutation(api.kanban.createBoard);
  const [name, setName] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    create({ name, private: isPrivate, memberIds: [ownUserId] })
      .then((id) => {
        onCreated(id);
        onClose();
      })
      .catch((cause: unknown) => {
        setError(failure(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <Sheet visible title="New board" onClose={onClose}>
      <View className="gap-5 p-4">
        <Input
          label="Board name"
          placeholder="e.g. Website launch"
          autoFocus
          maxLength={120}
          returnKeyType="done"
          value={name}
          onChangeText={setName}
          onSubmitEditing={submit}
        />
        <Toggle
          label="Private board"
          description="Only you and board managers have access at first. Add members in Board settings."
          value={isPrivate}
          onChange={setPrivate}
        />
        {error !== undefined && (
          <Text size="sm" tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        )}
        <Button loading={busy} disabled={!name.trim()} onPress={submit}>
          Create board
        </Button>
      </View>
    </Sheet>
  );
}
