import { BROADCAST_FALLBACK_NOTE, hasBroadcastToken, onBroadcastFallback } from "@aulora/core";
import { useEffect, useState } from "react";
import { AccessibilityInfo, LayoutAnimation } from "react-native";
import { useReduceMotion } from "../../lib/use-entrance";

export const DEFAULT_MASS_MENTION_HINT =
  "Only members with permission can notify everyone. This will send as plain text.";

export interface MentionHintOptions {
  readonly canMentionEveryone: boolean;
  readonly mentionMarkers: boolean;
  readonly massMentionHint: string;
}

/**
 * The live warning about a draft wins over the note about the last send.
 * An empty string means there is nothing to show.
 */
export function mentionHintFor(
  draft: string,
  note: string | null,
  { canMentionEveryone, mentionMarkers, massMentionHint }: MentionHintOptions,
): string {
  const warn =
    (!canMentionEveryone && hasBroadcastToken(draft)) ||
    (!mentionMarkers && hasBroadcastToken(draft, "here"));
  if (!warn) return note ?? "";
  return canMentionEveryone
    ? "This server can’t notify online members with @here. This will send as plain text."
    : massMentionHint;
}

export interface MentionHintInput extends MentionHintOptions {
  readonly value: string;
  readonly channelId: string;
}

/** The hint under the composer: announced once per change, eased in and out. */
export function useMentionHint({ value, channelId, ...options }: MentionHintInput) {
  const reducedMotion = useReduceMotion();
  const [note, setNote] = useState<string | null>(null);
  const mentionHint = mentionHintFor(value, note, options);
  // The hint row takes no space while empty; when it appears or goes, the
  // composer grows or shrinks in one short ease instead of jumping.
  const easeHintFor = (nextDraft: string) => {
    const nextHint = mentionHintFor(nextDraft, note, options);
    if (nextHint.length > 0 === mentionHint.length > 0 || reducedMotion !== false) return;
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
    if (value !== "") setNote(null);
  }, [value]);
  useEffect(
    () =>
      onBroadcastFallback((sentChannelId) => {
        if (sentChannelId === channelId) setNote(BROADCAST_FALLBACK_NOTE);
      }),
    [channelId],
  );
  return { mentionHint, easeHintFor };
}
