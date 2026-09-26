/**
 * Minimal typing for Vite's `import.meta.glob`, which Vitest injects at
 * runtime. Declared locally so the Convex package does not need Vite's types.
 */
interface ImportMeta {
  readonly glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}
