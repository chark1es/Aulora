/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { cn } from "@aulora/ui-web";
import { useRef } from "react";

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

const WHEEL_SIZE = 112;
const DEFAULT_HUE = 16;
const DEFAULT_SATURATION = 0.72;
const DEFAULT_LIGHTNESS = 0.55;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

function hexToRgb(value: string): Rgb | null {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (match === null) {
    return null;
  }
  const [, raw = ""] = match;
  if (raw.length === 0) {
    return null;
  }
  let hex = raw;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((part) => part + part)
      .join("");
  }
  const int = Number.parseInt(hex, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === red) {
    h = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (max === green) {
    h = (blue - red) / delta + 2;
  } else {
    h = (red - green) / delta + 4;
  }
  return { h: h * 60, s, l };
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [red, green, blue] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
}

/**
 * A role colour: a hue/saturation wheel for any custom colour, a lightness
 * control for readable shades, the preset palette and a clear option.
 */
export function RoleColorPicker({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: string;
  readonly onChange: (color: string) => void;
  readonly disabled?: boolean;
}) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const rgb = hexToRgb(value);
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
    // The conic gradient starts at 12 o'clock; atan2 starts at 3 o'clock.
    const nextHue = (Math.atan2(dy, dx) * (180 / Math.PI) + 90 + 360) % 360;
    apply(nextHue, nextSaturation, lightness);
  };

  const onWheelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    const hueStep = event.shiftKey ? 12 : 4;
    const saturationStep = event.shiftKey ? 0.12 : 0.04;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      apply(hue + (event.key === "ArrowRight" ? hueStep : -hueStep), saturation, lightness);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      apply(
        hue,
        Math.min(
          1,
          Math.max(0, saturation + (event.key === "ArrowUp" ? saturationStep : -saturationStep)),
        ),
        lightness,
      );
    }
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
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="Role color wheel"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hue)}
            aria-valuetext={value.length > 0 ? value : "No color"}
            aria-disabled={disabled}
            onKeyDown={onWheelKeyDown}
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
            <span className="text-[11px] text-text-muted">Custom color</span>
            <span className="font-mono text-[11px] uppercase text-text">
              {value.length > 0 ? value : "None"}
            </span>
          </div>
          <label className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-[11px] text-text-muted">
              Lightness
              <span className="tabular-nums">{Math.round(lightness * 100)}%</span>
            </span>
            <input
              type="range"
              min={20}
              max={80}
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
            className="w-fit rounded-full border border-border px-2.5 py-1 text-[11px] text-text-muted transition hover:text-text disabled:pointer-events-none"
          >
            Clear color
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Use color ${color}`}
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
          className="ml-1 inline-flex items-center text-[11px] text-text-muted"
          aria-hidden="true"
        >
          Drag the wheel for any color
        </span>
      </div>
    </div>
  );
}
