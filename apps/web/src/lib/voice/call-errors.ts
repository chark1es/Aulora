export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "The call ran into a problem. Please try again.";
}

/** A clear, actionable reason media could not start. */
export function mediaMessage(error: unknown): string {
  const mediaDevices =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { readonly mediaDevices?: MediaDevices }).mediaDevices;
  if (mediaDevices === undefined) {
    return "Audio and video need a secure connection. Open Aulora over HTTPS or on localhost.";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone and camera access was blocked. Allow it in your browser to be heard.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Connect one and rejoin the call.";
  }
  return "Couldn't start your microphone. Check your device and permissions.";
}

export function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "NotAllowedError")
  );
}
