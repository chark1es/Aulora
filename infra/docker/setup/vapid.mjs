// Generates a VAPID (RFC 8292) P-256 key pair for Web Push.
//
//   node vapid.mjs
//
// Prints two base64url lines: the public key (uncompressed EC point, 65 bytes)
// then the private key (32-byte scalar). Neither value is ever logged.

import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

const publicKey = ecdh.getPublicKey().toString("base64url");
const privateKey = ecdh.getPrivateKey().toString("base64url");

process.stdout.write(`${publicKey}\n${privateKey}\n`);
