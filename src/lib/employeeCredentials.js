/**
 * Reversible encryption for employee passwords.
 *
 * These passwords are ENCRYPTED, not hashed, because an Admin must be able to
 * read one back when an employee forgets it (design decision D2). That is a
 * deliberate trade and it is worth being precise about what it does and does not
 * buy:
 *
 *   - A database dump, a read-only SQL user, or a stolen backup yields
 *     CIPHERTEXT ONLY. The key lives in the environment, never in a column.
 *   - It is NOT protection against a compromised application server, which holds
 *     the key by necessity. See the residual-risk section of the design.
 *
 * AES-256-GCM, so every value is authenticated as well as encrypted: a byte
 * flipped in the database makes `decryptPassword` throw rather than hand back
 * plausible-looking rubbish.
 *
 * A fresh 12-byte IV per call, which is why encrypting the same password twice
 * produces different ciphertext. That matters here: without it, two employees who
 * happen to share a password would be visible as two identical columns to anyone
 * who could read the table.
 *
 * Stored form is one base64 string of `iv || authTag || ciphertext`, so a single
 * TEXT column holds everything needed to decrypt and nothing else has to be kept
 * in step with it.
 *
 * Node's `crypto` only — no dependency added for this.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/** The env var holding the 32-byte key. */
export const KEY_ENV_VAR = 'EMPLOYEE_CREDENTIAL_KEY';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // the GCM standard; 96 bits
const TAG_BYTES = 16;

/**
 * Thrown when the key is absent or unusable.
 *
 * A distinct type so a route can answer `503 misconfigured` rather than a
 * generic `500` — the operator needs to know it is their deployment and not the
 * caller's request that is wrong.
 */
export class CredentialKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CredentialKeyError';
  }
}

/**
 * The configured key as a 32-byte Buffer.
 *
 * Accepts base64 or hex, because a key pasted from `openssl rand -base64 32` and
 * one from `openssl rand -hex 32` are both things an operator will plausibly
 * produce. Anything that does not decode to exactly 32 bytes is refused.
 *
 * NOT cached: a cached key would survive a rotation until the process restarted,
 * and on a serverless host that is an unpredictable length of time. Deriving it
 * per call costs a base64 decode.
 *
 * @returns {Buffer} the 32-byte key
 * @throws {CredentialKeyError} when the key is missing or the wrong length
 */
function readKey() {
  const raw = process.env[KEY_ENV_VAR];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new CredentialKeyError(
      `${KEY_ENV_VAR} is not set. Employee passwords cannot be read or written `
      + 'until it is configured. Generate one with: openssl rand -base64 32'
    );
  }

  const trimmed = raw.trim();
  // Hex first: a 64-character hex string is also valid base64, and as base64 it
  // would decode to 48 bytes and be rejected, so the more specific shape wins.
  //
  // This IS ambiguous for the handful of strings that are simultaneously valid
  // 64-char hex and valid base64 — `'A'.repeat(64)` is the obvious one. Such a
  // string is read as hex and yields a real 32-byte key. That is acceptable
  // because it only arises for a key an operator typed by hand rather than
  // generated, and either reading produces a usable key; what must never happen
  // is a SILENT change of interpretation between encrypt and decrypt, and it
  // cannot, because the rule is a pure function of the string.
  const candidate = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (candidate.length !== KEY_BYTES) {
    throw new CredentialKeyError(
      `${KEY_ENV_VAR} must decode to ${KEY_BYTES} bytes (got ${candidate.length}). `
      + 'Expected base64 or hex from: openssl rand -base64 32'
    );
  }
  return candidate;
}

/** True when a usable key is configured. Lets a route answer 503 without throwing. */
export function isCredentialKeyConfigured() {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a password for storage.
 *
 * @param {string} plain the password as typed
 * @returns {string} base64 of `iv || authTag || ciphertext`
 * @throws {CredentialKeyError} when the key is missing or unusable
 * @throws {TypeError} when `plain` is not a non-empty string
 */
export function encryptPassword(plain) {
  if (typeof plain !== 'string' || plain === '') {
    // Refused rather than coerced: `String(undefined)` would cheerfully store
    // the password "undefined" and nobody would notice until someone tried it.
    throw new TypeError('encryptPassword requires a non-empty string');
  }

  const key = readKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypt a stored password.
 *
 * @param {string} stored the value produced by `encryptPassword`
 * @returns {string} the original password
 * @throws {CredentialKeyError} when the key is missing or unusable
 * @throws {Error} when the value is malformed, truncated, or fails authentication
 */
export function decryptPassword(stored) {
  if (typeof stored !== 'string' || stored === '') {
    throw new TypeError('decryptPassword requires a non-empty string');
  }

  const key = readKey();
  const buffer = Buffer.from(stored, 'base64');

  // An empty ciphertext is legitimate only for an empty password, which
  // `encryptPassword` refuses — so the minimum is one byte beyond the header.
  if (buffer.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Stored credential is malformed or truncated');
  }

  const iv = buffer.subarray(0, IV_BYTES);
  const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buffer.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  // `final()` is what verifies the tag, so a tampered value throws here rather
  // than returning wrong plaintext.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Constant-time password comparison, for the login path.
 *
 * `a === b` on strings short-circuits at the first differing character, which
 * leaks the length of the matching prefix to anyone who can time the response.
 * Irrelevant for 16 employees on a LAN, and free to do properly.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function passwordsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // `timingSafeEqual` throws on a length mismatch, so the lengths are compared
  // first. Length is not the secret here; the contents are.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** The password every imported account starts with (design decision D1). */
export const DEFAULT_PASSWORD = 'thelab12345';
