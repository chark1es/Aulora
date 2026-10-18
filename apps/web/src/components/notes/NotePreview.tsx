import { NoteMarkdown } from "./NoteMarkdown";

/**
 * A read-only, richly rendered note. The heading is optional so the editor's
 * Preview mode can keep showing the title input without printing it twice.
 */
export function NotePreview({ title, body }: { title?: string; body: string }) {
  const heading = (title ?? "").trim();
  return (
    <article className="flex flex-col gap-3">
      {title !== undefined && (
        <h2 className="text-xl font-semibold tracking-tight text-text">
          {heading.length > 0 ? heading : "Untitled note"}
        </h2>
      )}
      <NoteMarkdown text={body} />
    </article>
  );
}
