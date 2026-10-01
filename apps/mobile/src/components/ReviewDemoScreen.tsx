import type { AttachmentDescriptor, ChannelSummary, MessagePayload } from "@aulora/core";
import { Button, Heading, Input, Spinner, Text } from "@aulora/ui-native";
import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, ScrollView, View } from "react-native";
import { type PickedFile, uploadPickedFiles } from "../lib/attachments";
import {
  createReviewDemo,
  REVIEW_MEMBERS,
  REVIEW_USER_ID,
  type ReviewDemo,
  reviewChannelTitle,
} from "../lib/review-demo";
import { useChannelSession } from "../lib/use-channel";
import { Composer } from "./chat/Composer";
import { MemberAvatar } from "./chat/MemberAvatar";
import { MessageList } from "./chat/MessageList";
import { ThreadModal } from "./chat/ThreadModal";

const memberNames = new Map(REVIEW_MEMBERS.map((member) => [member.userId, member.displayName]));
const emptyColors = new Map<string, string>();
const noPending = new Set<string>();

/** The native chat controls over a disposable local workspace, without auth or push. */
export function ReviewDemoScreen({ onExit }: { readonly onExit: () => void }) {
  const [demo, setDemo] = useState<ReviewDemo | undefined>();
  const [channels, setChannels] = useState<readonly ChannelSummary[]>([]);
  const [channelId, setChannelId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"channels" | "members" | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [threadRoot, setThreadRoot] = useState<MessagePayload | null>(null);
  const state = useChannelSession(demo?.runtime, channelId, REVIEW_USER_ID);

  useEffect(() => {
    let cancelled = false;
    let created: ReviewDemo | undefined;
    let off: (() => void) | undefined;
    void createReviewDemo()
      .then((workspace) => {
        if (cancelled) {
          workspace.dispose();
          return;
        }
        created = workspace;
        off = workspace.port.watchChannels(setChannels);
        setChannelId(workspace.firstChannelId);
        setDemo(workspace);
      })
      .catch(() => {
        if (!cancelled) setError("Could not open the offline demo. Exit and try again.");
      });
    return () => {
      cancelled = true;
      off?.();
      created?.dispose();
    };
  }, []);

  const channel = channels.find((row) => row.id === channelId);
  const channelNames = useMemo(
    () =>
      new Map(
        channels
          .filter((row) => row.kind === "text" || row.kind === "announcement")
          .map((row) => [row.id, reviewChannelTitle(row)]),
      ),
    [channels],
  );
  const channelTargets = useMemo(
    () => [...channelNames].map(([id, name]) => ({ id, name })),
    [channelNames],
  );
  const attachments = useMemo(() => {
    const result = new Map<string, readonly AttachmentDescriptor[]>();
    for (const message of state.messages) {
      if (!state.decrypted.has(message.id)) continue;
      const files = demo?.runtime.session.attachmentsFor(message.id) ?? [];
      if (files.length > 0) result.set(message.id, files);
    }
    return result;
  }, [demo, state.messages, state.decrypted]);

  function openChannel(id: string) {
    setChannelId(id);
    setSheet(null);
    setThreadRoot(null);
    setQuery("");
    setSearchOpen(false);
  }

  async function send(text: string, files: readonly PickedFile[], root?: string) {
    if (demo === undefined || channelId === undefined) return;
    const descriptors = await uploadPickedFiles(demo.port, files);
    await demo.runtime.session.sendMessage(channelId, text, {
      ...(root !== undefined ? { threadRootId: root } : {}),
      ...(descriptors.length > 0 ? { attachmentIds: descriptors.map((file) => file.fileId) } : {}),
    });
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-bg" behavior="padding">
      <View className="flex-row items-center justify-between border-b border-border px-4 py-2">
        <Heading level={3}>Acme Studio</Heading>
        <Button style={{ minHeight: 44 }} variant="ghost" onPress={onExit}>
          Exit demo
        </Button>
      </View>
      <View className="gap-1 bg-surface-2 px-4 py-3">
        <Text size="sm">Offline App Review demo</Text>
        <Text size="sm" tone="muted">
          No server connection. Changes reset when you exit.
        </Text>
      </View>
      {demo === undefined ? (
        <View className="flex-1 items-center justify-center px-4">
          {error === null ? (
            <Spinner label="Opening offline demo" />
          ) : (
            <Text tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          )}
        </View>
      ) : (
        <>
          <View className="flex-row flex-wrap items-center justify-between border-b border-border px-2 py-1">
            <Button style={{ minHeight: 44 }} variant="ghost" onPress={() => setSheet("channels")}>
              {`${channel?.kind === "text" || channel?.kind === "announcement" ? "# " : ""}${channel === undefined ? "Channels" : reviewChannelTitle(channel)}`}
            </Button>
            <View className="flex-row">
              <Button
                style={{ minHeight: 44 }}
                variant="ghost"
                onPress={() => setSearchOpen((current) => !current)}
              >
                Search
              </Button>
              <Button style={{ minHeight: 44 }} variant="ghost" onPress={() => setSheet("members")}>
                Members
              </Button>
            </View>
          </View>
          {searchOpen && (
            <View className="gap-2 border-b border-border px-4 py-3">
              <Input
                label="Search demo messages"
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                returnKeyType="search"
              />
              {query.trim().length > 0 && (
                <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
                  {demo.search(query).map((hit) => (
                    <Button
                      style={{ minHeight: 44 }}
                      key={hit.messageId}
                      variant="ghost"
                      onPress={() => openChannel(hit.channelId)}
                    >
                      {hit.snippet}
                    </Button>
                  ))}
                  {demo.search(query).length === 0 && <Text tone="muted">No messages found.</Text>}
                </ScrollView>
              )}
            </View>
          )}
          {channelId !== undefined && (
            <>
              <MessageList
                runtime={demo.runtime}
                channelId={channelId}
                messages={state.messages}
                decrypted={state.decrypted}
                attachments={attachments}
                pendingIds={noPending}
                ownUserId={REVIEW_USER_ID}
                memberNames={memberNames}
                memberColors={emptyColors}
                channelNames={channelNames}
                firstUnreadId={null}
                onReply={setThreadRoot}
                onChannelPress={(name) => {
                  const target = channels.find((row) => row.name === name);
                  if (target !== undefined) openChannel(target.id);
                }}
                onJumpToFirstUnread={() => undefined}
              />
              <View className="flex-row items-center justify-between border-t border-border px-4 py-1">
                <Text size="xs" tone="muted">
                  Calls and push need your own server.
                </Text>
                <Button
                  style={{ minHeight: 44 }}
                  variant="ghost"
                  onPress={() =>
                    Alert.alert(
                      "Offline demo",
                      "Voice, video and push delivery require a real server and another device. No call is made in this demo.",
                    )
                  }
                >
                  Calls
                </Button>
              </View>
              <Composer
                channelId={channelId}
                members={REVIEW_MEMBERS}
                channels={channelTargets}
                viewerName="Alex Rivera"
                onTyping={(id) => {
                  void demo.port.setTyping({ channelId: id });
                }}
                onSend={(input) => send(input.text, input.files)}
              />
            </>
          )}
        </>
      )}
      <Modal
        visible={sheet !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(null)}
      >
        <View className="flex-1 justify-end bg-black/50">
          <View className="max-h-[80%] rounded-t-card bg-surface-1 pb-8">
            <View className="flex-row items-center justify-between border-b border-border px-4 py-2">
              <Heading level={3}>{sheet === "members" ? "Demo members" : "Conversations"}</Heading>
              <Button style={{ minHeight: 44 }} variant="ghost" onPress={() => setSheet(null)}>
                Done
              </Button>
            </View>
            <ScrollView contentContainerStyle={{ padding: 12 }}>
              {sheet === "members"
                ? REVIEW_MEMBERS.map((member) => (
                    <View key={member.userId} className="flex-row items-center gap-3 px-2 py-3">
                      <MemberAvatar userId={member.userId} size={36} />
                      <View>
                        <Text>
                          {member.displayName}
                          {member.userId === REVIEW_USER_ID ? " (you)" : ""}
                        </Text>
                        <Text size="sm" tone="muted">
                          Simulated online presence
                        </Text>
                      </View>
                    </View>
                  ))
                : channels.map((row) => (
                    <Button
                      style={{ minHeight: 44 }}
                      key={row.id}
                      variant={row.id === channelId ? "secondary" : "ghost"}
                      onPress={() => openChannel(row.id)}
                    >
                      {`${row.kind === "text" || row.kind === "announcement" ? "# " : ""}${reviewChannelTitle(row)}`}
                    </Button>
                  ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {demo !== undefined && channelId !== undefined && threadRoot !== null && (
        <ThreadModal
          runtime={demo.runtime}
          channelId={channelId}
          root={threadRoot}
          rootText={demo.runtime.session.decryptedText(threadRoot.id)}
          ownUserId={REVIEW_USER_ID}
          memberNames={memberNames}
          channels={channelTargets}
          channelNames={channelNames}
          onClose={() => setThreadRoot(null)}
          onSendReply={(input) =>
            send(input.text, input.files, input.replyInThread ? threadRoot.id : undefined)
          }
        />
      )}
    </KeyboardAvoidingView>
  );
}
