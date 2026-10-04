import type { KanbanBoardContent } from "@aulora/core";
import { Button, ConfirmDialog, Icon, IconButton, Input, Modal, Switch } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { PeoplePicker } from "./controls";
import { type Board, type BoardMember, control, failure, newItemId } from "./types";

export function BoardSettings({
  board,
  members,
  onClose,
}: {
  board: Board;
  members: readonly BoardMember[];
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
          <>
            <Button variant="ghost" onClick={() => setConfirmArchive(true)}>
              Archive board
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              Save board
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5 pb-4">
          <Input
            label="Board name"
            maxLength={120}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <label className="flex flex-col gap-1.5 text-[13px] text-text-muted">
            Description
            <textarea
              className={control}
              rows={3}
              maxLength={5000}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-medium">
              Columns and work-in-progress limits
            </legend>
            <p className="text-xs text-text-muted">
              Remove a column after moving all its cards, including archived cards.
            </p>
            {draft.columns.map((c, index) => (
              <div key={c.id} className="flex flex-wrap items-end gap-1.5 [&>button]:mb-1.5">
                <div className="min-w-[150px] flex-1">
                  <Input
                    label={`Column ${index + 1}`}
                    value={c.name}
                    maxLength={80}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        columns: draft.columns.map((entry) =>
                          entry.id === c.id ? { ...entry, name: e.target.value } : entry,
                        ),
                      })
                    }
                  />
                </div>
                <div className="w-24">
                  <Input
                    label="WIP limit"
                    type="number"
                    min={1}
                    max={500}
                    placeholder="None"
                    value={c.wipLimit ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        columns: draft.columns.map((entry) =>
                          entry.id === c.id
                            ? {
                                id: entry.id,
                                name: entry.name,
                                ...(e.target.value ? { wipLimit: Number(e.target.value) } : {}),
                              }
                            : entry,
                        ),
                      })
                    }
                  />
                </div>
                <IconButton
                  size="sm"
                  disabled={index === 0}
                  label={`Move ${c.name} column left`}
                  onClick={() => {
                    const columns = [...draft.columns];
                    const previous = columns[index - 1];
                    if (previous) {
                      columns[index - 1] = c;
                      columns[index] = previous;
                      setDraft({ ...draft, columns });
                    }
                  }}
                >
                  <Icon name="chevron-left" size={16} />
                </IconButton>
                <IconButton
                  size="sm"
                  disabled={index === draft.columns.length - 1}
                  label={`Move ${c.name} column right`}
                  onClick={() => {
                    const columns = [...draft.columns];
                    const next = columns[index + 1];
                    if (next) {
                      columns[index + 1] = c;
                      columns[index] = next;
                      setDraft({ ...draft, columns });
                    }
                  }}
                >
                  <Icon name="chevron-right" size={16} />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="danger"
                  disabled={draft.columns.length === 1}
                  label={`Remove ${c.name} column`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      columns: draft.columns.filter((entry) => entry.id !== c.id),
                    })
                  }
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={draft.columns.length >= 20}
              onClick={() =>
                setDraft({
                  ...draft,
                  columns: [...draft.columns, { id: newItemId(), name: "New column" }],
                })
              }
            >
              Add column
            </Button>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-medium">Labels</legend>
            {draft.labels.map((l) => (
              <div key={l.id} className="flex items-end gap-2 [&>button]:mb-1.5">
                <Input
                  label="Label name"
                  maxLength={50}
                  value={l.name}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      labels: draft.labels.map((entry) =>
                        entry.id === l.id ? { ...entry, name: e.target.value } : entry,
                      ),
                    })
                  }
                />
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                  Color
                  <input
                    type="color"
                    aria-label={`Color for ${l.name}`}
                    value={l.color}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        labels: draft.labels.map((entry) =>
                          entry.id === l.id ? { ...entry, color: e.target.value } : entry,
                        ),
                      })
                    }
                    className="h-10 w-10 bg-transparent"
                  />
                </label>
                <IconButton
                  size="sm"
                  variant="danger"
                  label={`Remove ${l.name} label`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      labels: draft.labels.filter((entry) => entry.id !== l.id),
                    })
                  }
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
              onClick={() =>
                setDraft({
                  ...draft,
                  labels: [
                    ...draft.labels,
                    { id: newItemId(), name: "New label", color: "#d47838" },
                  ],
                })
              }
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
        onClose={() => setDiscard(false)}
        title="Discard unsaved board settings?"
        confirmLabel="Discard changes"
        onConfirm={onClose}
      />
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title="Archive board?"
        description="Work timers will stop. You can restore this board from archived boards."
        confirmLabel="Archive board"
        onConfirm={async () => {
          setError(null);
          try {
            await archive({ boardId: board.id, archived: true });
            onClose();
          } catch (cause) {
            setError(failure(cause));
          }
        }}
      />
    </>
  );
}
