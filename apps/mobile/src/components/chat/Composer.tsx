import {
  BROADCAST_FALLBACK_NOTE,
  createTypingThrottle,
  hasBroadcastToken,
  messageSendError,
  onBroadcastFallback,
  orderMentionSuggestions,
  type RoleMentionTarget,
  resolveMentions,
} from "@aulora/core";
import type { IconName } from "@aulora/tokens";
import { Icon, Text, TextField, usePalette } from "@aulora/ui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  LayoutAnimation,
  Pressable,
  ScrollView,
  type TextInputInstance,
  useWindowDimensions,
  View,
} from "react-native";
import { attachmentUploadErrorMessage } from "../../lib/attachment-errors";
import {
  type PickedFile,
  pickDocuments,
  pickFromCamera,
  pickFromClipboard,
  pickFromLibrary,
} from "../../lib/attachments";
import { remainingComposerFiles } from "../../lib/composer-files";
import { impactFeedback } from "../../lib/haptics";
import {
  attachmentRoom,
  MESSAGE_MAX_ATTACHMENTS,
  MESSAGE_MAX_LENGTH,
  messageLimitError,
} from "../../lib/message-limits";
import { useReduceMotion } from "../../lib/use-entrance";
import { useScreenInsets } from "../layout/ScreenContainer";
import { BottomSheet } from "./BottomSheet";
import { ListGroup, ListRow } from "./List";
import { RichText } from "./RichText";

export interface MentionCandidate {
  readonly key: string;
  readonly label: string;
  readonly insert: string;
  readonly detail: string;
}

export interface ComposerProps {
  readonly channelId: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Members who can be `@mentioned`; omitted disables mention autocomplete. */
  readonly members?: readonly { readonly userId: string; readonly displayName: string }[];
  /** Mentionable roles offered by `@` autocomplete. */
  readonly roles?: readonly RoleMentionTarget[];
  /** Channels that can be `#mentioned`; omitted disables channel autocomplete. */
  readonly channels?: readonly { readonly id: string; readonly name: string }[];
  readonly audienceSize?: number;
  readonly mentionMarkers?: boolean;
  readonly massMentionHint?: string | undefined;
  readonly canMentionEveryone?: boolean;
  readonly viewerName?: string;
  /** A one-shot draft to place in the field and focus when `token` changes. */
  readonly seed?: { readonly token: number; readonly text: string } | undefined;
  /** Announces that the viewer is typing; throttled to one ping per few seconds. */
  readonly onTyping: (channelId: string) => void;
  /** Retracts the typing indicator on send, blur and channel switch. */
  // eslint-disable-next-line no-unused-vars -- parameter name documents the callback contract
  readonly onClearTyping?: ((channelId: string) => void) | undefined;
  readonly onSend: (input: { text: string; files: readonly PickedFile[] }) => void | Promise<void>;
}

const ATTACH_OPTIONS: readonly {
  key: string;
  label: string;
  icon: IconName;
  pick: () => Promise<readonly PickedFile[]>;
}[] = [
  {
    key: "camera",
    label: "Take a photo",
    icon: "camera",
    pick: async () => {
      const file = await pickFromCamera();
      return file === null ? [] : [file];
    },
  },
  { key: "photos", label: "Photo library", icon: "image", pick: pickFromLibrary },
  {
    key: "clipboard",
    label: "Paste image from clipboard",
    icon: "image-plus",
    pick: async () => {
      const file = await pickFromClipboard();
      return file === null ? [] : [file];
    },
  },
  { key: "files", label: "Browse files", icon: "file", pick: pickDocuments },
];

const TRIGGER = /(^|\s)([@#])([^\s@#]*)$/;

const sumHeights = (total: number, height: number) => total + height;

/** Mobile composer with attachments, `@`/`#` autocomplete and a markdown preview. */
export function Composer(props: ComposerProps) {
  const {
    channelId,
    placeholder = "Message",
    disabled,
    members = [],
    roles = [],
    channels = [],
    mentionMarkers = false,
    canMentionEveryone = false,
    massMentionHint = "Only members with permission can notify everyone. This will send as plain text.",
    audienceSize = 0,
    viewerName = "You",
    seed,
    onTyping,
    onClearTyping,
    onSend,
  } = props;
  const palette = usePalette();
  const insets = useScreenInsets();
  const [value, setValue] = useState("");
  const [broadcastNote, setBroadcastNote] = useState<string | null>(null);
  const reducedMotion = useReduceMotion();
  // At large text sizes the detail ("Notify online members") stacks under the label and
  // wraps instead of being cut to a few letters beside it.
  const stackSuggestionDetail = useWindowDimensions().fontScale > 1.3;
  // Measured from the first two rendered suggestions: their heights differ when only one
  // detail wraps, so two whole rows are the sum of both, not twice the first.
  const [suggestionRowHeights, setSuggestionRowHeights] = useState<readonly number[]>([44, 44]);
  // The live warning about the current draft wins over the note about the last send.
  const hintFor = (draft: string, note: string | null): string =>
    (!canMentionEveryone && hasBroadcastToken(draft)) ||
    (!mentionMarkers && hasBroadcastToken(draft, "here"))
      ? canMentionEveryone
        ? "This server can’t notify online members with @here. This will send as plain text."
        : massMentionHint
      : (note ?? "");
  const mentionHint = hintFor(value, broadcastNote);
  // The hint row takes no space while empty; when it appears or goes, the
  // composer grows or shrinks in one short ease instead of jumping.
  const easeHint = (next: string) => {
    if (next.length > 0 === mentionHint.length > 0 || reducedMotion !== false) return;
    LayoutAnimation.configureNext(
      LayoutAnimation.create(160, LayoutAnimation.Types.easeInEaseOut, "opacity"),
    );
  };
  // Announced once per change; the row itself is not also a live region.
  useEffect(() => {
    if (mentionHint.length > 0) AccessibilityInfo.announceForAccessibility(mentionHint);
  }, [mentionHint]);
  // The past-tense note belongs to the message that was just sent; typing again retires it.
  useEffect(() => {
    if (value !== "") setBroadcastNote(null);
  }, [value]);
  useEffect(
    () =>
      onBroadcastFallback((sentChannelId) => {
        if (sentChannelId === channelId) setBroadcastNote(BROADCAST_FALLBACK_NOTE);
      }),
    [channelId],
  );
  const [files, setFiles] = useState<readonly { key: string; file: PickedFile }[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const fileSeq = useRef(0);

  // Latest callbacks, so the throttle instance below can be created once.
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;
  const onClearTypingRef = useRef(onClearTyping);
  onClearTypingRef.current = onClearTyping;
  const typingThrottleRef = useRef<{
    // eslint-disable-next-line no-unused-vars -- parameter name documents the contract
    ping(channelId: string): void;
    // eslint-disable-next-line no-unused-vars -- parameter name documents the contract
    reset(channelId: string): void;
  } | null>(null);
  if (typingThrottleRef.current === null) {
    typingThrottleRef.current = createTypingThrottle((id) => {
      onTypingRef.current(id);
    });
  }

  const stopTyping = useCallback((id: string) => {
    typingThrottleRef.current?.reset(id);
    onClearTypingRef.current?.(id);
  }, []);

  useEffect(() => {
    setValue("");
    setFiles([]);
    return () => {
      // Leaving the channel (or unmounting) drops its typing indicator.
      stopTyping(channelId);
    };
  }, [channelId, stopTyping]);

  // A suggested first message (from the conversation opening) lands in the
  // draft and takes focus, so the viewer can adjust it before sending.
  const seedToken = seed?.token;
  const seedText = seed?.text;
  useEffect(() => {
    if (seedToken === undefined) return;
    setValue(seedText ?? "");
    inputRef.current?.focus();
  }, [seedToken, seedText]);

  const candidates = useMemo<MentionCandidate[]>(() => {
    const broadcast: MentionCandidate[] = canMentionEveryone
      ? [
          { key: "@here", label: "here", insert: "@here", detail: "Notify online members" },
          {
            key: "@everyone",
            label: "everyone",
            insert: "@everyone",
            detail: "Notify everyone in this channel",
          },
        ]
      : [];
    return orderMentionSuggestions([
      ...broadcast,
      ...members.map((member) => ({
        key: `@${member.userId}`,
        label: member.displayName,
        insert: `@${member.displayName}`,
        detail: "Member",
      })),
      ...roles
        .filter((role) => role.mentionable)
        .map((role) => ({
          key: `role:${role.roleId}`,
          label: role.name,
          insert: `@${role.name}`,
          detail: "Role",
        })),
      ...channels.map((channel) => ({
        key: `#${channel.id}`,
        label: channel.name,
        insert: `#${channel.name}`,
        detail: "Channel",
      })),
    ]);
  }, [canMentionEveryone, members, roles, channels]);

  const trigger = TRIGGER.exec(value);
  const suggestions = useMemo(() => {
    if (trigger === null) {
      return [];
    }
    const [, , prefix = "", rawQuery = ""] = trigger;
    const query = rawQuery.toLowerCase();
    return candidates
      .filter((candidate) => candidate.insert.startsWith(prefix))
      .filter((candidate) => candidate.label.toLowerCase().includes(query))
      .slice(0, 6);
  }, [trigger, candidates]);

  const showPreview =
    value.includes("**") ||
    value.includes("`") ||
    /(^|\s)[*_]/.test(value) ||
    /https?:\/\//.test(value) ||
    value.includes("#");

  async function pick(option: (typeof ATTACH_OPTIONS)[number]) {
    setMenuOpen(false);
    setBusy(true);
    try {
      const picked = await option.pick();
      if (picked.length > 0) {
        const room = attachmentRoom(files.length);
        if (room === 0) {
          setError(`You can attach at most ${MESSAGE_MAX_ATTACHMENTS} files.`);
          return;
        }
        const accepted = picked.slice(0, room);
        setError(
          accepted.length < picked.length
            ? `You can attach at most ${MESSAGE_MAX_ATTACHMENTS} files.`
            : null,
        );
        setFiles((current) => [
          ...current,
          ...accepted.map((file) => {
            fileSeq.current += 1;
            return { key: `file-${fileSeq.current}`, file };
          }),
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  function applySuggestion(candidate: MentionCandidate) {
    const next = value.replace(
      TRIGGER,
      (_match, leading: string) => `${leading}${candidate.insert} `,
    );
    easeHint(hintFor(next, broadcastNote));
    setValue(next);
  }

  function send(confirmed = false) {
    if (sending) {
      return;
    }
    const text = value.trim();
    if (text.length === 0 && files.length === 0) {
      return;
    }
    const limit = messageLimitError(text, files.length);
    if (limit !== null) {
      setError(limit);
      return;
    }
    if (
      !confirmed &&
      canMentionEveryone &&
      audienceSize > 100 &&
      resolveMentions(text, []).everyone
    ) {
      Alert.alert(`This will notify about ${audienceSize} people. Send?`, undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Send", onPress: () => send(true) },
      ]);
      return;
    }
    const snapshot = value;
    const pickedFiles = files;
    setSending(true);
    setError(null);
    impactFeedback();
    stopTyping(channelId);
    // Keep the draft visible until the send succeeds; a rejected send leaves it
    // in place (and shows why) instead of silently discarding the message.
    void Promise.resolve()
      .then(() => onSend({ text, files: pickedFiles.map((entry) => entry.file) }))
      .then(() => {
        setValue((current) => (current === snapshot ? "" : current));
        setFiles((current) => remainingComposerFiles(current, pickedFiles));
      })
      .catch((cause: unknown) => {
        setError(
          pickedFiles.length > 0
            ? attachmentUploadErrorMessage(cause, messageSendError(cause))
            : messageSendError(cause),
        );
      })
      .finally(() => {
        setSending(false);
      });
  }

  const textLength = value.trim().length;
  const limitError = messageLimitError(value.trim(), files.length);
  const canSend =
    limitError === null &&
    disabled !== true &&
    !sending &&
    (value.trim().length > 0 || files.length > 0);

  return (
    <View
      className="gap-1.5 bg-bg px-3 pt-1.5"
      // Anchored to the bottom: if the screen is too short for suggestions at
      // their two-row minimum, the list's top is clipped, never the input.
      style={{
        flexShrink: 1,
        paddingBottom: Math.max(insets.keyboardBottom, 8),
        justifyContent: "flex-end",
        overflow: "hidden",
      }}
    >
      {error !== null && (
        <View
          accessibilityRole="alert"
          className="flex-row items-center gap-2 rounded-card border border-border bg-surface-2 px-3 py-2"
        >
          <Text size="xs" tone="danger" className="flex-1 min-w-0">
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss message error"
            className="-my-2 -mr-2 h-11 w-11 items-center justify-center"
            onPress={() => {
              setError(null);
            }}
          >
            <Icon name="x" size={14} color={palette["text-muted"]} />
          </Pressable>
        </View>
      )}
      {files.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {files.map((entry) => (
            <Pressable
              key={entry.key}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${entry.file.name}`}
              className="min-h-11 min-w-11 flex-row items-center gap-1.5 rounded-pill bg-surface-2 py-1.5 pl-3 pr-2 active:opacity-70"
              onPress={() => {
                setFiles((current) => current.filter((value) => value.key !== entry.key));
              }}
            >
              <Icon name="paperclip" size={14} color={palette["text-muted"]} />
              <Text size="xs" numberOfLines={1} className="max-w-[10rem]">
                {entry.file.name}
              </Text>
              <Icon name="x" size={14} color={palette["text-muted"]} />
            </Pressable>
          ))}
        </View>
      )}
      {mentionHint.length > 0 && (
        <Text size="xs" tone="muted" testID="composer-mention-hint">
          {mentionHint}
        </Text>
      )}
      {suggestions.length > 0 && (
        // Shrinks and scrolls before it can push the input under the keyboard
        // on short screens or at large text sizes.
        <ScrollView
          className="rounded-card border border-border bg-surface-2"
          // At least two whole rows: on a short screen at large text the list
          // takes that room from the messages above, never from the input.
          style={{
            flexGrow: 0,
            flexShrink: 1,
            minHeight:
              suggestionRowHeights.slice(0, Math.min(2, suggestions.length)).reduce(sumHeights, 0) +
              2,
            maxHeight: 5 * Math.max(...suggestionRowHeights) + 2,
          }}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {suggestions.map((candidate, index) => (
            <Pressable
              key={candidate.key}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${candidate.insert}`}
              accessibilityState={{ selected: false }}
              className={
                stackSuggestionDetail
                  ? "min-h-11 justify-center px-3 py-1.5 active:bg-surface-3"
                  : "min-h-11 flex-row items-center justify-between gap-2 px-3 active:bg-surface-3"
              }
              onLayout={
                index < 2
                  ? (event) => {
                      const height = Math.round(event.nativeEvent.layout.height);
                      if (height > 0)
                        setSuggestionRowHeights((heights) =>
                          heights[index] === height
                            ? heights
                            : heights.map((known, at) => (at === index ? height : known)),
                        );
                    }
                  : undefined
              }
              onPress={() => {
                applySuggestion(candidate);
              }}
            >
              <Text size="sm" className="min-w-0 flex-1" numberOfLines={1}>
                {candidate.insert}
              </Text>
              <Text
                size="xs"
                tone="muted"
                className={stackSuggestionDetail ? "min-w-0" : "max-w-[45%]"}
                numberOfLines={2}
              >
                {candidate.detail}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {showPreview && value.trim().length > 0 && (
        <View className="rounded-card border border-border bg-surface-2 px-3 py-2">
          <RichText
            text={value}
            mentionNames={members.map((member) => member.displayName)}
            channelNames={channels.map((channel) => channel.name)}
            viewerName={viewerName}
          />
        </View>
      )}
      {/* Collapsed while empty: at large text an empty line costs ~30dp, enough
          to push the input under the keyboard on a short screen. */}
      {(limitError !== null || textLength >= MESSAGE_MAX_LENGTH * 0.9) && (
        <View className="min-h-4 flex-row items-center justify-between gap-2">
          <Text size="xs" tone="danger" className="flex-1 min-w-0" numberOfLines={1}>
            {limitError ?? ""}
          </Text>
          {textLength >= MESSAGE_MAX_LENGTH * 0.9 && (
            <Text
              size="xs"
              tone={textLength > MESSAGE_MAX_LENGTH ? "danger" : "muted"}
              className="text-right tabular-nums"
            >
              {textLength}/{MESSAGE_MAX_LENGTH}
            </Text>
          )}
        </View>
      )}
      <View className="flex-row items-end gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach"
          disabled={disabled === true || busy}
          hitSlop={4}
          className={`h-11 w-11 items-center justify-center rounded-pill bg-surface-2 active:opacity-70 ${
            disabled === true ? "opacity-50" : ""
          }`}
          onPress={() => {
            setMenuOpen(true);
          }}
        >
          <Icon name="plus" size={22} color={palette.text} />
        </Pressable>
        <View className="min-h-11 flex-1 justify-center rounded-[22px] border border-border bg-surface-2 px-4 min-w-0">
          <TextField
            maxFontSizeMultiplier={2}
            ref={inputRef}
            accessibilityLabel={placeholder}
            placeholder={disabled === true ? "You can’t send messages here" : placeholder}
            placeholderTextColor={palette["text-muted"]}
            value={value}
            multiline
            editable={disabled !== true}
            onChangeText={(next) => {
              easeHint(hintFor(next, broadcastNote));
              setValue(next);
              if (next.length > 0) {
                typingThrottleRef.current?.ping(channelId);
              }
            }}
            onBlur={() => {
              stopTyping(channelId);
            }}
            className="max-h-32 py-2.5 text-[17px] leading-[22px] text-text"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityHint={limitError ?? undefined}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          hitSlop={4}
          onPress={() => send()}
          className={`h-11 w-11 items-center justify-center rounded-pill active:opacity-80 ${
            canSend ? "bg-accent" : "bg-surface-2"
          }`}
        >
          <Icon
            name="send"
            size={20}
            color={canSend ? palette["on-accent"] : palette["text-muted"]}
          />
        </Pressable>
      </View>

      <BottomSheet
        visible={menuOpen}
        title="Add to message"
        subtitle="Formatting: **bold**, *italic*, `code`"
        onClose={() => {
          setMenuOpen(false);
        }}
      >
        <ListGroup>
          {ATTACH_OPTIONS.map((option) => (
            <ListRow
              key={option.key}
              icon={option.icon}
              title={option.label}
              onPress={() => void pick(option)}
            />
          ))}
        </ListGroup>
      </BottomSheet>
    </View>
  );
}
