import { type InlineSegment, inlineToPlainText, parseRichText } from "@aulora/core";
import { ACCENT_OVERLAY, Text, usePalette } from "@aulora/ui-native";
import type { ReactNode } from "react";
import { Linking, View } from "react-native";

export interface RichTextProps {
  readonly text: string;
  readonly mentionNames: readonly string[];
  readonly channelNames?: readonly string[];
  /** The viewer's display name; mentions of them are highlighted. */
  readonly viewerName: string;
  readonly onAccent?: boolean;
  readonly onChannelPress?: (name: string) => void;
}

/**
 * Native renderer for the message Markdown subset, mirroring the web
 * {@link RichText}. The core parser returns data, never markup, so message text
 * cannot inject styles; links open through the OS.
 */
export function RichText({
  text,
  mentionNames,
  channelNames = [],
  viewerName,
  onAccent = false,
  onChannelPress,
}: RichTextProps) {
  const palette = usePalette();
  const blocks = parseRichText(text, { mentionNames, channelNames });
  return (
    <View style={{ gap: 4 }}>
      {blocks.map((block) => {
        if (block.type === "code_block") {
          return (
            <View
              key={`code:${block.text}`}
              className="overflow-hidden rounded-input px-3 py-2"
              style={{ backgroundColor: onAccent ? ACCENT_OVERLAY : palette["surface-3"] }}
            >
              <Text
                size="sm"
                mono
                style={{ color: onAccent ? palette["on-accent"] : palette.text }}
              >
                {block.text}
              </Text>
            </View>
          );
        }
        return (
          <Text
            key={`p:${inlineToPlainText(block.children)}`}
            size="base"
            style={{ color: palette.text }}
          >
            {renderInline(block.children, viewerName, onAccent, palette, onChannelPress)}
          </Text>
        );
      })}
    </View>
  );
}

function inlineKey(segment: InlineSegment): string {
  switch (segment.type) {
    case "text":
    case "code":
      return `${segment.type}:${segment.text}`;
    case "link":
      return `link:${segment.href}`;
    case "mention":
      return `mention:${segment.name}`;
    case "channel":
      return `channel:${segment.name}`;
    default:
      return `${segment.type}:${inlineToPlainText(segment.children)}`;
  }
}

function renderInline(
  segments: readonly InlineSegment[],
  viewerName: string,
  onAccent: boolean,
  palette: ReturnType<typeof usePalette>,
  onChannelPress: ((name: string) => void) | undefined,
): ReactNode[] {
  return segments.map((segment) => {
    const key = inlineKey(segment);
    switch (segment.type) {
      case "text":
        return <Text key={key}>{segment.text}</Text>;
      case "code":
        return (
          <Text
            key={key}
            mono
            style={{
              backgroundColor: onAccent ? ACCENT_OVERLAY : palette["surface-3"],
              color: onAccent ? palette["on-accent"] : palette.accent,
            }}
          >
            {segment.text}
          </Text>
        );
      case "bold":
        return (
          <Text key={key} style={{ fontWeight: "600" }}>
            {renderInline(segment.children, viewerName, onAccent, palette, onChannelPress)}
          </Text>
        );
      case "italic":
        return (
          <Text key={key} style={{ fontStyle: "italic" }}>
            {renderInline(segment.children, viewerName, onAccent, palette, onChannelPress)}
          </Text>
        );
      case "link":
        return (
          <Text
            key={key}
            style={{
              textDecorationLine: "underline",
              color: onAccent ? palette["on-accent"] : palette.accent,
            }}
            onPress={() => {
              void Linking.openURL(segment.href);
            }}
          >
            {segment.text}
          </Text>
        );
      case "mention": {
        const self = segment.broadcast || segment.name.toLowerCase() === viewerName.toLowerCase();
        return (
          <Text
            key={key}
            style={{
              fontWeight: "600",
              color: onAccent || self ? palette["on-accent"] : palette.accent,
              backgroundColor: onAccent
                ? ACCENT_OVERLAY
                : self
                  ? palette.accent
                  : palette["accent-soft"],
              borderWidth: 1,
              borderColor: onAccent
                ? ACCENT_OVERLAY
                : self
                  ? palette.accent
                  : palette["accent-soft"],
              borderRadius: 5,
            }}
          >
            @{segment.name}
          </Text>
        );
      }
      case "channel":
        return (
          <Text
            key={key}
            style={{
              fontWeight: "600",
              color: onAccent ? palette["on-accent"] : palette.accent,
              backgroundColor: onAccent ? ACCENT_OVERLAY : palette["accent-soft"],
              borderWidth: 1,
              borderColor: onAccent ? ACCENT_OVERLAY : palette["accent-soft"],
              borderRadius: 5,
            }}
            onPress={() => onChannelPress?.(segment.name)}
          >
            #{segment.name}
          </Text>
        );
      default:
        return null;
    }
  });
}
