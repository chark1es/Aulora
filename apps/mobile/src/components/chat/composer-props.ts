import type { RoleMentionTarget } from "@aulora/core";
import type { Fn } from "../../lib/function-type";
import type { ComposerSendHandler } from "./use-composer-send";

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
  readonly onTyping: Fn<[channelId: string], void>;
  /** Retracts the typing indicator on send, blur and channel switch. */
  readonly onClearTyping?: Fn<[channelId: string], void> | undefined;
  readonly onSend: ComposerSendHandler;
}
