const PRESENCE_LABELS = new Map<string, string>([
  ["online", "Online"],
  ["idle", "Idle"],
  ["dnd", "Do not disturb"],
  ["offline", "Offline"],
]);

export function presenceLabel(status: string): string {
  return PRESENCE_LABELS.get(status) ?? "Offline";
}
