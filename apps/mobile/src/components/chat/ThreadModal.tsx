import type { MessagePayload, RoleMentionTarget } from "@aulora/core";
import { Button, Card, Heading, Text } from "@aulora/ui-native";
import { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import type { PickedFile } from "../../lib/attachments";
import type { MobileChatRuntime } from "../../lib/chat-runtime";
import { watchThread } from "../../lib/chat-runtime";
import { Composer } from "./Composer";
import { RichText } from "./RichText";

export interface ThreadModalProps {
  readonly runtime: MobileChatRuntime;
  readonly channelId: string;
  readonly root: MessagePayload;
  readonly rootText: string | undefined;
  readonly ownUserId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly roles?: readonly RoleMentionTarget[];
  readonly channels?: readonly { readonly id: string; readonly name: string }[];
  /** Channel/category names `#` may refer to, for rendering. */
  readonly channelNames?: ReadonlyMap<string, string>;
  /** Opens the channel behind a `#channel` mention. */
  readonly onChannelPress?: (name: string) => void;
  readonly onClose: () => void;
  readonly onSendReply: (input: {
    text: string;
    files: readonly PickedFile[];
    replyInThread: boolean;
  }) => void | Promise<void>;
}

/** Bottom-sheet thread: the root message, its replies and an in-thread composer. */
export function ThreadModal({
  runtime,
  channelId,
  root,
  rootText,
  ownUserId,
  memberNames,
  roles = [],
  channels = [],
  channelNames,
  onChannelPress,
  onClose,
  onSendReply,
}: ThreadModalProps) {
  const [replies, setReplies] = useState<readonly MessagePayload[]>([]);
  const [decrypted, setDecrypted] = useState<ReadonlyMap<string, string>>(new Map());
  const [alsoSend, setAlsoSend] = useState(false);
  const mentionNames = useMemo(() => [...memberNames.values()], [memberNames]);
  const channelNameList = useMemo(
    () => (channelNames === undefined ? [] : [...channelNames.values()]),
    [channelNames],
  );
  const viewerName = memberNames.get(ownUserId) ?? "You";

  useEffect(() => {
    const off = watchThread(runtime, root.id, (incoming) => {
      void runtime.session.receiveMessages(incoming).then(() => {
        setReplies(incoming);
        setDecrypted((current) => {
          const next = new Map(current);
          for (const reply of incoming) {
            next.set(reply.id, runtime.session.decryptedText(reply.id));
          }
          return next;
        });
      });
    });
    return () => off();
  }, [runtime, root.id]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <View className="max-h-[85%] rounded-t-card bg-surface-1">
          <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
            <Heading level={3}>Thread</Heading>
            <Button size="sm" variant="ghost" onPress={onClose}>
              Close
            </Button>
          </View>
          <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
            <Card>
              <Text size="sm" className="font-medium">
                {memberNames.get(root.authorId) ?? root.authorId}
              </Text>
              {rootText !== undefined ? (
                <RichText
                  text={rootText}
                  mentionNames={mentionNames}
                  channelNames={channelNameList}
                  viewerName={viewerName}
                  onChannelPress={onChannelPress}
                />
              ) : (
                <Text size="sm" tone="muted">
                  Unable to load this message.
                </Text>
              )}
            </Card>
            {replies.map((reply) => (
              <View key={reply.id} className="px-1">
                <Text size="sm" className="font-medium">
                  {memberNames.get(reply.authorId) ?? reply.authorId}
                  {reply.authorId === ownUserId ? " (you)" : ""}
                </Text>
                {decrypted.get(reply.id) !== undefined ? (
                  <RichText
                    text={decrypted.get(reply.id) ?? ""}
                    mentionNames={mentionNames}
                    channelNames={channelNameList}
                    viewerName={viewerName}
                    onChannelPress={onChannelPress}
                  />
                ) : (
                  <Text size="sm" tone="muted">
                    Unable to load this message.
                  </Text>
                )}
              </View>
            ))}
            {replies.length === 0 && (
              <Text size="sm" tone="muted">
                No replies yet.
              </Text>
            )}
          </ScrollView>
          <Button
            size="sm"
            variant={alsoSend ? "secondary" : "ghost"}
            onPress={() => setAlsoSend(!alsoSend)}
          >
            {alsoSend ? "Also send to channel: on" : "Also send to channel: off"}
          </Button>
          <Composer
            channelId={channelId}
            placeholder="Reply"
            members={[...memberNames.entries()].map(([userId, displayName]) => ({
              userId,
              displayName,
            }))}
            roles={roles}
            channels={channels}
            onTyping={(id) => {
              void runtime.port.setTyping({ channelId: id });
            }}
            onSend={(input) =>
              onSendReply({ text: input.text, files: input.files, replyInThread: !alsoSend })
            }
          />
        </View>
      </View>
    </Modal>
  );
}
