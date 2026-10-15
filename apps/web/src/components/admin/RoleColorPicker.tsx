/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { cn, Icon } from "@aulora/ui-web";

/** A compact palette that reads well on both themes and next to blobatars. */
const PRESET_COLORS = [
  "#C2410C",
  "#E4571C",
  "#0E9F8E",
  "#248A3D",
  "#7C5CFF",
  "#B24592",
  "#D70015",
  "#8E8E93",
] as const;

const FALLBACK_COLOR = "#8E8E93";

/** A role color: a native color well plus a preset palette and a clear option. */
export function RoleColorPicker({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (color: string) => void;
}) {
  const shown = value.length > 0 ? value : FALLBACK_COLOR;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-text-muted">Role color</span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border border-border">
          <span className="absolute inset-0" style={{ backgroundColor: shown }} />
          <Icon name="image" size={14} className="relative text-white/80" />
          <input
            type="color"
            aria-label="Role color"
            className="absolute inset-0 cursor-pointer opacity-0"
            value={shown}
            onChange={(event) => {
              onChange(event.currentTarget.value);
            }}
          />
        </label>
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Use color ${color}`}
            onClick={() => {
              onChange(color);
            }}
            className={cn(
              "h-7 w-7 rounded-full border transition",
              value === color ? "border-text ring-2 ring-accent/40" : "border-border",
            )}
            style={{ backgroundColor: color }}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            onChange("");
          }}
          className="h-7 rounded-full border border-border px-2 text-[11px] text-text-muted transition hover:text-text"
        >
          None
        </button>
      </div>
    </div>
  );
}
