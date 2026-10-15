/**
 * Shared Notes-addon types and limits.
 *
 * A note is a Markdown document stored in a folder, tagged with workspace
 * tags. All of these values cross the client/server boundary as plaintext;
 * the server seals the stored columns (see `packages/convex/convex/schema.ts`).
 */

export interface NoteFolder {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly position: number;
}

export interface NoteTag {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface NoteSummary {
  readonly id: string;
  readonly folderId: string | null;
  readonly title: string;
  readonly tagIds: readonly string[];
  readonly creatorId: string;
  readonly lastEditorId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly revision: number;
  readonly archived: boolean;
}

export interface NoteDetail extends NoteSummary {
  readonly body: string;
}

export interface NoteSnapshot {
  readonly title: string;
  readonly body: string;
  readonly folderId: string | null;
  readonly tagIds: readonly string[];
}

export type NoteRevisionAction =
  | "created"
  | "updated"
  | "renamed"
  | "moved"
  | "tagged"
  | "archived"
  | "restored"
  | "deleted";

export interface NoteRevision {
  readonly id: string;
  readonly noteId: string;
  readonly actorId: string;
  readonly action: NoteRevisionAction;
  readonly before: NoteSnapshot | null;
  readonly after: NoteSnapshot | null;
  readonly at: number;
}

export interface NoteSearchHit {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly updatedAt: number;
}

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 100_000;
export const NOTE_FOLDER_NAME_MAX = 80;
export const NOTE_TAG_NAME_MAX = 32;
export const NOTE_MAX_FOLDERS = 500;
export const NOTE_MAX_NOTES = 2000;
export const NOTE_MAX_TAGS = 200;
export const NOTE_MAX_REVISIONS = 100;

/** Text fed to the client-side search index for one note. */
export function notePlainText(title: string, body: string): string {
  return `${title}\n${body}`;
}
