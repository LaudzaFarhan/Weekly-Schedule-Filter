/**
 * Properties of turning instructors into logins.
 *
 * The stakes: a username is what somebody types every morning, and a collision
 * silently gives two people one account. Both failures are invisible in a happy
 * path test and obvious under generated names.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  INSTRUCTOR_DEFAULT_PASSWORD,
  STAFF_DEFAULT_PASSWORD,
  defaultPasswordFor,
  planInstructorAccounts,
  uniqueUsername,
  usernameFromName,
} from '../employeeAccounts';

const RUNS = { numRuns: 100 };

/** Names shaped like the real registry: latin letters, spaces, the odd accent. */
const nameArb = () => fc
  .array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZáéíóúñ '),
    { minLength: 1, maxLength: 24 }
  )
  .map((chars) => chars.join(''));

describe('usernameFromName', () => {
  it('produces the documented shape for real names', () => {
    expect(usernameFromName('Felix Wijaya')).toBe('felix.wijaya');
    expect(usernameFromName('Laudza')).toBe('laudza');
    expect(usernameFromName('Mary Jane Watson')).toBe('mary.jane.watson');
  });

  it('folds accents to base letters instead of dropping them', () => {
    // Dropping them would turn "Ríos" into "ros", which is somebody else's name.
    expect(usernameFromName('Ríos')).toBe('rios');
    expect(usernameFromName('José Núñez')).toBe('jose.nunez');
  });

  it('collapses punctuation and repeated spaces into single dots', () => {
    expect(usernameFromName("O'Brien")).toBe('o.brien');
    expect(usernameFromName('Anna   Maria')).toBe('anna.maria');
    expect(usernameFromName('Dr. Felix')).toBe('dr.felix');
  });

  it('trims separators from the ends', () => {
    // A username starting or ending with a dot looks like a typo and invites one.
    expect(usernameFromName('  Felix  ')).toBe('felix');
    expect(usernameFromName('...Felix...')).toBe('felix');
  });

  it('Property 1: output is always a safe username or empty', () => {
    fc.assert(
      fc.property(nameArb(), (name) => {
        const username = usernameFromName(name);
        if (username === '') return;
        // Lowercase alphanumerics and interior dots only — nothing that needs
        // escaping in a URL, a cookie, or a SQL identifier.
        expect(username).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)*$/);
        expect(username.length).toBeLessThanOrEqual(100);
      }),
      RUNS
    );
  });

  it('Property 2: deriving is stable and case-insensitive', () => {
    fc.assert(
      fc.property(nameArb(), (name) => {
        expect(usernameFromName(name)).toBe(usernameFromName(name.toUpperCase()));
        expect(usernameFromName(name)).toBe(usernameFromName(name.toLowerCase()));
      }),
      RUNS
    );
  });

  it('Property 3: surrounding whitespace never changes the result', () => {
    fc.assert(
      fc.property(nameArb(), fc.constantFrom(' ', '   ', '\t', '\n'), (name, pad) => {
        expect(usernameFromName(`${pad}${name}${pad}`)).toBe(usernameFromName(name));
      }),
      RUNS
    );
  });

  it('returns empty for a name with nothing usable in it', () => {
    // The caller has to notice and report it. Inventing a username here would
    // create an account nobody could be told about.
    expect(usernameFromName('')).toBe('');
    expect(usernameFromName('   ')).toBe('');
    expect(usernameFromName('---')).toBe('');
    expect(usernameFromName(null)).toBe('');
    expect(usernameFromName(undefined)).toBe('');
    expect(usernameFromName(42)).toBe('');
  });
});

describe('uniqueUsername', () => {
  it('keeps the clean name when it is free', () => {
    expect(uniqueUsername('felix', new Set())).toBe('felix');
  });

  it('numbers from 2, so the first holder keeps the name they learned', () => {
    expect(uniqueUsername('felix', new Set(['felix']))).toBe('felix2');
    expect(uniqueUsername('felix', new Set(['felix', 'felix2']))).toBe('felix3');
  });

  it('Property 4: the result is never already taken', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('felix', 'anna', 'jose'),
        fc.array(fc.integer({ min: 2, max: 40 }), { maxLength: 30 }),
        (base, suffixes) => {
          const taken = new Set([base, ...suffixes.map((n) => `${base}${n}`)]);
          const result = uniqueUsername(base, taken);
          expect(result).not.toBe('');
          expect(taken.has(result)).toBe(false);
          expect(result.startsWith(base)).toBe(true);
        }
      ),
      RUNS
    );
  });

  it('accepts an array as well as a Set', () => {
    expect(uniqueUsername('felix', ['felix'])).toBe('felix2');
  });

  it('gives up rather than looping when a name is exhausted', () => {
    const taken = new Set(['felix']);
    for (let i = 2; i <= 99; i += 1) taken.add(`felix${i}`);
    expect(uniqueUsername('felix', taken)).toBe('');
  });

  it('returns empty for an empty base', () => {
    expect(uniqueUsername('', new Set())).toBe('');
  });
});

describe('defaultPasswordFor', () => {
  it('gives instructors their own shared starter password', () => {
    expect(defaultPasswordFor('Instructor')).toBe(INSTRUCTOR_DEFAULT_PASSWORD);
    expect(INSTRUCTOR_DEFAULT_PASSWORD).toBe('instructor12345');
  });

  it('gives every other role the staff password', () => {
    for (const role of ['Admin', 'SPA', 'EC', 'Supervisor']) {
      expect(defaultPasswordFor(role)).toBe(STAFF_DEFAULT_PASSWORD);
    }
  });

  it('falls back to the staff password for an unknown or missing role', () => {
    // Never falls back to the instructor password: that one is known to fifteen
    // people, so an unrecognised role must not silently receive it.
    expect(defaultPasswordFor(undefined)).toBe(STAFF_DEFAULT_PASSWORD);
    expect(defaultPasswordFor('instructor')).toBe(STAFF_DEFAULT_PASSWORD);
  });
});

describe('planInstructorAccounts', () => {
  const instructor = (id, name) => ({ id, name, status: 'Active' });

  it('plans an account for every instructor when none exist', () => {
    const plan = planInstructorAccounts(
      [instructor(1, 'Felix Wijaya'), instructor(2, 'Laudza')],
      []
    );
    expect(plan.create).toEqual([
      { instructorId: 1, name: 'Felix Wijaya', username: 'felix.wijaya' },
      { instructorId: 2, name: 'Laudza', username: 'laudza' },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('Property 5: running twice creates nothing the second time', () => {
    // The whole reason the link is by instructor id. Without this, pressing the
    // button again would duplicate every account.
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 12 }),
        (ids) => {
          const instructors = ids.map((id) => instructor(id, `Person ${id}`));
          const first = planInstructorAccounts(instructors, []);

          const accounts = first.create.map((entry) => ({
            instructorId: entry.instructorId,
            username: entry.username,
          }));
          const second = planInstructorAccounts(instructors, accounts);

          expect(second.create).toEqual([]);
          expect(second.skipped).toEqual([]);
        }
      ),
      RUNS
    );
  });

  it('Property 6: every planned username is distinct, and free of existing ones', () => {
    fc.assert(
      fc.property(
        fc.array(nameArb(), { minLength: 1, maxLength: 15 }),
        fc.array(nameArb(), { maxLength: 8 }),
        (names, existingNames) => {
          const instructors = names.map((name, i) => instructor(i + 1, name));
          // Existing accounts belonging to nobody in the registry — staff, or
          // instructors who have since left.
          const accounts = existingNames
            .map((name) => usernameFromName(name))
            .filter(Boolean)
            .map((username) => ({ instructorId: null, username }));
          const existing = new Set(accounts.map((a) => a.username));

          const plan = planInstructorAccounts(instructors, accounts);
          const planned = plan.create.map((entry) => entry.username);

          expect(new Set(planned).size).toBe(planned.length);
          for (const username of planned) expect(existing.has(username)).toBe(false);
        }
      ),
      RUNS
    );
  });

  it('Property 7: every instructor is either planned or explained', () => {
    // Silently producing fewer accounts than instructors is the failure that
    // would go unnoticed, so nobody is allowed to just disappear.
    fc.assert(
      fc.property(
        fc.array(nameArb(), { minLength: 1, maxLength: 15 }),
        (names) => {
          const instructors = names.map((name, i) => instructor(i + 1, name));
          const plan = planInstructorAccounts(instructors, []);
          const accounted = new Set([
            ...plan.create.map((e) => e.instructorId),
            ...plan.skipped.map((e) => e.instructorId),
          ]);
          expect(accounted.size).toBe(instructors.length);
        }
      ),
      RUNS
    );
  });

  it('numbers two instructors whose names fold to the same username', () => {
    const plan = planInstructorAccounts(
      [instructor(1, 'Felix'), instructor(2, 'felix'), instructor(3, 'FELIX')],
      []
    );
    expect(plan.create.map((e) => e.username)).toEqual(['felix', 'felix2', 'felix3']);
  });

  it('reports an unnamed instructor rather than skipping them quietly', () => {
    const plan = planInstructorAccounts([instructor(1, '   ')], []);
    expect(plan.create).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].instructorId).toBe(1);
    expect(plan.skipped[0].reason).toMatch(/no username/i);
  });

  it('ignores instructors with no usable id', () => {
    // A row without an integer id cannot be linked, so it cannot be made
    // idempotent, so it is not touched at all.
    const plan = planInstructorAccounts(
      [{ id: null, name: 'Ghost' }, { id: '3', name: 'String Id' }, instructor(4, 'Real')],
      []
    );
    expect(plan.create).toEqual([{ instructorId: 4, name: 'Real', username: 'real' }]);
  });

  it('does not give a renamed instructor a second account', () => {
    const accounts = [{ instructorId: 7, username: 'felix.wijya' }]; // typo, since fixed
    const plan = planInstructorAccounts([instructor(7, 'Felix Wijaya')], accounts);
    expect(plan.create).toEqual([]);
  });

  it('handles missing inputs without throwing', () => {
    expect(planInstructorAccounts(null, null)).toEqual({ create: [], skipped: [] });
    expect(planInstructorAccounts(undefined, undefined)).toEqual({ create: [], skipped: [] });
  });
});
