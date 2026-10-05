import { type AttachmentDescriptor, Permission } from "@aulora/core";
import { Alert } from "react-native";
import { type PickedFile, uploadPickedFiles } from "../../lib/attachments";
import {
  banMember,
  getUserNote,
  kickMember,
  setUserNote,
  timeoutMember,
} from "../../lib/backend-actions";
import { CallScreen } from "../voice/CallScreen";
import { IncomingCallModal } from "../voice/IncomingCallModal";
import { BannedMembersSheet } from "./BannedMembersSheet";
import { BottomSheet, useLingering } from "./BottomSheet";
import { CreateChannelSheet } from "./CreateChannelSheet";
import { errorMessage } from "./chat-screen-types";
import { EditChannelSheet } from "./EditChannelSheet";
import { ListGroup, ListRow } from "./List";
import { MemberActionsSheet } from "./MemberActionsSheet";
import { MemberProfileSheet } from "./MemberProfileSheet";
import { NewConversationSheet } from "./NewConversationSheet";
import { PinnedMessagesSheet } from "./PinnedMessagesSheet";
import { ThreadModal } from "./ThreadModal";
import { UserNoteSheet } from "./UserNoteSheet";
import type { ChatScreenModel } from "./use-chat-screen-model";
import { WorkspaceSwitcherSheet } from "./WorkspaceSwitcherSheet";

export function ChatScreenSheets({ model }: { readonly model: ChatScreenModel }) {
  return (
    <>
      <ThreadSheet model={model} />
      <ChannelActionSheet model={model} />
      <PinnedMessagesOverlay model={model} />
      <MemberProfileOverlay model={model} />
      <MemberActionsOverlay model={model} />
      <WorkspaceSwitcherOverlay model={model} />
      <NewConversationOverlay model={model} />
      <EditChannelOverlay model={model} />
      <BannedMembersOverlay model={model} />
      <CreateChannelOverlay model={model} />
      <UserNoteOverlay model={model} />
      <CallOverlays model={model} />
    </>
  );
}

function ThreadSheet({ model }: { readonly model: ChatScreenModel }) {
  const { channel, runtime } = model;
  if (model.threadRoot === null || channel === undefined || runtime === undefined) {
    return null;
  }
  return (
    <ThreadModal
      runtime={runtime}
      permissions={model.channelPermissions}
      channelId={channel.id}
      channelTitle={model.isDirect ? model.channelTitle : `#${model.channelTitle}`}
      root={model.threadRoot}
      outbox={model.outbox}
      rootText={model.mergedDecrypted.get(model.threadRoot.id) ?? model.threadRoot.body}
      ownUserId={model.ownUserId}
      memberNames={model.memberNames}
      roles={model.roles}
      channels={model.mentionChannelOptions}
      channelNames={model.mentionNames}
      onChannelPress={(name) => {
        const target = model.mentionChannelTargets.find((entry) => entry.name === name);
        if (target !== undefined) {
          model.setThreadRoot(null);
          void model.openChannel(target.channelId);
        }
      }}
      onClose={() => {
        model.setThreadRoot(null);
      }}
      onSendReply={makeReplyHandler(model, channel.id, model.threadRoot.id)}
    />
  );
}

function makeReplyHandler(model: ChatScreenModel, channelId: string, threadRootId: string) {
  return async ({
    text,
    files,
    replyInThread,
  }: {
    readonly text: string;
    readonly files: readonly PickedFile[];
    readonly replyInThread: boolean;
  }) => {
    const runtime = model.runtime;
    if (runtime === undefined) {
      return;
    }
    let attachments: readonly AttachmentDescriptor[] | undefined;
    if (files.length > 0) {
      attachments = await uploadPickedFiles(runtime.port, files);
    }
    if (replyInThread) {
      await model.sendMessage(channelId, text, {
        threadRootId,
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      });
    } else {
      await model.sendMessage(channelId, text, {
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      });
    }
  };
}

function ChannelActionSheet({ model }: { readonly model: ChatScreenModel }) {
  const shown = useLingering(model.channelAction);
  return (
    <BottomSheet
      visible={model.channelAction !== null}
      title={shown === null ? "" : (model.titles.get(shown.id) ?? shown.name)}
      subtitle={shown?.topic ?? undefined}
      onClose={() => {
        model.setChannelAction(null);
      }}
    >
      {shown !== null && <ChannelActionRows model={model} shown={shown} />}
    </BottomSheet>
  );
}

function ChannelActionRows({
  model,
  shown,
}: {
  readonly model: ChatScreenModel;
  readonly shown: NonNullable<ChatScreenModel["channelAction"]>;
}) {
  return (
    <ListGroup>
      <ListRow
        icon={shown.muted === true ? "bell" : "bell-off"}
        title={shown.muted === true ? "Unmute" : "Mute"}
        subtitle={shown.muted === true ? undefined : "No sounds or badges from here"}
        onPress={() => void model.toggleMute(shown)}
      />
      <ListRow
        icon={shown.hidden === true ? "eye" : "eye-off"}
        title={shown.hidden === true ? "Show in list" : "Hide from list"}
        onPress={() => void model.toggleHide(shown)}
      />
      {shown.id === model.activeChannelId && (
        <ListRow icon="check" title="Mark as read" onPress={() => void model.markChannelRead()} />
      )}
      {model.canManageChannels && (shown.kind === "text" || shown.kind === "announcement") && (
        <ListRow
          icon="pencil"
          title="Edit channel"
          chevron
          onPress={() => {
            model.setEditChannelError(null);
            model.setEditChannelModal(shown);
            model.setChannelAction(null);
          }}
        />
      )}
    </ListGroup>
  );
}

function PinnedMessagesOverlay({ model }: { readonly model: ChatScreenModel }) {
  const channel = model.channel;
  if (channel === undefined) {
    return null;
  }
  return (
    <PinnedMessagesSheet
      visible={model.pinsOpen}
      channelId={channel.id}
      memberNames={model.memberNames}
      onClose={() => {
        model.setPinsOpen(false);
      }}
      onOpen={model.setJumpToMessageId}
    />
  );
}

function MemberProfileOverlay({ model }: { readonly model: ChatScreenModel }) {
  const shownProfile = useLingering(model.profileFor);
  if (shownProfile === null) {
    return null;
  }
  const row = model.presence.find((entry) => entry.userId === shownProfile);
  return (
    <MemberProfileSheet
      visible={model.profileFor !== null}
      userId={shownProfile}
      displayName={model.memberNames.get(shownProfile) ?? "Member"}
      status={row?.status ?? "offline"}
      customStatus={row?.customStatus ?? ""}
      ownUserId={model.ownUserId}
      onClose={() => {
        model.setProfileFor(null);
      }}
      onNote={() => {
        model.setNoteFor(shownProfile);
        model.setProfileFor(null);
      }}
      onModerate={
        model.canModerateMembers &&
        shownProfile !== model.ownUserId &&
        shownProfile !== model.ownerUserId
          ? () => {
              model.setProfileFor(null);
              model.setModerationError(null);
              model.setMemberActionsFor(shownProfile);
            }
          : undefined
      }
      onMessage={() => {
        model.setProfileFor(null);
        void model.runtime?.port
          .createDm({ otherUserId: shownProfile })
          .then((result) => model.openChannel(result.channelId))
          .catch((cause: unknown) => {
            Alert.alert("Couldn't start message", errorMessage(cause));
          });
      }}
    />
  );
}

function MemberActionsOverlay({ model }: { readonly model: ChatScreenModel }) {
  const shownMember = useLingering(model.memberActionsFor);
  return (
    <MemberActionsSheet
      visible={model.memberActionsFor !== null}
      memberName={shownMember === null ? "" : (model.memberNames.get(shownMember) ?? shownMember)}
      canKick={model.canKick}
      canBan={model.canBan}
      canTimeout={model.canTimeout}
      busy={model.moderationBusy}
      error={model.moderationError}
      onKick={() => {
        const target = model.memberActionsFor;
        if (target !== null) {
          void model.runModeration((client) => kickMember(client, target));
        }
      }}
      onBan={(options) => {
        const target = model.memberActionsFor;
        if (target !== null) {
          void model.runModeration((client) => banMember(client, target, options));
        }
      }}
      onTimeout={(durationMs) => {
        const target = model.memberActionsFor;
        if (target !== null) {
          void model.runModeration((client) =>
            timeoutMember(
              client,
              target,
              durationMs === undefined ? undefined : Date.now() + durationMs,
            ),
          );
        }
      }}
      onOpenNote={() => {
        const target = model.memberActionsFor;
        if (target !== null) {
          model.setNoteFor(target);
        }
      }}
      onClose={() => {
        model.setMemberActionsFor(null);
        model.setModerationError(null);
      }}
    />
  );
}

function WorkspaceSwitcherOverlay({ model }: { readonly model: ChatScreenModel }) {
  return (
    <WorkspaceSwitcherSheet
      visible={model.workspaceSwitcherOpen}
      onClose={() => {
        model.setWorkspaceSwitcherOpen(false);
      }}
    />
  );
}

function NewConversationOverlay({ model }: { readonly model: ChatScreenModel }) {
  if (!model.newMessageOpen) {
    return null;
  }
  return (
    <NewConversationSheet
      members={model.members}
      ownUserId={model.ownUserId}
      onClose={() => {
        model.setNewMessageOpen(false);
      }}
      onCreate={async (ids) => {
        const runtime = model.runtime;
        if (runtime === undefined) throw new Error("Wait for the workspace to connect.");
        const result =
          ids.length === 1
            ? await runtime.port.createDm({ otherUserId: ids[0] ?? "" })
            : await runtime.port.createGroupDm({ memberIds: ids });
        model.setNewMessageOpen(false);
        await model.openChannel(result.channelId);
      }}
    />
  );
}

function EditChannelOverlay({ model }: { readonly model: ChatScreenModel }) {
  const target = model.editChannelModal;
  if (target === null) {
    return null;
  }
  return (
    <EditChannelSheet
      visible
      channelName={model.titles.get(target.id) ?? target.name}
      channelTopic={target.topic ?? ""}
      isPrivate={target.isPrivate === true}
      initialMemberIds={
        target.isPrivate === true
          ? [...new Set([model.ownUserId, ...(target.memberIds ?? [])])]
          : (target.memberIds ?? [])
      }
      initialBlockedUserIds={(target.overrides ?? [])
        .filter((override) => override.targetType === "member")
        .filter((override) => (override.deny & Permission.ViewChannel) !== 0n)
        .map((override) => override.targetId)}
      ownUserId={model.ownUserId}
      members={model.members}
      busy={model.editChannelBusy}
      error={model.editChannelError}
      onClose={() => {
        model.setEditChannelModal(null);
        model.setEditChannelError(null);
      }}
      onSave={model.submitChannelEdit}
    />
  );
}

function BannedMembersOverlay({ model }: { readonly model: ChatScreenModel }) {
  if (!model.canBan) {
    return null;
  }
  return (
    <BannedMembersSheet
      visible={model.bansOpen}
      memberNames={model.memberNames}
      onClose={() => {
        model.setBansOpen(false);
      }}
    />
  );
}

function CreateChannelOverlay({ model }: { readonly model: ChatScreenModel }) {
  return (
    <CreateChannelSheet
      visible={model.createOpen}
      categories={model.categories}
      busy={model.createBusy}
      error={model.createError}
      onCreateChannel={model.create}
      onCreateCategory={model.createNewCategory}
      onClose={() => {
        model.setCreateOpen(false);
      }}
    />
  );
}

function UserNoteOverlay({ model }: { readonly model: ChatScreenModel }) {
  const noteFor = model.noteFor;
  const runtime = model.runtime;
  if (noteFor === null || runtime === undefined) {
    return null;
  }
  return (
    <UserNoteSheet
      visible
      memberName={model.memberNames.get(noteFor) ?? noteFor}
      loadNote={() => getUserNote(runtime.client, noteFor)}
      onSave={(body) => setUserNote(runtime.client, noteFor, body)}
      onClose={() => {
        model.setNoteFor(null);
      }}
    />
  );
}

function CallOverlays({ model }: { readonly model: ChatScreenModel }) {
  return (
    <>
      <IncomingCallModal
        callerName={(call) => model.memberNames.get(call.initiatorId) ?? call.initiatorId}
      />
      <CallScreen
        channelName={model.channel?.name ?? model.workspaceName}
        memberNames={model.memberNames}
        memberColors={model.memberColors}
      />
    </>
  );
}
