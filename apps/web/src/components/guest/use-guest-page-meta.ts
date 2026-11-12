import { useEffect } from "react";

/**
 * Marks the guest page as private to browsers and crawlers that run scripts:
 * not indexed, and no `Referer` sent from it. The token lives in the URL
 * fragment, which is never sent to a server or in a `Referer` anyway; this is
 * the second layer. The nginx config sets the same as response headers.
 */
export function useGuestPageMeta(): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Join a call";
    const added: HTMLMetaElement[] = [];
    for (const [name, content] of [
      ["robots", "noindex, nofollow, noarchive"],
      ["referrer", "no-referrer"],
    ] as const) {
      const meta = document.createElement("meta");
      meta.name = name;
      meta.content = content;
      document.head.append(meta);
      added.push(meta);
    }
    return () => {
      document.title = previousTitle;
      for (const meta of added) {
        meta.remove();
      }
    };
  }, []);
}
