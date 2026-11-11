/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { MentionTarget, RoleMentionTarget } from "@aulora/core";
import {
  BROADCAST_FALLBACK_NOTE,
  buildSendMentions,
  hasBroadcastToken,
  MESSAGE_MAX_ATTACHMENTS,
  MESSAGE_MAX_LENGTH,
  messageSendError,
  onBroadcastFallback,
  orderMentionSuggestions,
  resolveChannelMentions,
  resolveMentions,
} from "@aulora/core";
import { Button, ConfirmDialog, cn, Icon } from "@aulora/ui-web";
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { attachmentUploadErrorMessage, DEFAULT_MAX_UPLOAD_BYTES } from "../../lib/attachments";
import {
  DraftScopeContext,
  readDraft,
  scopedDraftKey,
  submitDraft,
  watchDraftSubmissions,
  writeDraft,
} from "../../lib/drafts";
import { formatBytes } from "../../lib/instance-admin";
import { ComposerAttachment, ComposerCounter, ComposerNotice } from "./ComposerChrome";
import { EmojiPicker } from "./EmojiPicker";
import { PersonAvatar } from "./member-avatars";
import {
  type MemberSearch,
  mentionTargetsFor,
  mergeMentionTargets,
  useSearchedMembers,
} from "./mention-directory";
import { RichText } from "./RichText";

/** A first-message suggestion placed in the composer. */
export interface ComposerSeed {
  /** Bumped on every suggestion so the same text can be applied again. */
  readonly token: number;
  readonly text: string;
}

export interface ComposerProps {
  readonly channelId: string;
  readonly members: readonly MentionTarget[];
  /**
   * Server-side member search. The composer no longer holds the whole roster,
   * so autocomplete and `@name` resolution for people outside the timeline ask
   * the directory instead.
   */
  readonly searchMembers?: MemberSearch;
  readonly roles: readonly RoleMentionTarget[];
  readonly memberIds: readonly string[];
  /** Channels and categories offered by `#` autocomplete. */
  readonly channels?: readonly { readonly channelId: string; readonly name: string }[];
  /** Categories offered by `#` autocomplete and resolved on send. */
  readonly categories?: readonly { readonly categoryId: string; readonly name: string }[];
  /** Whether the viewer may attach files; hides the pickers when false. */
  readonly canAttach?: boolean;
  /** Whether the viewer may broadcast `@here`/`@everyone`. */
  readonly massMentionHint?: string | undefined;
  readonly canMentionEveryone?: boolean;
  readonly mentionMarkers?: boolean;
  /** The viewer’s display name, so previews highlight self-mentions. */
  readonly ownName?: string;
  /** Visible placeholder, e.g. "Message #general". */
  readonly placeholder?: string;
  /** Storage key for this composer’s draft; omit to keep no draft. */
  readonly draftKey?: string;
  /** A first-message suggestion to place in the input and focus. */
  readonly seedText?: ComposerSeed;
  readonly onTyping: (channelId: string) => void;
  readonly onSend: (input: {
    text: string;
    mentionUserIds: readonly string[];
    mentionEveryone?: boolean;
    mentionHere?: boolean;
    mentionChannelIds: readonly string[];
    mentionCategoryIds: readonly string[];
    mentionRoleIds: readonly string[];
    files: readonly File[];
  }) => void | Promise<void>;
  /** Optional thread mode label, e.g. "Replying in thread". */
  readonly threadHint?: string;
  /** Extra controls rendered in the toolbar (e.g. "Also send to channel"). */
  readonly toolbarExtra?: ReactNode;
  readonly disabled?: boolean;
  /**
   * When true (default) this composer accepts a file dropped anywhere in the
   * window; when false it only accepts drops within its own bounds. Only the
   * primary (main chat) composer should own the app-wide drop target, so a
   * secondary composer (e.g. the thread reply box) passes `false`.
   */
  readonly windowDropEnabled?: boolean;
  /** The message being replied to inline; shows a dismissible quote banner. */
  readonly replyTo?: {
    readonly authorName: string;
    readonly preview: string;
    readonly mentionEveryone?: boolean;
    readonly mentionHere?: boolean;
  } | null;
  /** Clears the inline reply (banner X or Escape). */
  readonly onCancelReply?: () => void;
  /**
   * Largest file this composer will attach, in bytes. Picks larger than this
   * are rejected with an inline error naming both sizes. Defaults to
   * {@link DEFAULT_MAX_UPLOAD_BYTES} so callers that don’t pass it still work.
   */
  readonly maxUploadBytes?: number;
}

interface Suggestion {
  readonly key: string;
  readonly label: string;
  readonly insert: string;
  readonly detail: string;
  readonly kind: "mention" | "channel";
  readonly userId?: string;
  readonly channelId?: string;
}

const MAX_TEXTAREA_PX = 220;
const MENTION_QUERY = /(^|\s)@([^\s@]*)$/;
const CHANNEL_QUERY = /(^|\s)#([^\s#]*)$/;

function collectFiles(list: FileList | ArrayLike<File> | null): File[] {
  if (list === null) {
    return [];
  }
  return Array.from(list);
}

/**
 * True only when a drag carries files, so channel/sidebar reordering (which
 * uses `text/plain`) is left alone. Firefox advertises `application/x-moz-file`.
 */
function isFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  const types = dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).some((type) => type === "Files" || type === "application/x-moz-file");
}

let fileRefSeq = 0;
const fileRefs = new WeakMap<File, string>();

/** Stable React key per picked file, since `File` has no reliable id. */
function fileReferenceKey(file: File): string {
  const existing = fileRefs.get(file);
  if (existing !== undefined) {
    return existing;
  }
  fileRefSeq += 1;
  const key = `file-${fileRefSeq}`;
  fileRefs.set(file, key);
  return key;
}

/**
 * The message composer: an auto-growing input with mention autocomplete, an
 * emoji picker, attachments (picker, drag-and-drop and paste) and per-device
 * drafts. Files are handed to the caller, which uploads them; the server seals
 * them at rest. Enter sends, Shift+Enter adds a line.
 */
export function Composer(props: ComposerProps) {
  const { draftKey, ...rest } = props;
  const key = scopedDraftKey(useContext(DraftScopeContext), draftKey);
  return (
    <ScopedComposer
      key={key ?? props.channelId}
      {...rest}
      {...(key !== undefined ? { draftKey: key } : {})}
    />
  );
}

function ScopedComposer({
  channelId,
  members,
  searchMembers,
  roles,
  memberIds,
  channels = [],
  categories = [],
  canAttach = true,
  mentionMarkers = false,
  canMentionEveryone = false,
  massMentionHint = "Only members with permission can notify everyone. This will send as plain text.",
  ownName,
  placeholder = "Message",
  draftKey,
  seedText,
  onTyping,
  onSend,
  threadHint,
  toolbarExtra,
  disabled = false,
  windowDropEnabled = true,
  replyTo = null,
  onCancelReply,
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
}: ComposerProps) {
  const lengthErrorId = useId();
  const [sending, setSending] = useState(false);
  const [value, setValue] = useState(() => (draftKey !== undefined ? readDraft(draftKey) : ""));
  const [broadcastNote, setBroadcastNote] = useState<string | null>(null);
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
  const [files, setFiles] = useState<readonly File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [windowDragging, setWindowDragging] = useState(false);
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  /** The text typed after `@`, driving the debounced directory search. */
  const [mentionQuery, setMentionQuery] = useState("");
  const searchedMembers = useSearchedMembers(searchMembers, mentionQuery);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  /** Selection to restore right after the next value commit (mention/emoji inserts). */
  const pendingSelection = useRef<[number, number] | null>(null);
  /** Depth of nested dragenter/dragleave pairs, so child elements don’t flicker. */
  const dragDepth = useRef(0);
  /** Safety timer that clears the overlay if no further drag event arrives. */
  const dragSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeDraft = useRef(draftKey);
  const latestValue = useRef(value);
  latestValue.current = value;
  useEffect(
    () => () => {
      activeDraft.current = undefined;
      if (draftKey !== undefined) writeDraft(draftKey, latestValue.current);
    },
    [draftKey],
  );

  useEffect(() => {
    if (draftKey === undefined) return;
    return watchDraftSubmissions(draftKey, (snapshot) => {
      if (latestValue.current === snapshot) latestValue.current = "";
      setValue((current) => (current === snapshot ? "" : current));
    });
  }, [draftKey]);

  // Switching conversations swaps in that conversation’s draft.
  useEffect(() => {
    activeDraft.current = draftKey;
    setValue(draftKey !== undefined ? readDraft(draftKey) : "");
    setFiles([]);
    setAttachmentError(null);
    setSendError(null);
    setSuggestions([]);
    textareaRef.current?.focus();
  }, [draftKey]);

  useEffect(() => {
    if (draftKey === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      writeDraft(draftKey, value);
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [draftKey, value]);

  // A first-message suggestion replaces an empty draft and puts the caret at
  // the end, ready to edit or send. Existing text is never clobbered.
  useEffect(() => {
    if (seedText === undefined) {
      return;
    }
    const node = textareaRef.current;
    const current = node?.value ?? "";
    if (current.trim().length === 0) {
      pendingSelection.current = [seedText.text.length, seedText.text.length];
      setValue(seedText.text);
    } else if (node !== null) {
      node.setSelectionRange(current.length, current.length);
    }
    setSuggestions([]);
    setMentionQuery("");
    setEmojiOpen(false);
    node?.focus();
  }, [seedText]);

  // Grow with the content up to a cap, then scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the value changes
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (node === null) {
      return;
    }
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, MAX_TEXTAREA_PX)}px`;
    const selection = pendingSelection.current;
    if (selection !== null) {
      pendingSelection.current = null;
      node.focus();
      node.setSelectionRange(selection[0], selection[1]);
    }
  }, [value]);

  const mentionSuggestions: Suggestion[] = useMemo(() => {
    const broadcast: Suggestion[] = canMentionEveryone
      ? [
          {
            key: "here",
            label: "here",
            insert: "@here",
            detail: "Notify online members",
            kind: "mention",
          },
          {
            key: "everyone",
            label: "everyone",
            insert: "@everyone",
            detail: "Notify everyone in this channel",
            kind: "mention",
          },
        ]
      : [];
    return orderMentionSuggestions([
      ...broadcast,
      ...mergeMentionTargets(members, searchedMembers).map((member) => ({
        key: `user:${member.userId}`,
        label: member.displayName,
        insert: `@${member.displayName}`,
        detail: "Member",
        kind: "mention" as const,
        userId: member.userId,
      })),
      ...roles
        .filter((role) => role.mentionable)
        .map((role) => ({
          key: `role:${role.roleId}`,
          label: role.name,
          insert: `@${role.name}`,
          detail: "Role",
          kind: "mention" as const,
        })),
    ]);
  }, [canMentionEveryone, members, roles, searchedMembers]);

  // Directory results arrive after the keystroke that asked for them, so the
  // open dropdown is re-filtered when they land.
  useEffect(() => {
    if (mentionQuery.length === 0 || suggestionQuery.current !== "mention") {
      return;
    }
    const query = mentionQuery.toLowerCase();
    setSuggestions(
      mentionSuggestions
        .filter((suggestion) => suggestion.label.toLowerCase().includes(query))
        .slice(0, 6),
    );
  }, [mentionQuery, mentionSuggestions]);

  const channelSuggestions: Suggestion[] = useMemo(
    () =>
      channels.map((entry) => ({
        key: `channel:${entry.channelId}`,
        label: entry.name,
        insert: `#${entry.name}`,
        detail: "Channel",
        kind: "channel" as const,
        channelId: entry.channelId,
      })),
    [channels],
  );

  const suggestionQuery = useRef<"mention" | "channel">("mention");

  function updateSuggestions(next: string, caret: number): void {
    const slice = next.slice(0, caret);
    const mention = MENTION_QUERY.exec(slice);
    if (mention !== null) {
      suggestionQuery.current = "mention";
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- capture groups are `string | undefined` under noUncheckedIndexedAccess
      const query = (mention[2] ?? "").toLowerCase();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- capture groups are `string | undefined` under noUncheckedIndexedAccess
      setMentionQuery(mention[2] ?? "");
      setSuggestions(
        mentionSuggestions
          .filter((suggestion) => suggestion.label.toLowerCase().includes(query))
          .slice(0, 6),
      );
      setActiveSuggestion(0);
      return;
    }
    const channel = CHANNEL_QUERY.exec(slice);
    if (channel !== null && channelSuggestions.length > 0) {
      suggestionQuery.current = "channel";
      setMentionQuery("");
      const query = (channel[2] ?? "").toLowerCase();
      setSuggestions(
        channelSuggestions
          .filter((suggestion) => suggestion.label.toLowerCase().includes(query))
          .slice(0, 6),
      );
      setActiveSuggestion(0);
      return;
    }
    setSuggestions([]);
    setMentionQuery("");
  }

  function applySuggestion(suggestion: Suggestion): void {
    const node = textareaRef.current;
    const caret = node?.selectionStart ?? value.length;
    const pattern = suggestionQuery.current === "channel" ? CHANNEL_QUERY : MENTION_QUERY;
    const before = value
      .slice(0, caret)
      .replace(pattern, (_all, lead: string) => `${lead}${suggestion.insert} `);
    const next = before + value.slice(caret);
    pendingSelection.current = [before.length, before.length];
    setValue(next);
    setSuggestions([]);
  }

  function insertAtCaret(snippet: string, selectOffset?: [number, number]): void {
    const node = textareaRef.current;
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const [from, to] = selectOffset ?? [snippet.length, snippet.length];
    pendingSelection.current = [start + from, start + to];
    setValue(next);
  }

  const addFiles = useCallback(
    (incoming: readonly File[]): void => {
      if (!canAttach || incoming.length === 0) {
        return;
      }
      if (files.length + incoming.length > MESSAGE_MAX_ATTACHMENTS) {
        setAttachmentError(`You can attach up to ${MESSAGE_MAX_ATTACHMENTS} files per message.`);
        return;
      }
      const accepted: File[] = [];
      let rejected: File | undefined;
      for (const file of incoming) {
        if (file.size > maxUploadBytes) {
          rejected ??= file;
        } else {
          accepted.push(file);
        }
      }
      if (rejected !== undefined) {
        setAttachmentError(
          `${rejected.name} is ${formatBytes(rejected.size)}, over the ${formatBytes(maxUploadBytes)} limit.`,
        );
      } else {
        setAttachmentError(null);
      }
      if (accepted.length > 0) {
        setFiles((current) => [...current, ...accepted]);
      }
    },
    [canAttach, maxUploadBytes, files],
  );

  // A file drag can be dropped anywhere in the app, so watch the window rather
  // than the composer’s own box. Non-file drags (e.g. channel reordering) fall
  // straight through: no preventDefault, no overlay.
  useEffect(() => {
    if (typeof window === "undefined" || !windowDropEnabled) {
      return;
    }

    const resetWindowDrag = (): void => {
      if (dragSafetyTimer.current !== null) {
        clearTimeout(dragSafetyTimer.current);
        dragSafetyTimer.current = null;
      }
      dragDepth.current = 0;
      setWindowDragging(false);
      setDragging(false);
    };

    // A file drag can stop emitting events (e.g. the pointer sits still) or
    // lose its `dragend`; clear the overlay if nothing arrives for a while.
    const armSafetyTimer = (): void => {
      if (dragSafetyTimer.current !== null) {
        clearTimeout(dragSafetyTimer.current);
      }
      dragSafetyTimer.current = setTimeout(resetWindowDrag, 2000);
    };

    const onDragEnter = (event: DragEvent): void => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      dragDepth.current += 1;
      if (!disabled) {
        setWindowDragging(true);
        armSafetyTimer();
      }
    };

    const onDragOver = (event: DragEvent): void => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      if (!disabled) {
        armSafetyTimer();
      }
    };

    const onDragLeave = (event: DragEvent): void => {
      // Some browsers report empty `types` on the dragleave that fires as the
      // pointer leaves the window, and never fire `dragend`, so a leave with no
      // related target always ends the drag whatever the event advertises.
      // (`== null` also covers environments that leave `relatedTarget` undefined.)
      if (event.relatedTarget == null) {
        resetWindowDrag();
        return;
      }
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) {
        if (dragSafetyTimer.current !== null) {
          clearTimeout(dragSafetyTimer.current);
          dragSafetyTimer.current = null;
        }
        setWindowDragging(false);
      }
    };

    const onDrop = (event: DragEvent): void => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      resetWindowDrag();
      if (!disabled) {
        addFiles(collectFiles(event.dataTransfer?.files ?? null));
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", resetWindowDrag);
    window.addEventListener("blur", resetWindowDrag);
    return () => {
      resetWindowDrag();
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", resetWindowDrag);
      window.removeEventListener("blur", resetWindowDrag);
    };
  }, [addFiles, disabled, windowDropEnabled]);

  async function submit(text: string, pickedFiles: readonly File[]): Promise<void> {
    const targets = await mentionTargetsFor(text, members, searchMembers);
    const resolution = resolveMentions(text, targets, roles, { expandRoles: false });
    const channelMentionResolution = resolveChannelMentions(text, channels, categories);
    await onSend({
      text,
      ...buildSendMentions({
        resolution,
        memberIds,
        canMentionEveryone,
        capabilities: { mentionMarkers: true },
        channels: channelMentionResolution,
      }),
      files: pickedFiles,
    });
  }

  const [confirmMassPing, setConfirmMassPing] = useState(false);
  const listboxId = useId();
  function send(confirmed = false): void {
    const text = value.trim();
    if (
      disabled ||
      value.trim().length > MESSAGE_MAX_LENGTH ||
      (text.length === 0 && files.length === 0)
    ) {
      return;
    }
    if (sending) return;
    if (
      !confirmed &&
      canMentionEveryone &&
      memberIds.length > 100 &&
      resolveMentions(text, []).everyone
    ) {
      setConfirmMassPing(true);
      return;
    }
    const pickedFiles = files;
    const snapshot = value;
    const submittedKey = draftKey;
    setSending(true);
    setAttachmentError(null);
    setSendError(null);
    void submit(text, pickedFiles)
      .then(() => {
        setSendError(null);
        if (submittedKey !== undefined) submitDraft(submittedKey, snapshot);
        if (activeDraft.current !== submittedKey) {
          if (submittedKey !== undefined && readDraft(submittedKey) === snapshot)
            writeDraft(submittedKey, "");
          return;
        }
        if (latestValue.current === snapshot) latestValue.current = "";
        setValue((current) => (current === snapshot ? "" : current));
        setFiles((current) => current.filter((file) => !pickedFiles.includes(file)));
        setSuggestions([]);
        setMentionQuery("");
        if (submittedKey !== undefined && readDraft(submittedKey) === snapshot)
          writeDraft(submittedKey, latestValue.current);
      })
      .catch((cause: unknown) => {
        if (activeDraft.current === submittedKey) {
          setSendError(attachmentUploadErrorMessage(cause, messageSendError(cause)));
        }
      })
      .finally(() => {
        setSending(false);
      });
  }

  const lengthError =
    value.trim().length > MESSAGE_MAX_LENGTH
      ? "Message is over 4,000 characters. Trim it or split it."
      : null;
  const canSend =
    !disabled && !sending && lengthError === null && (value.trim().length > 0 || files.length > 0);
  // A hint only exists while the drafted text actually uses a restricted
  // mention; otherwise there is nothing to explain and no row is reserved.
  const noticeText =
    (!canMentionEveryone && hasBroadcastToken(value)) ||
    (!mentionMarkers && hasBroadcastToken(value, "here"))
      ? canMentionEveryone
        ? "This server can’t notify online members with @here. This will send as plain text."
        : massMentionHint
      : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop drop zone wrapping the composer
    <div
      className="relative px-4 pb-3 pt-1 sm:px-6 sm:pb-4"
      onDragOver={(event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        setDragging(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        setDragging(false);
        if (!windowDropEnabled) {
          addFiles(collectFiles(event.dataTransfer.files));
          event.stopPropagation();
        }
      }}
    >
      <ComposerNotice text={noticeText} />
      <div
        className={cn(
          // A flat composer: a hairline top rule and a rounded focus
          // surface behind the text, not a boxed card around every message.
          "relative rounded-[10px] border bg-surface-2/60 transition-colors",
          dragging
            ? "border-accent bg-accent-soft"
            : "border-border focus-within:border-accent focus-within:ring-2 focus-within:ring-accent focus-within:bg-surface-2",
        )}
      >
        {suggestions.length > 0 && (
          <div
            role="listbox"
            id={listboxId}
            aria-label="Mention suggestions"
            className="absolute bottom-full left-0 z-30 mb-1 w-72 max-w-full animate-pop-in overflow-hidden rounded-[10px] border border-border bg-surface-2 p-1 shadow-xl shadow-black/20"
          >
            {suggestions.map((suggestion, index) => (
              <div key={suggestion.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeSuggestion}
                  id={`${listboxId}-${index}`}
                  tabIndex={-1}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[13px]",
                    index === activeSuggestion ? "bg-accent-soft text-text" : "text-text-muted",
                  )}
                  onMouseEnter={() => {
                    setActiveSuggestion(index);
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applySuggestion(suggestion);
                  }}
                >
                  {suggestion.userId !== undefined ? (
                    <PersonAvatar userId={suggestion.userId} size={24} />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-3 text-accent-text">
                      <Icon name="at" size={14} />
                    </span>
                  )}
                  <span className="shrink-0 font-medium text-text">{suggestion.label}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-text-muted">
                    <span className="block truncate">{suggestion.detail}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}

        {replyTo !== null && (
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Icon name="reply" size={14} className="shrink-0 text-accent-text" />
            <span className="min-w-0 flex-1 truncate text-xs">
              <span className="font-semibold text-text">{replyTo.authorName}</span>{" "}
              <span className="text-text-muted">
                <RichText
                  variant="inline"
                  text={replyTo.preview}
                  mentionEveryone={replyTo.mentionEveryone}
                  mentionHere={replyTo.mentionHere}
                  mentionNames={members.map((member) => member.displayName)}
                  channelNames={channels.map((entry) => entry.name)}
                  viewerName={ownName ?? ""}
                />
              </span>
            </span>
            <button
              type="button"
              aria-label="Cancel reply"
              onClick={() => onCancelReply?.()}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted hover:bg-surface-3 hover:text-text"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
        <ConfirmDialog
          open={confirmMassPing}
          title={`This will notify about ${memberIds.length} people. Send?`}
          confirmLabel="Send"
          onClose={() => {
            setConfirmMassPing(false);
          }}
          onConfirm={() => {
            setConfirmMassPing(false);
            send(true);
          }}
        />
        {threadHint !== undefined && (
          <p className="px-4 pt-2.5 text-xs font-medium text-text-muted">{threadHint}</p>
        )}
        {files.length > 0 && (
          <ul
            className="flex max-h-[88px] flex-wrap gap-1.5 overflow-y-auto px-3 pt-3"
            data-testid="composer-attachments"
          >
            {files.map((file) => (
              <ComposerAttachment
                key={fileReferenceKey(file)}
                name={file.name}
                image={file.type.startsWith("image/")}
                onRemove={() => {
                  setFiles((current) => current.filter((value) => value !== file));
                }}
              />
            ))}
          </ul>
        )}

        {attachmentError !== null && (
          <div
            role="alert"
            data-testid="composer-attachment-error"
            className="mx-3 mt-3 flex items-start gap-2 rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger-text"
          >
            <span className="flex-1">{attachmentError}</span>
            <button
              type="button"
              aria-label="Dismiss attachment error"
              className="shrink-0 text-danger-text/80 hover:text-danger-text"
              onClick={() => {
                setAttachmentError(null);
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {lengthError !== null && (
          <p id={lengthErrorId} role="alert" className="mx-3 mt-3 text-[12px] text-danger-text">
            {lengthError}
          </p>
        )}
        {sendError !== null && (
          <div
            role="alert"
            data-testid="composer-send-error"
            className="mx-3 mt-3 flex items-center gap-2 rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger-text"
          >
            <span className="flex-1">{sendError}</span>
            <Button
              size="sm"
              variant="secondary"
              className="h-6 shrink-0 px-2 text-[12px]"
              onClick={() => {
                send();
                textareaRef.current?.focus();
              }}
            >
              Retry
            </Button>
            <button
              type="button"
              aria-label="Dismiss send error"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-danger-text/80 transition hover:bg-danger/15 hover:text-danger-text"
              onClick={() => {
                setSendError(null);
                textareaRef.current?.focus();
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-1.5 px-2 pt-2">
          <span className="relative">
            <button
              type="button"
              aria-label="Insert emoji"
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted transition hover:bg-surface-3 hover:text-text"
              onClick={() => {
                setEmojiOpen((open) => !open);
              }}
            >
              <Icon name="smile" size={18} />
            </button>
            {emojiOpen && (
              <EmojiPicker
                className="absolute bottom-full left-0 mb-2"
                onPick={(emoji) => {
                  insertAtCaret(emoji);
                }}
                onClose={() => {
                  setEmojiOpen(false);
                }}
              />
            )}
          </span>
          <textarea
            ref={textareaRef}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={suggestions.length > 0 ? listboxId : undefined}
            aria-activedescendant={
              suggestions.length > 0 ? `${listboxId}-${activeSuggestion}` : undefined
            }
            aria-autocomplete="list"
            aria-label="Message"
            placeholder={placeholder}
            value={value}
            rows={1}
            disabled={disabled}
            className="max-h-[220px] min-h-[32px] flex-1 resize-none bg-transparent py-1 text-[14px] leading-relaxed text-text placeholder:text-text-muted focus-visible:outline-none disabled:opacity-60"
            onChange={(event) => {
              const next = event.target.value;
              setValue(next);
              if (next.length > 0) {
                onTyping(channelId);
              }
              updateSuggestions(next, event.target.selectionStart);
            }}
            onPaste={(event) => {
              const pasted = collectFiles(event.clipboardData.files);
              if (pasted.length > 0) {
                event.preventDefault();
                addFiles(pasted);
              }
            }}
            onKeyDown={(event) => {
              if (suggestions.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveSuggestion((index) => (index + 1) % suggestions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveSuggestion(
                    (index) => (index - 1 + suggestions.length) % suggestions.length,
                  );
                  return;
                }
                if (event.key === "Tab" || event.key === "Enter") {
                  event.preventDefault();
                  const suggestion = suggestions.at(activeSuggestion);
                  if (suggestion !== undefined) {
                    applySuggestion(suggestion);
                  }
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSuggestions([]);
                  return;
                }
              }
              if (event.key === "Escape" && replyTo !== null) {
                event.preventDefault();
                onCancelReply?.();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <button
            type="button"
            aria-label="Send"
            aria-describedby={lengthError === null ? undefined : lengthErrorId}
            title={lengthError ?? undefined}
            onClick={() => {
              send();
            }}
            disabled={!canSend}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition",
              canSend
                ? "bg-accent text-on-accent hover:brightness-110 active:brightness-95"
                : "bg-surface-3 text-text-muted",
            )}
          >
            <Icon name="send" size={18} />
          </button>
        </div>

        {broadcastNote && (
          <p role="status" className="text-xs text-text-muted">
            {broadcastNote}
          </p>
        )}
        <div className="flex items-center gap-0.5 px-2 pb-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            aria-label="Attach files"
            data-testid="file-input"
            onChange={(event) => {
              addFiles(collectFiles(event.target.files));
              event.target.value = "";
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            aria-label="Attach images"
            onChange={(event) => {
              addFiles(collectFiles(event.target.files));
              event.target.value = "";
            }}
          />
          {canAttach && (
            <>
              <ToolButton
                label="Attach files"
                icon="paperclip"
                onClick={() => fileInputRef.current?.click()}
              />
              <ToolButton
                label="Attach images"
                icon="image"
                onClick={() => imageInputRef.current?.click()}
              />
            </>
          )}
          <ToolButton
            label="Code block"
            icon="code"
            onClick={() => {
              insertAtCaret("```\n\n```", [4, 4]);
            }}
          />
          <ToolButton
            label="Mention someone"
            icon="at"
            onClick={() => {
              const lead = value.length > 0 && !/\s$/.test(value) ? " @" : "@";
              insertAtCaret(lead);
              const node = textareaRef.current;
              const next = value + lead;
              updateSuggestions(next, next.length);
              node?.focus();
            }}
          />
          {channels.length > 0 && (
            <ToolButton
              label="Mention a channel"
              icon="hash"
              onClick={() => {
                const lead = value.length > 0 && !/\s$/.test(value) ? " #" : "#";
                insertAtCaret(lead);
                const node = textareaRef.current;
                const next = value + lead;
                updateSuggestions(next, next.length);
                node?.focus();
              }}
            />
          )}
          {toolbarExtra}
          <ComposerCounter value={value} />
        </div>
      </div>

      {windowDragging && !disabled && (
        <div
          data-testid="composer-drop-overlay"
          className="desktop-below-titlebar pointer-events-none z-[60] flex items-center justify-center border-2 border-dashed border-accent bg-accent-soft/80"
        >
          <span className="rounded-[10px] bg-surface-2 px-4 py-2 text-sm font-medium text-accent-text shadow-lg shadow-black/20">
            Drop files to attach
          </span>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
  active = false,
}: {
  readonly label: string;
  readonly icon: "paperclip" | "image" | "code" | "at" | "hash" | "eye" | "eye-off";
  readonly onClick: () => void;
  readonly active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-[7px] transition",
        active
          ? "bg-surface-3 text-accent-text"
          : "text-text-muted hover:bg-surface-3 hover:text-text",
      )}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}
