import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "./cn";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Diameter in pixels. */
  size?: number;
  /** Accessible status text, e.g. "Loading" or "Reconnecting". */
  label?: string;
  /** Overrides the particle color; defaults to `currentColor`. */
  color?: string;
}

const PARTICLE_COUNT = 8;
const RADIUS = 8;
const CENTER = 12;

/**
 * The Aulora particle spinner. A ring of particles that slowly orbits while
 * each particle pulses, used for loading and the reconnecting bar. Purely
 * presentational: it renders a `role="status"` and honors
 * `prefers-reduced-motion`.
 */
export function Spinner({
  size = 24,
  label = "Loading",
  color,
  className,
  style,
  ...rest
}: SpinnerProps) {
  const reducedMotion = usePrefersReducedMotion();
  const particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const angle = (index / PARTICLE_COUNT) * Math.PI * 2;
    return {
      index,
      cx: CENTER + RADIUS * Math.cos(angle),
      cy: CENTER + RADIUS * Math.sin(angle),
    };
  });

  const mergedStyle: CSSProperties = { width: size, height: size, ...style };
  if (color !== undefined) {
    mergedStyle.color = color;
  }

  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex shrink-0 items-center justify-center text-accent", className)}
      style={mergedStyle}
      {...rest}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <g>
          {!reducedMotion && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 12 12"
              to="360 12 12"
              dur="2.4s"
              repeatCount="indefinite"
            />
          )}
          {particles.map(({ index, cx, cy }) => (
            <circle key={index} cx={cx} cy={cy} r={1.35}>
              {!reducedMotion && (
                <animate
                  attributeName="opacity"
                  values="0.18;1;0.18"
                  dur="1.2s"
                  begin={`${(index / PARTICLE_COUNT) * 1.2}s`}
                  repeatCount="indefinite"
                />
              )}
            </circle>
          ))}
        </g>
      </svg>
    </span>
  );
}
