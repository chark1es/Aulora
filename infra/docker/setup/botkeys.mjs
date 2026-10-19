// Bot JWT key material for the Aulora setup entrypoint.
//
//   node botkeys.mjs            # prints the private JWK then the public JWK,
//                               # one JSON document per line
//   node botkeys.mjs decode <b> # prints the JSON encoded in base64url <b>
//
// The pair is ES256 (P-256). Both JWKs carry the same random `kid`, which Convex
// matches against the JWT header when a bot signs in. Values go to stdout only;
// nothing is ever written to a log.

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export function generateJwks() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kid = randomBytes(12).toString("base64url");
  const privateJwk = { ...privateKey.export({ format: "jwk" }), kid };
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid };
  return { privateJwk: JSON.stringify(privateJwk), publicJwk: JSON.stringify(publicJwk) };
}

export function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function main(argv) {
  if (argv[0] === "decode") {
    if (typeof argv[1] !== "string" || argv[1].length === 0) {
      throw new Error("decode requires a base64url value");
    }
    return `${decodeBase64Url(argv[1])}\n`;
  }
  const { privateJwk, publicJwk } = generateJwks();
  return `${privateJwk}\n${publicJwk}\n`;
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    process.stdout.write(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`botkeys.mjs: ${error.message}\n`);
    process.exit(1);
  }
}
