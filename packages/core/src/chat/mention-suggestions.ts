/** Stable autocomplete groups: online broadcast, all-members broadcast, roles, users. */
export function orderMentionSuggestions<T extends { readonly key: string }>(
  items: readonly T[],
): T[] {
  const rank = (key: string) =>
    /^@?here$/.test(key) ? 0 : /^@?everyone$/.test(key) ? 1 : key.startsWith("role:") ? 2 : 3;
  return [...items].sort((a, b) => rank(a.key) - rank(b.key));
}
