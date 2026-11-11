/** Maps in bounded batches, preserving input order and rejection semantics. */
export async function mapInChunks<T, R>(
  items: readonly T[],
  size: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    results.push(...(await Promise.all(items.slice(offset, offset + size).map(map))));
  }
  return results;
}

/** Every endpoint is attempted even when another endpoint rejects. */
export async function settleInChunks<T, R>(
  items: readonly T[],
  size: number,
  map: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    results.push(...(await Promise.allSettled(items.slice(offset, offset + size).map(map))));
  }
  return results;
}
