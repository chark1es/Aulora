import { useId } from "react";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

export interface LogoProps {
  /** Rendered size in pixels (square). */
  size?: number;
  /** Accessible name; when omitted the mark is decorative. */
  title?: string;
  className?: string;
}

// The mark is drawn on its own 1254-unit canvas and is self-contained: a dark
// rounded tile carries a full-colour, gradient-filled "A". It therefore reads
// correctly in light and dark themes without any token recolouring.
const CANVAS = 1254;

// The tile's corner radius is ~22.9% of the canvas (22/96), matching the app's
// squircle tiles and avatars.
const TILE_RADIUS = 287;

const TILE_FILL = "#18181A";

const WAVE_PATH =
  "M 452.8 870.6 C 496.4 771.5 602.2 660 687.1 654.4 C 747.4 649.9 773 668 810 685 C 857.5 707.4 900.2 711.2 926.4 762 L 980 863.6 C 997 894.6 993.9 922.4 947.9 922 L 885.8 921.2 C 838.6 920 802.2 890 753.5 840 C 715.4 801.5 672.4 757.2 612 754.2 C 543.1 751.2 474 806.8 452.8 870.6 Z";

const MAIN_PATH =
  "M 312 922 L 374.9 921 C 390 920.5 424.4 901.9 446.5 868.7 C 468.7 836.6 484 810.6 505.5 773.8 L 585 639 C 604 607 620 580 631.5 578 C 670.1 573 700.6 594 723 607 C 785.5 644 832.5 662 861 668 C 882.5 672.8 873.2 657.3 865.1 642 L 726.5 374.5 C 701.4 326.5 662.4 311 627.5 311 C 579.9 312 548.6 340.4 534 368.9 L 274.2 843.1 C 252.8 879.5 265.4 921.2 312 922 Z";

const FOLD_PATH =
  "M 585 639 C 636.4 556.8 687.6 455 733.5 455 C 757.2 455 782.5 485.2 800.5 519.2 L 865.1 642 C 873.2 657.3 882.5 672.8 861 668 C 832.5 662 785.5 644 725 608 C 700.6 594 670.1 573 631.5 578 C 620 580 604 607 585 639 Z";

/**
 * The Aulora mark on native: a bold angular "A" with an inner fold over a
 * sweeping wave, all sitting on a dark squircle tile, drawn through
 * `react-native-svg`. The artwork is full-colour and self-contained, so it
 * renders the same in light and dark themes. Gradient ids are namespaced with
 * a per-instance `useId` so several marks can coexist without their `url(#…)`
 * references colliding. Passing `title` makes it a labelled image; otherwise
 * it is decorative.
 */
export function Logo({ size = 32, title, className }: LogoProps) {
  const uid = `aulora-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <Svg
      viewBox="0 0 1254 1254"
      width={size}
      height={size}
      {...(className !== undefined ? { className } : {})}
      {...(title !== undefined ? { accessibilityLabel: title } : {})}
      accessibilityElementsHidden={title === undefined}
      importantForAccessibility={title === undefined ? "no-hide-descendants" : "auto"}
    >
      <Defs>
        <LinearGradient
          id={`${uid}-main`}
          gradientUnits="userSpaceOnUse"
          x1={740}
          y1={259}
          x2={729}
          y2={871}
        >
          <Stop offset={0} stopColor="#FFB84D" />
          <Stop offset={0.5} stopColor="#F3651E" />
          <Stop offset={1} stopColor="#D0481B" />
        </LinearGradient>
        <LinearGradient
          id={`${uid}-fold`}
          gradientUnits="userSpaceOnUse"
          x1={642}
          y1={467}
          x2={834}
          y2={665}
        >
          <Stop offset={0} stopColor="#7C1D0A" />
          <Stop offset={0.5} stopColor="#D84C1C" />
          <Stop offset={0.85} stopColor="#FF7723" />
          <Stop offset={1} stopColor="#F89C3E" />
        </LinearGradient>
        <LinearGradient
          id={`${uid}-wave`}
          gradientUnits="userSpaceOnUse"
          x1={536}
          y1={998}
          x2={991}
          y2={663}
        >
          <Stop offset={0} stopColor="#002301" />
          <Stop offset={0.22} stopColor="#B42510" />
          <Stop offset={0.6} stopColor="#F86F22" />
          <Stop offset={1} stopColor="#FCD75E" />
        </LinearGradient>
      </Defs>
      <Rect width={CANVAS} height={CANVAS} rx={TILE_RADIUS} fill={TILE_FILL} />
      <Path d={WAVE_PATH} fill={`url(#${uid}-wave)`} />
      <Path d={MAIN_PATH} fill={`url(#${uid}-main)`} />
      <Path d={FOLD_PATH} fill={`url(#${uid}-fold)`} />
    </Svg>
  );
}
