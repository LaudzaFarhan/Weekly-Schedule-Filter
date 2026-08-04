/**
 * Properties of the session primitives.
 *
 * These decide whether somebody is signed in, so the interesting cases are the
 * degenerate ones: a session with no expiry, a clock exactly on the boundary, a
 * token that is not a string. Each of those has a safe answer and an unsafe one,
 * and the tests below pin the safe one.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ROLES,
  SESSION_REFRESH_AFTER,
  SESSION_TTL_MS,
  canManageAccounts,
  createSessionToken,
  foldIdentifier,
  hashSessionToken,
  hashesMatch,
  isKnownRole,
  isSessionActive,
  sessionCookieOptions,
  sessionExpiry,
  shouldRefreshSession,
} from '../authSession';

const RUNS = { numRuns: 100 };

/** A 64-character lowercase hex string, the shape `hashSessionToken` produces. */
const hex64 = () => fc
  .array(fc.constantFrom(...'0123456789abcdef'), { minLength: 64, maxLength: 64 })
  .map((chars) => chars.join(''));

describe('session tokens', () => {
  it('Property 1: every token is distinct', () => {
    // A repeated token would let one person's cookie authenticate as another.
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) seen.add(createSessionToken());
    expect(seen.size).toBe(500);
  });

  it('Property 2: tokens survive a cookie round trip unchanged', () => {
    // base64url, so no padding, no "+" and no "/" — the characters that would be
    // mangled in a Set-Cookie header or a URL.
    for (let i = 0; i < 100; i += 1) {
      const token = createSessionToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it('Property 3: hashing is deterministic, 64 hex characters, and not the token', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (token) => {
        const a = hashSessionToken(token);
        const b = hashSessionToken(token);
        expect(a).toBe(b);
        // CHAR(64) in the schema; a shorter or longer value would be padded or
        // rejected by PostgreSQL rather than failing here.
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(a).not.toBe(token);
      }),
      RUNS
    );
  });

  it('Property 4: different tokens hash differently', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.string({ minLength: 1, maxLength: 60 }),
        (a, b) => {
          fc.pre(a !== b);
          expect(hashSessionToken(a)).not.toBe(hashSessionToken(b));
        }
      ),
      RUNS
    );
  });

  it('refuses to hash anything that is not a non-empty string', () => {
    // Coercing would hash the string "undefined" and store a session nobody can
    // present but that looks perfectly valid in the table.
    expect(() => hashSessionToken('')).toThrow(TypeError);
    expect(() => hashSessionToken(null)).toThrow(TypeError);
    expect(() => hashSessionToken(undefined)).toThrow(TypeError);
    expect(() => hashSessionToken(12345)).toThrow(TypeError);
  });
});

describe('hashesMatch', () => {
  it('Property 5: agrees with equality for same-length strings', () => {
    // Two independently generated 64-character hashes are never equal, so the
    // "matching" branch would go untested. `same` forces it to be exercised.
    fc.assert(
      fc.property(hex64(), hex64(), fc.boolean(), (a, b, same) => {
        const other = same ? a : b;
        expect(hashesMatch(a, other)).toBe(a === other);
      }),
      RUNS
    );
  });

  it('is false for different lengths rather than throwing', () => {
    // timingSafeEqual throws on a length mismatch, which would turn a malformed
    // cookie into a 500 instead of a 401.
    expect(hashesMatch('abc', 'abcd')).toBe(false);
    expect(hashesMatch('', 'a')).toBe(false);
  });

  it('is false for non-strings', () => {
    expect(hashesMatch(null, null)).toBe(false);
    expect(hashesMatch(undefined, 'a')).toBe(false);
    expect(hashesMatch(5, 5)).toBe(false);
  });
});

describe('isSessionActive', () => {
  it('Property 6: a session is active exactly while its expiry is in the future', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_600_000_000_000, max: 2_000_000_000_000 }),
        fc.integer({ min: -SESSION_TTL_MS, max: SESSION_TTL_MS }),
        (now, offset) => {
          const session = { expiresAt: new Date(now + offset) };
          expect(isSessionActive(session, now)).toBe(offset > 0);
        }
      ),
      RUNS
    );
  });

  it('Property 7: anything unreadable counts as expired', () => {
    // Failing closed is the only safe reading of "we do not know when this ends".
    fc.assert(
      fc.property(
        fc.constantFrom(null, undefined, {}, { expiresAt: null }, { expiresAt: '' },
          { expiresAt: 'not a date' }, { expiresAt: NaN }, { expiresAt: 'yesterday' }),
        (session) => {
          expect(isSessionActive(session, Date.now())).toBe(false);
        }
      ),
      RUNS
    );
  });

  it('a session expiring on this exact millisecond is expired', () => {
    // The boundary has to fall one way; expired is the safe direction.
    const now = 1_700_000_000_000;
    expect(isSessionActive({ expiresAt: new Date(now) }, now)).toBe(false);
    expect(isSessionActive({ expiresAt: new Date(now + 1) }, now)).toBe(true);
  });

  it('accepts an ISO string as well as a Date, since that is what pg may hand back', () => {
    const now = 1_700_000_000_000;
    expect(isSessionActive({ expiresAt: new Date(now + 60_000).toISOString() }, now)).toBe(true);
  });
});

describe('sessionExpiry and refresh', () => {
  it('Property 8: a fresh session is active and does not need refreshing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_600_000_000_000, max: 2_000_000_000_000 }), (now) => {
        const session = { expiresAt: sessionExpiry(now) };
        expect(isSessionActive(session, now)).toBe(true);
        // Refreshing on the request that just created it would be a wasted write
        // on every single login.
        expect(shouldRefreshSession(session, now)).toBe(false);
      }),
      RUNS
    );
  });

  it('Property 9: refresh happens only in the last quarter of the life, and never once expired', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_600_000_000_000, max: 2_000_000_000_000 }),
        fc.double({ min: 0, max: 1.5, noNaN: true }),
        (start, elapsedFraction) => {
          const session = { expiresAt: sessionExpiry(start) };
          const now = start + SESSION_TTL_MS * elapsedFraction;

          const expired = elapsedFraction >= 1;
          if (expired) {
            // An expired session is not refreshed — it is replaced by a new login.
            expect(shouldRefreshSession(session, now)).toBe(false);
            return;
          }
          expect(shouldRefreshSession(session, now)).toBe(elapsedFraction > SESSION_REFRESH_AFTER);
        }
      ),
      RUNS
    );
  });
});

describe('cookie options', () => {
  it('is httpOnly and lax on every configuration', () => {
    // httpOnly is what stops page scripts, and anything injected into them, from
    // reading the token. lax still refuses to ride along with a cross-site POST.
    for (const secure of [true, false]) {
      const options = sessionCookieOptions({ secure });
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
      expect(options.path).toBe('/');
      expect(options.secure).toBe(secure);
    }
  });

  it('expresses maxAge in whole seconds, as the header requires', () => {
    const options = sessionCookieOptions({ maxAgeMs: 8 * 60 * 60 * 1000 });
    expect(options.maxAge).toBe(28800);
    expect(Number.isInteger(options.maxAge)).toBe(true);
  });
});

describe('roles', () => {
  it('recognises exactly the five roles the database CHECK allows', () => {
    // Drift here would let the API accept a role PostgreSQL then rejects, turning
    // a validation error into a 500.
    expect(ROLES).toEqual(['Admin', 'SPA', 'EC', 'Instructor', 'Supervisor']);
  });

  it('Property 10: only Admin may manage accounts', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROLES), (role) => {
        expect(canManageAccounts(role)).toBe(role === 'Admin');
      }),
      RUNS
    );
  });

  it('Property 11: an unrecognised role is never known and never an admin', () => {
    fc.assert(
      fc.property(fc.string(), (role) => {
        fc.pre(!ROLES.includes(role));
        expect(isKnownRole(role)).toBe(false);
        expect(canManageAccounts(role)).toBe(false);
      }),
      RUNS
    );
  });

  it('is case sensitive, matching the database CHECK', () => {
    expect(isKnownRole('admin')).toBe(false);
    expect(canManageAccounts('admin')).toBe(false);
  });
});

describe('foldIdentifier', () => {
  it('Property 12: folding is idempotent and case-insensitive', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const once = foldIdentifier(value);
        expect(foldIdentifier(once)).toBe(once);
        expect(foldIdentifier(value.toUpperCase())).toBe(once.toUpperCase().toLowerCase());
      }),
      RUNS
    );
  });

  it('Property 13: surrounding whitespace never changes the result', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
        fc.constantFrom(' ', '  ', '\t', '\n', ' \t '),
        (value, pad) => {
          expect(foldIdentifier(`${pad}${value}${pad}`)).toBe(foldIdentifier(value));
        }
      ),
      RUNS
    );
  });

  it('returns an empty string for non-strings rather than throwing', () => {
    // The identifier comes straight off a JSON body, so it can be anything.
    expect(foldIdentifier(null)).toBe('');
    expect(foldIdentifier(undefined)).toBe('');
    expect(foldIdentifier(42)).toBe('');
    expect(foldIdentifier({})).toBe('');
  });
});
