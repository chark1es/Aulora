import { View } from "react-native";
import { BlobBackdrop } from "./BlobBackdrop";

export interface AuthScaffoldProps {
  /** Rendered below the intro, directly on the page. */
  readonly children: React.ReactNode;
  /** The hero mark, centred in the colour band. */
  readonly aura?: React.ReactNode;
  /** Title and supporting copy between the band and the form. */
  readonly intro?: React.ReactNode;
  /** Icon seed for the drifting blob band; omitted for a plain band. */
  readonly seed?: string;
  /** `false` lets the blob field drift; `true`/`null` holds it still. */
  readonly reduceMotion?: boolean | null;
}

/**
 * Shared layout for the pre-session screens: an inset, rounded colour band on
 * top carrying the workspace's blobatar, then the title and the form set
 * directly on the page. There is no card around the form, so the screen reads as
 * one composition rather than a panel floating over a wallpaper. The content
 * width is capped on tablets so a primary button never stretches edge to edge
 * (HIG: “Avoid full-width buttons”). Callers own keyboard avoidance.
 */
export function AuthScaffold({ children, aura, intro, seed, reduceMotion }: AuthScaffoldProps) {
  return (
    <View className="flex-1 px-4 pb-8 pt-4">
      <View className="h-[236px] w-full max-w-content self-center overflow-hidden rounded-[28px] border border-border">
        {seed !== undefined && (
          <BlobBackdrop seed={seed} {...(reduceMotion !== undefined ? { reduceMotion } : {})} />
        )}
        <View className="flex-1 items-center justify-center">{aura}</View>
      </View>
      <View className="w-full max-w-content gap-7 self-center px-2 pt-8">
        {intro !== undefined && <View className="items-stretch">{intro}</View>}
        {children}
      </View>
    </View>
  );
}
