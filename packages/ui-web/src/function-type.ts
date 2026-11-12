/**
 * Mirror of `packages/core/src/function-type.ts` (this package cannot depend on
 * `@aulora/core`). Names a function type without declaring parameter names in a type position.
 *
 * ESLint's `no-unused-vars` reports every parameter of a function type
 * (`(value: T) => void`, interface method signatures) as unused. This helper
 * derives the type from a real function whose parameters are used, and carries
 * the parameter names in a labelled tuple instead:
 * `Fn<[at: number, now: number], string>`.
 */
function signature<A extends readonly unknown[], R>(...args: A): R {
  void args;
  throw new Error("Fn is a type-only helper and must not be called");
}

export type Fn<A extends readonly unknown[], R> = typeof signature<A, R>;
