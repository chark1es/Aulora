import { keepLastDefined } from "@aulora/core";
import { useRef } from "react";

/** React form of {@link keepLastDefined}. */
export function useLastDefined<T>(value: T | undefined): T | undefined {
  const last = useRef<T | undefined>(value);
  if (value !== undefined) {
    last.current = value;
  }
  return keepLastDefined(last.current, value);
}
