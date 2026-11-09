/** The list title for a session: its channel's name, or a generic one for a room with none. */
export function sessionTitle(
  channelId: string | null,
  titles: ReadonlyMap<string, string>,
): string {
  if (channelId === null) {
    return "Scheduled room";
  }
  return titles.get(channelId) ?? "Call";
}

/** "12 min", "1 h 5 min", or "In progress" while the session has no end. */
export function formatSessionLength(startedAt: number, endedAt: number | null): string {
  if (endedAt === null) {
    return "In progress";
  }
  const minutes = Math.max(0, Math.round((endedAt - startedAt) / 60_000));
  if (minutes < 1) {
    return "Under a minute";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
