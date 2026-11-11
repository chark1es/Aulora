/** Keep additions made while sending, removing only the submitted file keys. */
export function remainingComposerFiles<T extends { key: string }>(
  current: readonly T[],
  sent: readonly T[],
): T[] {
  const keys = new Set(sent.map((file) => file.key));
  return current.filter((file) => !keys.has(file.key));
}
