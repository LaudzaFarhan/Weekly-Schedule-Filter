/**
 * Login session primitives for the New Operations API.
 *
 * Sessions are server-side records, not self-contained signed tokens. A signed
 * token cannot be revoked before it expires, and the whole point of the users
 * screen is that an Admin can kill a compromised credential immediately.
 *
 * Only the SHA-256 of the cookie value is stored, so reading `internal_sessions`
 * yields nothing a caller could present as a session. The plaintext token exists
 * in exactly two places: the response that created it, and the client's cookie
 * jar.
 *
 * Everything here is pure or Node-crypto only — no database, no `next/server` —
 * so the parts that decide whether a session is valid can be tested directly.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Cookie carrying the session token. */
export const SESSION_COOKIE = 'lab_session';

/** How long a new session lasts, in milliseconds. Eight hours — one shift. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Slide the expiry forward only once the session is this far through its life.
 *
 * Writing a new `expires_at` on every request would mean a database write per
 * API call for no benefit. Refreshing only in the last quarter keeps an active
 * user logged in without that cost.
 */
export const SESSION_REFRESH_AFTER = 0.75;

/** Token length in bytes. 32 bytes of CSPRNG output — 256 bits. */
const TOKEN_BYTES = 32;

/** Roles the system recognises, matching the CHECK on `internal_users.role`. */
export const ROLES = ['Admin', 'SPA', 'EC', 'Instructor', 'Supervisor'];

/**
 * Roles allowed to manage accounts and read a stored password back.
 *
 * Deliberately just Admin. `SPA` runs the front desk and has no reason to read
 * a colleague's password; if that changes it is a one-line change here rather
 * than a check scattered across routes.
 */
export const ACCOUNT_ADMIN_ROLES = ['Admin'];

/** A fresh session token, URL-safe so it survives a cookie round trip intact. */
export function createSessionToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * The stored form of a token: lowercase hex SHA-256, always 64 characters.
 *
 * Matches `token_hash CHAR(64)`. A plain hash with no salt is correct here and
 * not an oversight: the input is 256 bits of randomness, so there is no
 * dictionary to attack and a salt would only prevent the indexed lookup this
 * depends on.
 */
export function hashSessionToken(token) {
  if (typeof token !== 'string' || token === '') {
    throw new TypeError('hashSessionToken requires a non-empty string');
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time hash comparison, for paths that compare two hashes directly. */
export function hashesMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Expiry for a session created at `now`. */
export function sessionExpiry(now = Date.now(), ttlMs = SESSION_TTL_MS) {
  return new Date(now + ttlMs);
}

/**
 * Is this session still usable?
 *
 * Expiry is compared here rather than left to SQL so the same rule applies
 * whether the row came from a query, a cache or a test fixture. A missing or
 * unparseable `expiresAt` counts as expired — failing closed is the only safe
 * reading of "we do not know when this ends".
 */
export function isSessionActive(session, now = Date.now()) {
  if (!session || !session.expiresAt) return false;
  const expires = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expires)) return false;
  return expires > now;
}

/**
 * Should this session's expiry be pushed forward?
 *
 * True once the session is past `SESSION_REFRESH_AFTER` of its life, so an
 * active user is not logged out mid-shift while an idle one still expires.
 */
export function shouldRefreshSession(session, now = Date.now(), ttlMs = SESSION_TTL_MS) {
  if (!isSessionActive(session, now)) return false;
  const expires = new Date(session.expiresAt).getTime();
  const remaining = expires - now;
  return remaining < ttlMs * (1 - SESSION_REFRESH_AFTER);
}

/**
 * Cookie attributes for the session.
 *
 * `httpOnly` so page scripts — and anything injected into them — cannot read the
 * token. `sameSite: 'lax'` rather than `'strict'` so following a link into the
 * app keeps you logged in, while still refusing to ride along with a
 * cross-site POST. `secure` off on plain HTTP only, or the cookie would be
 * dropped in local development and login would appear to silently fail.
 */
export function sessionCookieOptions({ secure = true, maxAgeMs = SESSION_TTL_MS } = {}) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

/** Does this role hold account-management rights? */
export function canManageAccounts(role) {
  return ACCOUNT_ADMIN_ROLES.includes(role);
}

/** Is this one of the five recognised roles? */
export function isKnownRole(role) {
  return ROLES.includes(role);
}

/**
 * Normalise an email for lookup and comparison.
 *
 * Login accepts either a username or an email, and the two are stored in
 * separate columns; folding case here means `Admin@Lab.com` and `admin@lab.com`
 * are the same account rather than two.
 */
export function foldIdentifier(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}
