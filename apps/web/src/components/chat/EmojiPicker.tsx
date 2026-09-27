import { cn } from "@aulora/ui-web";
import { useEffect, useRef } from "react";

/** A curated set that covers everyday reactions without a full emoji index. */
export const EMOJI_SET = [
  "👍",
  "❤️",
  "😂",
  "🎉",
  "👀",
  "🙏",
  "🔥",
  "✅",
  "😊",
  "😅",
  "🤔",
  "😮",
  "😢",
  "😍",
  "🥳",
  "😎",
  "👏",
  "🙌",
  "💯",
  "🚀",
  "✨",
  "💡",
  "⚡",
  "📌",
  "👋",
  "🤝",
  "💪",
  "☕",
  "🍕",
  "🎯",
  "❌",
  "⚠️",
] as const;

/**
 * Popover grid of emoji. Closes on outside click or Escape; selecting an emoji
 * calls `onPick` and closes.
 */
export function EmojiPicker({
  onPick,
  onClose,
  className,
}: {
  readonly onPick: (emoji: string) => void;
  readonly onClose: () => void;
  readonly className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick an emoji"
      className={cn(
        "z-40 grid w-[272px] animate-pop-in grid-cols-8 gap-0.5 rounded-[10px] border border-border bg-surface-2 p-2 shadow-xl shadow-black/20",
        className,
      )}
    >
      {EMOJI_SET.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`Emoji ${emoji}`}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-lg transition hover:bg-surface-3"
          onClick={() => {
            onPick(emoji);
            onClose();
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
