import { createContext, type ReactNode, useContext } from "react";

const AvatarContext = createContext<ReadonlyMap<string, string>>(new Map());

/** Workspace pictures are optional; standalone surfaces use generated avatars. */
export function AvatarProvider({
  urls,
  children,
}: {
  readonly urls: ReadonlyMap<string, string>;
  readonly children: ReactNode;
}) {
  return <AvatarContext.Provider value={urls}>{children}</AvatarContext.Provider>;
}

export function useAvatarUrls(): ReadonlyMap<string, string> {
  return useContext(AvatarContext);
}
