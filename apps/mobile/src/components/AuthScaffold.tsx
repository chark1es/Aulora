import { View } from "react-native";

export interface AuthScaffoldProps {
  /** Rendered inside the centred column, below the aura. */
  readonly children: React.ReactNode;
  /** Optional override for the decorative aura slot. */
  readonly aura?: React.ReactNode;
}

/**
 * Shared layout for the two pre-session screens. A single centred column that
 * respects safe areas and keeps content in the readable, one-handed reach
 * zone; the content width is capped (and centred) on tablet/regular widths so
 * a primary button never stretches edge to edge (HIG: "Avoid full-width
 * buttons"). Callers own keyboard avoidance so it can wrap the whole column.
 */
export function AuthScaffold({ children, aura }: AuthScaffoldProps) {
  return (
    <View className="flex-1 items-center justify-center px-6 py-6">
      <View className="w-full max-w-content items-stretch gap-7">
        {aura !== undefined && <View className="items-center">{aura}</View>}
        {children}
      </View>
    </View>
  );
}
