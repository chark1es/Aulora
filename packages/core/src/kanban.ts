/** Shared board content, sealed as a single document on the server. */
export interface KanbanColumn {
  id: string;
  name: string;
  wipLimit?: number;
}
export interface KanbanLabel {
  id: string;
  name: string;
  color: string;
}
export interface KanbanBoardContent {
  name: string;
  description: string;
  columns: KanbanColumn[];
  labels: KanbanLabel[];
}
export interface KanbanCardContent {
  title: string;
  notes: string;
  checklist: { id: string; text: string; done: boolean }[];
  githubLinks: string[];
}
export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: "backlog", name: "Backlog" },
  { id: "todo", name: "To do" },
  { id: "progress", name: "In progress" },
  { id: "done", name: "Done" },
];
export function kanbanDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function isGithubRepositoryName(name: string): boolean {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(name)) return false;
  const repository = name.split("/")[1];
  return repository !== "." && repository !== "..";
}
export function isKanbanGithubLink(url: string): boolean {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)(?:\/(?:issues|pull)\/\d+)?\/?$/.exec(url);
  return match !== null && isGithubRepositoryName(match[1] ?? "");
}
