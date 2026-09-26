/**
 * Loads every Convex function module for `convex-test`. The glob path is
 * relative to this file, so `convex-test` discovers the function root from the
 * `_generated` directory it contains.
 */
export const modules = import.meta.glob("../convex/**/*.*s");
