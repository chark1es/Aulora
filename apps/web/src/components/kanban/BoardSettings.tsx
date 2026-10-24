import type { KanbanBoardContent } from "@aulora/core";
import {
  Button,
  ConfirmDialog,
  DialogToggleRow,
  Icon,
  Input,
  Modal,
  ModalFooter,
  Textarea,
} from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { BoardLabels } from "./BoardLabels";
import { ColumnList } from "./ColumnList";
import { PeoplePicker } from "./controls";
import { type Board, type BoardMember, type Card, failure } from "./types";

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
        title="Board settings"
        icon={<Icon name="kanban" size={18} />}
        size="lg"
        className="[&>footer]:flex-wrap"
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
        <div className="flex flex-col gap-5">
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
          <div className="border-t border-border/60 pt-5">
            <DialogToggleRow
              icon="lock"
              title="Private board"
              description="Only chosen members and board managers can open it"
              checked={privateBoard}
              onChange={setPrivate}
            />
          </div>
          {privateBoard && (
            <fieldset className="pl-11">
              <legend className="mb-2 text-[12.5px] font-medium text-text-muted">
                Board members
              </legend>
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
          <div className="border-t border-border/60 pt-5">
            <ColumnList
              boardId={board.id}
              columns={draft.columns}
              cards={cards}
              onChange={(columns) => {
                setDraft((current) => ({ ...current, columns }));
              }}
            />
          </div>
          <div className="border-t border-border/60 pt-5">
            <BoardLabels
              labels={draft.labels}
              onChange={(labels) => {
                setDraft((current) => ({ ...current, labels }));
              }}
            />
          </div>
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
