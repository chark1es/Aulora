import { NoteMarkdown } from "./NoteMarkdown";

/** A read-only, richly rendered note, used for the editor's live preview. */
export function NotePreview({ title, body }: { title: string; body: string }) {
  return (
    <article className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold tracking-tight text-text">
        {title.trim().length > 0 ? title : "Untitled note"}
      </h2>
      <NoteMarkdown text={body} />
    </article>
  );
}
