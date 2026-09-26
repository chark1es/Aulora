import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { usePalette } from "./theme";

export interface SpinnerProps {
  /** Diameter in pixels. */
  size?: number;
  /** Accessible status text, e.g. "Loading" or "Reconnecting". */
  label?: string;
  /** Overrides the particle color; defaults to the accent token. */
  color?: string;
  className?: string;
}

const PARTICLE_COUNT = 8;
const RADIUS = 8;
const CENTER = 12;

/**
 * The Aulora particle spinner for React Native: a ring of particles that slowly
 * orbits, mirroring the ui-web Spinner through `react-native-svg`.
 */
export function Spinner({ size = 24, label = "Loading", color, className }: SpinnerProps) {
  const rotation = useRef(new Animated.Value(0)).current;
  const palette = usePalette();

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 2400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [rotation]);

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const fill = color ?? palette.accent;
  const particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const angle = (index / PARTICLE_COUNT) * Math.PI * 2;
    return { angle, cx: CENTER + RADIUS * Math.cos(angle), cy: CENTER + RADIUS * Math.sin(angle) };
  });

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      {...(className !== undefined ? { className } : {})}
      style={{ width: size, height: size, transform: [{ rotate: spin }] }}
    >
      <Svg viewBox="0 0 24 24" width={size} height={size}>
        {particles.map((particle, index) => (
          <Circle
            key={particle.angle}
            cx={particle.cx}
            cy={particle.cy}
            r={1.35}
            fill={fill}
            opacity={0.25 + (index / PARTICLE_COUNT) * 0.75}
          />
        ))}
      </Svg>
    </Animated.View>
  );
}
