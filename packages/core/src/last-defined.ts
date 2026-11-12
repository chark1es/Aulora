/** Keeps the last defined result across a temporary loading gap. */
export function keepLastDefined<T>(previous: T | undefined, next: T | undefined): T | undefined {
  return next ?? previous;
}
