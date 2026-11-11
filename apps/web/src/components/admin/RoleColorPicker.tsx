/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { hslToHex, parseHexColor, ROLE_COLOR_PRESETS, rgbToHsl } from "@aulora/core";
import { cn, RoleColorPreview } from "@aulora/ui-web";
import { useRef } from "react";

const WHEEL_SIZE = 112;
const DEFAULT_HUE = 16;
const DEFAULT_SATURATION = 0.72;
const DEFAULT_LIGHTNESS = 0.55;

/**
 * A role colour: a hue/saturation wheel for any custom colour, a lightness
 * control for readable shades, the preset palette, a clear option and a live
 * preview of how the role name reads in both themes.
 */
export function RoleColorPicker({
  value,
  onChange,
  roleName = "",
  mentionable = false,
  disabled = false,
}: {
  readonly value: string;
  readonly onChange: (color: string) => void;
  /** The role name being edited; the preview falls back to “Moderator”. */
  readonly roleName?: string;
  /** Show the `@role` mention pill when the role can be mentioned. */
  readonly mentionable?: boolean;
  readonly disabled?: boolean;
}) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const rgb = parseHexColor(value);
  const hsl = rgb === null ? null : rgbToHsl(rgb);
  const hue = hsl?.h ?? DEFAULT_HUE;
  const saturation = hsl?.s ?? DEFAULT_SATURATION;
  const lightness = hsl?.l ?? DEFAULT_LIGHTNESS;

  const apply = (nextHue: number, nextSaturation: number, nextLightness: number) => {
    onChange(hslToHex(nextHue, nextSaturation, nextLightness));
  };

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const wheel = wheelRef.current;
    if (wheel === null) {
      return;
    }
    const rect = wheel.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const radius = rect.width / 2;
    const nextSaturation = Math.min(1, Math.hypot(dx, dy) / radius);
    // The conic gradient starts at 12 o’clock; atan2 starts at 3 o’clock.
    const nextHue = (Math.atan2(dy, dx) * (180 / Math.PI) + 90 + 360) % 360;
    apply(nextHue, nextSaturation, lightness);
  };

  const markerRadius = (WHEEL_SIZE / 2 - 9) * saturation;
  const markerAngle = ((hue - 90) * Math.PI) / 180;
  const markerX = WHEEL_SIZE / 2 + Math.cos(markerAngle) * markerRadius;
  const markerY = WHEEL_SIZE / 2 + Math.sin(markerAngle) * markerRadius;

  return (
    <div className={cn("flex flex-col gap-3", disabled && "opacity-50")}>
      <span className="text-[12px] font-medium text-text-muted">Role color</span>
      <div className="flex flex-wrap items-start gap-4">
        <div className="relative shrink-0" style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}>
          <div
            ref={wheelRef}
            role="img"
            aria-label="Role color wheel; use the hue and saturation sliders to adjust with a keyboard"
            onPointerDown={(event) => {
              if (disabled) {
                return;
              }
              event.currentTarget.setPointerCapture(event.pointerId);
              pick(event);
            }}
            onPointerMove={(event) => {
              if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) {
                return;
              }
              pick(event);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            className={cn(
              "relative h-full w-full rounded-full ring-1 ring-inset ring-border/70 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2",
              disabled ? "pointer-events-none" : "cursor-crosshair",
            )}
            style={{
              background:
                "radial-gradient(circle at center, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0) 70%), conic-gradient(from 0deg, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)",
            }}
          />
          {hsl !== null && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{
                left: markerX,
                top: markerY,
                backgroundColor: value,
              }}
            />
          )}
        </div>

        <div className="flex min-w-[140px] flex-1 flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-text-muted">Custom color</span>
            <span className="font-mono text-[12px] uppercase text-text">
              {value.length > 0 ? value : "None"}
            </span>
          </div>
          {(["Hue", "Saturation"] as const).map((label) => (
            <label key={label} className="flex flex-col gap-1 text-[12px] text-text-muted">
              {label}
              <input
                type="range"
                min={0}
                max={label === "Hue" ? 360 : 100}
                value={Math.round(label === "Hue" ? hue : saturation * 100)}
                disabled={disabled}
                onChange={(event) =>
                  apply(
                    label === "Hue" ? Number(event.currentTarget.value) : hue,
                    label === "Saturation" ? Number(event.currentTarget.value) / 100 : saturation,
                    lightness,
                  )
                }
              />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-[12px] text-text-muted">
              Lightness
              <span className="tabular-nums">{Math.round(lightness * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(lightness * 100)}
              disabled={disabled}
              onChange={(event) => {
                apply(hue, saturation, Number(event.currentTarget.value) / 100);
              }}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange("");
            }}
            className="w-fit rounded-full border border-border px-2.5 py-1 text-[12px] text-text-muted transition hover:text-text disabled:pointer-events-none"
          >
            Clear color
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ROLE_COLOR_PRESETS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Use color ${color}`}
            aria-pressed={value.trim().toUpperCase() === color}
            disabled={disabled}
            onClick={() => {
              onChange(color);
            }}
            className={cn(
              "h-6 w-6 rounded-full border transition disabled:pointer-events-none",
              value.trim().toUpperCase() === color
                ? "border-text ring-2 ring-accent/40"
                : "border-border",
            )}
            style={{ backgroundColor: color }}
          />
        ))}
        <span
          className="ml-1 inline-flex items-center text-[12px] text-text-muted"
          aria-hidden="true"
        >
          Drag the wheel for any color
        </span>
      </div>

      <RoleColorPreview
        name={roleName}
        color={value}
        mentionable={mentionable}
        disabled={disabled}
        onApplySuggestion={(color) => {
          onChange(color);
        }}
      />
    </div>
  );
}
