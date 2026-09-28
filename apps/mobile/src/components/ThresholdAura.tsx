import { Logo } from "@aulora/ui-native";
import { View } from "react-native";

export interface ThresholdAuraProps {
  /** Scales the default doorway mark (ignored when `children` is provided). */
  readonly size?: number;
  /** When set, the resolved workspace avatar sits at the centre as the keyhole. */
  readonly children?: React.ReactNode;
  /**
   * No-op. The aura's "breathing" loop lived with the concentric circles that
   * have since been removed, so this is accepted for API compatibility and has
   * no effect.
   */
  readonly breathing?: boolean;
}

/**
 * The Aulora signature doorway mark. It used to be a "threshold aura": a large
 * doorway centred inside soft concentric circles of Ember that slowly
 * "breathed". Those circles and their animation are gone — the mark now sits
 * directly on the surface, centred in a plain, non-circular wrapper. The whole
 * composition is decorative and hidden from assistive technologies.
 */
export function ThresholdAura({ size = 132, children }: ThresholdAuraProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      {children !== undefined ? children : <Logo size={Math.round(size * 0.42)} />}
    </View>
  );
}
