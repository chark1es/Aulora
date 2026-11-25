import { ConvexError } from "convex/values";

/**
 * Server-side validation of MCP tool arguments. The JSON Schema advertised to
 * clients is documentation only: every value is re-checked here, unknown keys
 * are rejected, and failures are `ConvexError`s whose text is safe to return.
 */

export type ArgMap = ReadonlyMap<string, unknown>;

function invalid(detail: string): ConvexError<string> {
  return new ConvexError(`Invalid arguments: ${detail}`);
}

/** The arguments as a Map, rejecting non-objects and keys outside `allowed`. */
export function readArgs(raw: unknown, allowed: readonly string[]): ArgMap {
  if (raw === undefined || raw === null) {
    return new Map();
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid("expected an object");
  }
  const entries = Object.entries(raw);
  for (const [key] of entries) {
    if (!allowed.includes(key)) {
      throw invalid(`unknown argument "${key}"`);
    }
  }
  return new Map(entries);
}

export function reqString(args: ArgMap, key: string): string {
  const value = args.get(key);
  if (typeof value !== "string") {
    throw invalid(`"${key}" must be a string`);
  }
  return value;
}

export function optString(args: ArgMap, key: string): string | undefined {
  return args.get(key) === undefined ? undefined : reqString(args, key);
}

export function optBoolean(args: ArgMap, key: string): boolean | undefined {
  const value = args.get(key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw invalid(`"${key}" must be a boolean`);
  }
  return value;
}

export function optInteger(
  args: ArgMap,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const value = args.get(key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(`"${key}" must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function reqEnum<T extends string>(args: ArgMap, key: string, values: readonly T[]): T {
  const value = args.get(key);
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) {
    throw invalid(`"${key}" must be one of ${values.join(", ")}`);
  }
  return match;
}

export function optEnum<T extends string>(
  args: ArgMap,
  key: string,
  values: readonly T[],
): T | undefined {
  return args.get(key) === undefined ? undefined : reqEnum(args, key, values);
}

/** An optional array of at most `maxItems` entries, each mapped by `parseItem`. */
export function optArray<T>(
  args: ArgMap,
  key: string,
  maxItems: number,
  parseItem: (item: unknown) => T,
): T[] | undefined {
  const value = args.get(key);
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw invalid(`"${key}" must be an array`);
  }
  if (value.length > maxItems) {
    throw invalid(`"${key}" may have at most ${maxItems} entries`);
  }
  return value.map(parseItem);
}

export function stringItem(item: unknown): string {
  if (typeof item !== "string") {
    throw invalid("expected a list of strings");
  }
  return item;
}
