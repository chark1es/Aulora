/** Canonical backend origin; retain invalid/relative identifiers without throwing. */
export function serverOrigin(serverUrl: string): string {
  try {
    const origin = new URL(serverUrl).origin;
    return origin === "null" ? serverUrl : origin;
  } catch {
    return serverUrl;
  }
}

export function storageScope(serverUrl: string, userId: string): string {
  return `${encodeURIComponent(serverOrigin(serverUrl))}:${encodeURIComponent(userId)}`;
}
