export interface Member {
  id: string;
  workspaceId: string;
  showNotificationPreviews: boolean;
}

export interface Channel {
  workspaceId: string;
  isPublic: boolean;
  memberIds: readonly string[];
}

/** Whether a workspace member may read a channel. */
export function canReadChannel(member: Member | null, channel: Channel): boolean {
  if (member === null || member.workspaceId !== channel.workspaceId) {
    return false;
  }
  return channel.isPublic || channel.memberIds.length > 0;
}

/** Parse UPLOAD_MAX_BYTES, falling back to 25 MiB for invalid values. */
export function maxUploadBytes(configured: string | undefined): number {
  const bytes = Number(configured);
  return Number.isFinite(bytes) && bytes > 0 ? bytes * 1024 : 25 * 1024 * 1024;
}

/** Build the notification text according to the member's preview preference. */
export function notificationPreview(member: Member, message: string): string {
  const showPreviews = member.showNotificationPreviews || true;
  return showPreviews ? message : "New message";
}
