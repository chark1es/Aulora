import type { KanbanBoardContent } from "@aulora/core";
import {
  Button,
  ConfirmDialog,
  Icon,
  IconButton,
  Input,
  Modal,
  ModalFooter,
  Switch,
  Textarea,
} from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { ColumnList } from "./ColumnList";
import { PeoplePicker } from "./controls";
import { type Board, type BoardMember, type Card, failure, newItemId } from "./types";

export function BoardSettings({
  board,
  members,
  cards,
  onClose,
}: {
  board: Board;
  members: readonly BoardMember[];
  /** The board's cards, used to show how full each column is; optional while they load. */
  cards?: readonly Card[] | undefined;
  onClose: () => void;
}) {
  const update = useMutation(api.kanban.updateBoard);
  const archive = useMutation(api.kanban.archiveBoard);
  const [draft, setDraft] = useState<KanbanBoardContent>({
    name: board.name,
    description: board.description,
    columns: board.columns,
    labels: board.labels,
  });
  const [privateBoard, setPrivate] = useState(board.private);
  const [memberIds, setMembers] = useState(board.memberIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty =
    JSON.stringify(draft) !==
      JSON.stringify({
        name: board.name,
        description: board.description,
        columns: board.columns,
        labels: board.labels,
      }) ||
    privateBoard !== board.private ||
    JSON.stringify(memberIds) !== JSON.stringify(board.memberIds);
  const close = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await update({
        boardId: board.id,
        expectedUpdatedAt: board.updatedAt,
        ...draft,
        private: privateBoard,
        memberIds,
      });
      onClose();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Modal
        open
        onClose={close}
        label="Board settings"
        size="lg"
        className="flex max-h-[calc(100dvh-32px)] flex-col [&>div]:min-h-0 [&>div]:overflow-y-auto [&>footer]:shrink-0 [&>footer]:flex-wrap [&>header]:shrink-0"
        footer={
          <ModalFooter
            destructive={
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmArchive(true);
                }}
              >
                Archive board
              </Button>
            }
          >
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              Save board
            </Button>
          </ModalFooter>
        }
      >
        <div className="flex flex-col gap-5 pb-4">
          <Input
            label="Board name"
            maxLength={120}
            value={draft.name}
            onChange={(e) => {
              setDraft({ ...draft, name: e.target.value });
            }}
          />
          <Textarea
            label="Description"
            rows={3}
            maxLength={5000}
            value={draft.description}
            onChange={(e) => {
              setDraft({ ...draft, description: e.target.value });
            }}
          />
          <Switch
            label="Private board"
            description="Only selected members and board managers can access it. Workspace Kanban permissions still apply."
            checked={privateBoard}
            onChange={setPrivate}
          />
          {privateBoard && (
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium">Board members</legend>
              <PeoplePicker
                label="Board members"
                addLabel="Add members"
                members={members}
                selected={memberIds}
                onChange={setMembers}
                editable
                emptyText="No members"
              />
            </fieldset>
          )}
          <ColumnList
            boardId={board.id}
            columns={draft.columns}
            cards={cards}
            onChange={(columns) => {
              setDraft((current) => ({ ...current, columns }));
            }}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-medium">Labels</legend>
            {draft.labels.map((l) => (
              <div key={l.id} className="flex items-end gap-2 [&>button]:mb-1.5">
                <Input
                  label="Label name"
                  maxLength={50}
                  value={l.name}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      labels: draft.labels.map((entry) =>
                        entry.id === l.id ? { ...entry, name: e.target.value } : entry,
                      ),
                    });
                  }}
                />
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                  Color
                  <input
                    type="color"
                    aria-label={`Color for ${l.name}`}
                    value={l.color}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        labels: draft.labels.map((entry) =>
                          entry.id === l.id ? { ...entry, color: e.target.value } : entry,
                        ),
                      });
                    }}
                    className="h-10 w-10 bg-transparent"
                  />
                </label>
                <IconButton
                  size="sm"
                  variant="danger"
                  label={`Remove ${l.name} label`}
                  onClick={() => {
                    setDraft({
                      ...draft,
                      labels: draft.labels.filter((entry) => entry.id !== l.id),
                    });
                  }}
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={draft.labels.length >= 50}
              onClick={() => {
                setDraft({
                  ...draft,
                  labels: [
                    ...draft.labels,
                    { id: newItemId(), name: "New label", color: "#d47838" },
                  ],
                });
              }}
            >
              Add label
            </Button>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={discard}
        onClose={() => {
          setDiscard(false);
        }}
        title="Discard unsaved board settings?"
        confirmLabel="Discard changes"
        onConfirm={onClose}
      />
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => {
          setConfirmArchive(false);
        }}
        title="Archive board?"
        description="Work timers will stop. You can restore this board from archived boards."
        confirmLabel="Archive board"
        onConfirm={() => {
          setError(null);
          archive({ boardId: board.id, archived: true })
            .then(onClose)
            .catch((cause: unknown) => {
              setError(failure(cause));
            });
        }}
      />
    </>
  );
}
