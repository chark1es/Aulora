// base64url helpers for the Aulora setup entrypoint.
//
//   node b64url.mjs encode <value>   # prints <value> as unpadded base64url
//   node b64url.mjs random <bytes>   # prints <bytes> random bytes as base64url
//
// These live in a file rather than in `node -e`. Bun's `node` shim drops
// positional arguments after `-e`, so `process.argv[1]` was undefined and setup
// aborted before it could set Convex env vars or deploy functions.

import { randomBytes } from "node:crypto";

function main(argv) {
  const [mode, value] = argv;
  if (mode === "encode") {
    if (typeof value !== "string") {
      throw new Error("encode requires a value");
    }
    return Buffer.from(value, "utf8").toString("base64url");
  }
  if (mode === "random") {
    const bytes = Number(value);
    if (!Number.isInteger(bytes) || bytes <= 0) {
      throw new Error("random requires a positive byte count");
    }
    return randomBytes(bytes).toString("base64url");
  }
  throw new Error(`unknown mode: ${mode}`);
}

try {
  process.stdout.write(main(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`b64url.mjs: ${error.message}\n`);
  process.exit(1);
}
