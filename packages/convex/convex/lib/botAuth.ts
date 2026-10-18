/**
 * Bot identity: token generation/hashing, JWT minting and the bot lookup used
 * by the permission layer. Nothing here ever logs or returns key material.
 * See `docs/bots-design.md`.
 */
import {
  BOT_JWT_ALGORITHM,
  BOT_JWT_AUDIENCE,
  BOT_JWT_ISSUER,
  BOT_JWT_TTL_SECONDS,
  BOT_TOKEN_PREFIX,
  isBotUserId,
} from "@aulora/core";
import { ConvexError } from "convex/values";
import { importJWK, type JWK, SignJWT } from "jose";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Env } from "./env";

type ReadCtx = QueryCtx | MutationCtx;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A new API token: `abt_` plus 256 random bits as 43 base64url characters. */
export function generateBotToken(): string {
  return `${BOT_TOKEN_PREFIX}${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/** SHA-256 hex of a token; the only form that is stored or looked up. */
export async function hashBotToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

export function botTokenLast4(token: string): string {
  return token.slice(-4);
}

/** True when the signing key is present, so `POST /bots/token` can mint a JWT. */
export function botJwtConfigured(env: Env = process.env): boolean {
  return (env.BOT_JWT_PRIVATE_JWK ?? "").trim().length > 0;
}

function parsePrivateJwk(raw: string): JWK {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConvexError("Bot JWT key is invalid");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ConvexError("Bot JWT key is invalid");
  }
  return parsed as JWK;
}

export interface BotJwtInput {
  readonly userId: string;
  /** Injectable clock in milliseconds (tests); defaults to `Date.now()`. */
  readonly now?: number;
}

export interface SignedBotJwt {
  readonly token: string;
  /** Expiry in milliseconds, for the token-exchange response. */
  readonly expiresAt: number;
}

/**
 * Mints the short-lived bot JWT from the deployment's ES256 private JWK. The
 * header carries the JWK `kid` because Convex requires it; claims are
 * `iss`/`aud`/`sub`/`iat`/`exp` per `docs/bots-design.md`.
 */
export async function signBotJwt(
  input: BotJwtInput,
  env: Env = process.env,
): Promise<SignedBotJwt> {
  const raw = env.BOT_JWT_PRIVATE_JWK;
  if (raw === undefined || raw.trim().length === 0) {
    throw new ConvexError("Bot JWT is not configured");
  }
  const jwk = parsePrivateJwk(raw);
  if (typeof jwk.kid !== "string" || jwk.kid.length === 0) {
    throw new ConvexError("Bot JWT key is missing a kid");
  }
  const key = await importJWK(jwk, BOT_JWT_ALGORITHM);
  const now = input.now ?? Date.now();
  const iat = Math.floor(now / 1000);
  const exp = iat + BOT_JWT_TTL_SECONDS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: BOT_JWT_ALGORITHM, typ: "JWT", kid: jwk.kid })
    .setIssuer(BOT_JWT_ISSUER)
    .setAudience(BOT_JWT_AUDIENCE)
    .setSubject(input.userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);
  return { token, expiresAt: exp * 1000 };
}

/** The bot whose `userId` is `bot_<id>`, or `null` when there is no such row. */
export async function loadBotByUserId(ctx: ReadCtx, userId: string): Promise<Doc<"bots"> | null> {
  return await ctx.db
    .query("bots")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** Rejects a bot caller for actions that make no sense for one (DMs, avatars). */
export function assertNotBot(userId: string, action: string): void {
  if (isBotUserId(userId)) {
    throw new ConvexError(`Bots cannot ${action}`);
  }
}
