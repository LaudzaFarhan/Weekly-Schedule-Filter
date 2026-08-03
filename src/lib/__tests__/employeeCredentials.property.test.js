/**
 * Properties of the employee credential store (`src/lib/employeeCredentials.js`).
 *
 *   Property 1 — encryption round-trips for any password
 *   Property 2 — ciphertext is non-deterministic
 *   Property 3 — tampered ciphertext fails closed
 *
 * These three are the whole security argument for storing readable passwords, so
 * they are worth quantifying over rather than checking with a couple of examples.
 * Pure functions, so `{ numRuns: 100 }` per the repo convention.
 *
 * The key is set per test rather than read from the environment: the real
 * `EMPLOYEE_CREDENTIAL_KEY` is a production secret and must not be needed to run
 * the suite.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { randomBytes } from 'node:crypto';

import {
  CredentialKeyError,
  DEFAULT_PASSWORD,
  KEY_ENV_VAR,
  decryptPassword,
  encryptPassword,
  isCredentialKeyConfigured,
  passwordsMatch,
} from '@/lib/employeeCredentials';

/** A password a person might actually choose, plus the awkward cases. */
const passwordArb = fc.oneof(
  { weight: 5, arbitrary: fc.string({ minLength: 1, maxLength: 64 }) },
  { weight: 2, arbitrary: fc.constantFrom(DEFAULT_PASSWORD, 'admin', 'P@ssw0rd!', '12345678') },
  // Unicode, emoji and combining marks: a byte-length assumption anywhere in the
  // module would show up here rather than in production on somebody's name.
  { weight: 2, arbitrary: fc.constantFrom('pässwörd', 'кириллица', '日本語のパスワード', '🔐🔑😀', 'e\u0301tude') },
  { weight: 1, arbitrary: fc.constantFrom(' leading', 'trailing ', '  ', '\t\n', 'a'.repeat(500)) },
  { weight: 1, arbitrary: fc.string({ minLength: 100, maxLength: 400 }) },
).filter((p) => typeof p === 'string' && p.length > 0);

const originalKey = process.env[KEY_ENV_VAR];

beforeEach(() => {
  // A fresh random key per test, base64 as an operator would supply it.
  process.env[KEY_ENV_VAR] = randomBytes(32).toString('base64');
});

afterEach(() => {
  if (originalKey === undefined) delete process.env[KEY_ENV_VAR];
  else process.env[KEY_ENV_VAR] = originalKey;
});

describe('employeeCredentials properties', () => {
  // Feature: employee-accounts-postgres, Property 1: Encryption round-trips
  it('returns the original password for any password it accepted', () => {
    fc.assert(
      fc.property(passwordArb, (password) => {
        const stored = encryptPassword(password);

        // Stored form is base64 text, so it survives a TEXT column untouched.
        expect(typeof stored).toBe('string');
        expect(stored).toMatch(/^[A-Za-z0-9+/]+=*$/);

        // The whole point of D2: what went in comes back out.
        expect(decryptPassword(stored)).toBe(password);

        // And the plaintext is not sitting in the stored value. Checked for
        // passwords long enough that a coincidental base64 substring is not
        // plausible — a short password like "a" can appear by chance.
        if (password.length >= 6 && /^[\x20-\x7e]+$/.test(password)) {
          expect(stored).not.toContain(password);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: employee-accounts-postgres, Property 2: Ciphertext is non-deterministic
  it('produces different ciphertext each time, so shared passwords are not visible as equal columns', () => {
    fc.assert(
      fc.property(passwordArb, (password) => {
        const first = encryptPassword(password);
        const second = encryptPassword(password);

        // Two employees with the same password must not be spottable by anyone
        // who can read the table (fresh IV per call).
        expect(first).not.toBe(second);

        // Both still decrypt to the same thing.
        expect(decryptPassword(first)).toBe(password);
        expect(decryptPassword(second)).toBe(password);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: employee-accounts-postgres, Property 3: Tampered ciphertext fails closed
  it('throws rather than returning wrong plaintext when a stored value is altered', () => {
    fc.assert(
      fc.property(passwordArb, fc.nat(), (password, seed) => {
        const stored = encryptPassword(password);
        const bytes = Buffer.from(stored, 'base64');

        // Flip one bit somewhere in the value — IV, auth tag or ciphertext. All
        // three must be covered, which is why the index spans the whole buffer.
        const index = seed % bytes.length;
        bytes[index] ^= 1 << (seed % 8);
        const tampered = bytes.toString('base64');

        // A tampered value must never decrypt to something plausible. GCM
        // authentication is what makes this a guarantee and not a hope.
        if (tampered !== stored) {
          let result;
          let threw = false;
          try {
            result = decryptPassword(tampered);
          } catch {
            threw = true;
          }
          if (!threw) {
            // Astronomically unlikely, but if it ever authenticated it must at
            // least not be a DIFFERENT password presented as genuine.
            expect(result).toBe(password);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: employee-accounts-postgres, Property 3: Tampered ciphertext fails closed
  it('refuses a value encrypted under a different key', () => {
    fc.assert(
      fc.property(passwordArb, (password) => {
        const stored = encryptPassword(password);

        // Simulates a key rotation, or a database restored into an environment
        // holding the wrong key. Must fail loudly, never return rubbish.
        process.env[KEY_ENV_VAR] = randomBytes(32).toString('base64');
        expect(() => decryptPassword(stored)).toThrow();
      }),
      { numRuns: 100 },
    );
  });
});

describe('key configuration fails closed', () => {
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['too short', Buffer.alloc(16).toString('base64')],
    // 'z' is not a hex digit, so this cannot be mistaken for a hex key. Note that
    // `Buffer.alloc(48).toString('base64')` is 64 'A' characters, which IS valid
    // 64-char hex and so decodes to a legitimate 32-byte key — see the
    // ambiguity test below.
    ['too long', 'z'.repeat(64)],
    ['not base64 or hex', 'clearly-not-a-key!!'],
  ])('refuses to encrypt or decrypt when the key is %s', (_label, value) => {
    if (value === undefined) delete process.env[KEY_ENV_VAR];
    else process.env[KEY_ENV_VAR] = value;

    // D3: a missing or unusable key must never degrade to storing plaintext.
    expect(() => encryptPassword('thelab12345')).toThrow(CredentialKeyError);
    expect(() => decryptPassword('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toThrow(CredentialKeyError);
    expect(isCredentialKeyConfigured()).toBe(false);
  });

  it('reads a hex-and-base64 ambiguous key consistently, so encrypt and decrypt agree', () => {
    // `'A'.repeat(64)` is valid 64-char hex AND valid base64. The module resolves
    // it as hex. What matters is not which reading wins but that the SAME reading
    // wins every time — otherwise a value written on one request would be
    // unreadable on the next.
    process.env[KEY_ENV_VAR] = 'A'.repeat(64);
    const stored = encryptPassword('thelab12345');
    expect(decryptPassword(stored)).toBe('thelab12345');
    expect(isCredentialKeyConfigured()).toBe(true);
  });

  it('accepts a hex key as well as base64, since either is a plausible paste', () => {
    const key = randomBytes(32);

    process.env[KEY_ENV_VAR] = key.toString('hex');
    const fromHex = encryptPassword('thelab12345');
    expect(decryptPassword(fromHex)).toBe('thelab12345');

    // The same key in base64 must decrypt what the hex form encrypted.
    process.env[KEY_ENV_VAR] = key.toString('base64');
    expect(decryptPassword(fromHex)).toBe('thelab12345');
  });
});

describe('input handling', () => {
  it.each([[undefined], [null], [''], [42], [{}], [[]], [true]])(
    'refuses to encrypt %p rather than coercing it',
    (bad) => {
      // `String(undefined)` would store the password "undefined" and nobody
      // would find out until someone tried to log in with it.
      expect(() => encryptPassword(bad)).toThrow(TypeError);
    },
  );

  it.each([['malformed', 'not-valid-base64-@@@'], ['truncated', Buffer.alloc(8).toString('base64')]])(
    'refuses to decrypt a %s value',
    (_label, bad) => {
      expect(() => decryptPassword(bad)).toThrow();
    },
  );
});

describe('passwordsMatch', () => {
  it('is true exactly when the two strings are equal', () => {
    fc.assert(
      fc.property(passwordArb, passwordArb, (a, b) => {
        expect(passwordsMatch(a, a)).toBe(true);
        expect(passwordsMatch(a, b)).toBe(a === b);
      }),
      { numRuns: 100 },
    );
  });

  it('is false for non-strings rather than throwing on the login path', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(passwordsMatch(bad, 'thelab12345')).toBe(false);
      expect(passwordsMatch('thelab12345', bad)).toBe(false);
    }
  });
});
