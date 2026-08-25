import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION = "v1";

/**
 * Application-level encryption for Yahoo tokens.
 *
 * Deviates from PLAN §2, which sketched Supabase Vault/pgsodium. Doing it in
 * the app keeps the key out of the database entirely — a database dump alone
 * decrypts nothing — and avoids depending on Vault's shifting API surface.
 * The trade is that key rotation is ours to run; the `v1.` prefix is the hook
 * for that.
 */
function encryptionKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}. Generate one with: openssl rand -base64 32`,
    );
  }

  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Malformed encrypted payload");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Detached HMAC over a short payload, keyed by the same secret as the token
 * encryption above.
 *
 * Phase 4's staged pipeline chains itself over HTTP, so each hop has to prove
 * it is us. Signing the run id rather than presenting a fixed pipeline secret
 * means a leaked token authorizes exactly one sync run, not every future one.
 */
export function signPayload(payload: string): string {
  return createHmac("sha256", encryptionKey()).update(payload).digest("base64url");
}

export function verifySignature(payload: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(payload));
  const actual = Buffer.from(signature);

  // Length has to match before `timingSafeEqual` will look at the bytes, and
  // comparing lengths first leaks nothing an attacker cannot already see.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
