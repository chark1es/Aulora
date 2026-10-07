import { type InlineSegment, type NoteBlock, parseNoteMarkdown } from "@aulora/core";
import { Text, usePalette } from "@aulora/ui-native";
import type { ReactNode } from "react";
import { Linking, View } from "react-native";

type Palette = ReturnType<typeof usePalette>;

const HEADING_SIZE: Record<number, number> = { 1: 24, 2: 20, 3: 18, 4: 16, 5: 15, 6: 14 };

function inlineKey(segment: InlineSegment, index: number): string {
  switch (segment.type) {
    case "text":
    case "code":
      return `${segment.type}:${index}:${segment.text}`;
    case "link":
      return `link:${index}:${segment.href}`;
    default:
      return `${segment.type}:${index}`;
  }
}

function renderInline(segments: readonly InlineSegment[], palette: Palette): ReactNode[] {
  return segments.map((segment, index) => {
    const key = inlineKey(segment, index);
    switch (segment.type) {
      case "text":
        return <Text key={key}>{segment.text}</Text>;
      case "code":
        return (
          <Text
            key={key}
            mono
            style={{ backgroundColor: palette["surface-3"], color: palette.accent }}
          >
            {segment.text}
          </Text>
        );
      case "bold":
        return (
          <Text key={key} style={{ fontWeight: "600" }}>
            {renderInline(segment.children, palette)}
          </Text>
        );
      case "italic":
        return (
          <Text key={key} style={{ fontStyle: "italic" }}>
            {renderInline(segment.children, palette)}
          </Text>
        );
      case "link":
        return (
          <Text
            key={key}
            style={{ textDecorationLine: "underline", color: palette.accent }}
            onPress={() => {
              void Linking.openURL(segment.href);
            }}
          >
            {segment.text}
          </Text>
        );
      default:
        return null;
    }
  });
}

function renderBlock(block: NoteBlock, index: number, palette: Palette): ReactNode {
  const key = `${block.type}:${index}`;
  switch (block.type) {
    case "heading":
      return (
        <Text
          key={key}
          style={{
            color: palette.text,
            fontSize: HEADING_SIZE[block.level] ?? 16,
            fontWeight: block.level <= 3 ? "700" : "600",
            lineHeight: (HEADING_SIZE[block.level] ?? 16) + 6,
          }}
        >
          {renderInline(block.children, palette)}
        </Text>
      );
    case "paragraph":
      return (
        <Text key={key} style={{ color: palette.text, lineHeight: 22 }}>
          {renderInline(block.children, palette)}
        </Text>
      );
    case "code_block":
      return (
        <View
          key={key}
          className="overflow-hidden rounded-input px-3 py-2"
          style={{ backgroundColor: palette["surface-3"] }}
        >
          <Text mono size="sm" style={{ color: palette.text }}>
            {block.text}
          </Text>
        </View>
      );
    case "list":
      return (
        <View key={key} style={{ gap: 4 }}>
          {block.items.map((item, itemIndex) => {
            const itemKey = `item:${itemIndex}`;
            return (
              <View key={itemKey} className="flex-row gap-2">
                <Text style={{ color: palette["text-muted"], minWidth: 18 }}>
                  {block.ordered ? `${itemIndex + 1}.` : "•"}
                </Text>
                <Text className="flex-1" style={{ color: palette.text, lineHeight: 22 }}>
                  {renderInline(item, palette)}
                </Text>
              </View>
            );
          })}
        </View>
      );
    case "blockquote":
      return (
        <View key={key} className="border-l-2 pl-3" style={{ borderLeftColor: palette.accent }}>
          <Text style={{ color: palette["text-muted"], lineHeight: 22 }}>
            {renderInline(block.children, palette)}
          </Text>
        </View>
      );
    case "divider":
      return <View key={key} className="my-1 h-px bg-border" />;
    default:
      return null;
  }
}

/** Renders parsed note Markdown as native text, never HTML. */
export function NotePreview({ body }: { readonly body: string }) {
  const palette = usePalette();
  const blocks = parseNoteMarkdown(body);
  if (blocks.length === 0) {
    return (
      <Text size="sm" tone="muted">
        Nothing to preview yet.
      </Text>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((block, index) => renderBlock(block, index, palette))}
    </View>
  );
}
