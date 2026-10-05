import { Button, ConfirmDialog, Input, Modal, Switch } from "@aulora/ui-web";
import { useState } from "react";
import { BoardSettings } from "./BoardSettings";
import { CardDetail } from "./CardDetail";
import { GithubBrowser } from "./GithubBrowser";
import type { Board } from "./types";
import type { BoardController } from "./use-board";

interface Props {
  ctl: BoardController;
}

/** Names a new board and says whether it starts private. */
function NewBoardModal({ ctl }: Props) {
  const [name, setName] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const close = () => {
    ctl.setNewBoard(false);
  };
  const create = async () => {
    const id = await ctl.mutations.createBoard({
      name,
      private: isPrivate,
      memberIds: [ctl.ownUserId],
    });
    ctl.setBoardId(id);
    ctl.setArchivedBoards(false);
    close();
  };
  return (
    <Modal
      open
      onClose={close}
      label="New board"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="kanban-new-board" disabled={!name.trim()} loading={ctl.busy}>
            Create board
          </Button>
        </>
      }
    >
      <form
        id="kanban-new-board"
        className="flex flex-col gap-4 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          void ctl.run(create);
        }}
      >
        <Input
          label="Board name"
          placeholder="e.g. Website launch"
          maxLength={120}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Switch
          label="Private board"
          checked={isPrivate}
          onChange={setPrivate}
          description="Only you and board managers have access initially. Add members in Board settings."
        />
        {ctl.error !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {ctl.error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** Asks before archiving or deleting the open board, or deleting a card. */
function Confirmations({ ctl, board }: Props & { board: Board }) {
  const { confirm } = ctl;
  const close = () => {
    ctl.setConfirm(undefined);
  };
  return (
    <>
      <ConfirmDialog
        open={confirm?.kind === "deleteBoard"}
        onClose={close}
        title="Permanently delete board?"
        description="All cards, comments, activity and uploaded board files will be deleted. This cannot be undone."
        confirmLabel="Delete board"
        variant="danger"
        onConfirm={() => {
          close();
          void ctl.run(() => ctl.mutations.deleteBoard({ boardId: board.id }));
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === "archiveBoard"}
        onClose={close}
        title="Archive board?"
        description="Work timers will stop. You can restore this board from archived boards."
        confirmLabel="Archive board"
        onConfirm={() => {
          close();
          void ctl.run(() => ctl.mutations.archiveBoard({ boardId: board.id, archived: true }));
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === "deleteCard"}
        onClose={close}
        title="Permanently delete card?"
        description="This deletes the card, comments, activity and attachments that are not used on other cards. It cannot be undone."
        confirmLabel="Delete card"
        variant="danger"
        onConfirm={() => {
          const target = confirm?.kind === "deleteCard" ? confirm.card : undefined;
          close();
          if (target !== undefined)
            void ctl.run(() => ctl.mutations.deleteCard({ cardId: target._id }));
        }}
      />
    </>
  );
}

/** Browses GitHub; with edit rights, picking an item adds it as a card in the first column. */
function GithubDialog({ ctl }: Props) {
  const { board } = ctl;
  const first = board?.columns.at(0);
  const close = () => {
    ctl.setGithub(false);
  };
  if (board === undefined || first === undefined || !ctl.canEdit)
    return <GithubBrowser onClose={close} />;
  return (
    <GithubBrowser
      onClose={close}
      onPick={(item) => {
        close();
        void ctl.run(() =>
          ctl.mutations.createCard({
            boardId: board.id,
            columnId: first.id,
            title: item.title.slice(0, 200),
            githubLink: item.url,
          }),
        );
      }}
    />
  );
}

/** Every dialog the board can open: confirmations, forms and the card itself. */
export function BoardDialogs({ ctl }: Props) {
  const { board } = ctl;
  const detail = ctl.cards?.find((card) => card._id === ctl.selectedCard);
  return (
    <>
      {board !== undefined && <Confirmations ctl={ctl} board={board} />}
      {ctl.newBoard && <NewBoardModal ctl={ctl} />}
      {ctl.settings && board !== undefined && (
        <BoardSettings
          key={board.id}
          board={board}
          members={ctl.members}
          onClose={() => {
            ctl.setSettings(false);
          }}
        />
      )}
      {detail !== undefined && board !== undefined && (
        <CardDetail
          key={detail._id}
          card={detail}
          board={board}
          permissions={ctl.permissions}
          ownUserId={ctl.ownUserId}
          members={ctl.members}
          now={ctl.now}
          onClose={() => {
            ctl.setSelectedCard(undefined);
          }}
        />
      )}
      {ctl.github && <GithubDialog ctl={ctl} />}
    </>
  );
}
