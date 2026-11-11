/** Bound every public pagination window while retaining cursors and byte limits. */
export function clampPageSize(numItems: number): number {
  return Number.isFinite(numItems) ? Math.max(1, Math.min(100, Math.floor(numItems))) : 100;
}
