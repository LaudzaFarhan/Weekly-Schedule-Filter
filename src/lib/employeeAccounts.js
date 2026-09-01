/**
 * Turning an instructor into a login.
 *
 * Every instructor gets an account, and nobody wants to invent 15 usernames by
 * hand, so they are derived from the name. That derivation is the whole reason
 * this module exists as pure functions: a username is what somebody types every
 * morning, and getting it wrong for one person means an account they cannot use.
 */

/** Password an instructor account gets when reset from the users screen. */
export const INSTRUCTOR_DEFAULT_PASSWORD = 'instructor12345';

/** Password every other role gets. */
export const STAFF_DEFAULT_PASSWORD = 'thelab12345';

/**
 * The starter password for a role.
 *
 * Split by role because instructors are the bulk of the accounts and are told
 * their password verbally — a single shared value they can all remember is the
 * point, and it is why `must_change_password` is set alongside it.
 */
export function defaultPasswordFor(role) {
  return role === 'Instructor' ? INSTRUCTOR_DEFAULT_PASSWORD : STAFF_DEFAULT_PASSWORD;
}

/**
 * A username from an instructor's name: `Felix Wijaya` → `felix.wijaya`.
 *
 * Lowercase and dot-separated rather than the raw name, because a username is
 * typed at a login prompt: spaces get mangled by autofill, capitals get typed
 * wrong, and accents cannot be produced on every keyboard.
 *
 * Accents are folded to their base letters (`Ríos` → `rios`) rather than
 * stripped, so a name does not lose characters. Anything still not a letter or
 * digit becomes a separator, and runs of separators collapse to one dot.
 *
 * Returns `''` for a name with nothing usable in it. The caller decides what to
 * do about that — silently inventing a username for an unnamed instructor would
 * create an account nobody could be told about.
 */
export function usernameFromName(name) {
  if (typeof name !== 'string') return '';

  const folded = name
    .normalize('NFD')
    // Strip the combining marks NFD just separated out, leaving the base letters.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return folded
    .replace(/[^a-z0-9]+/g, '.')
    // Leading and trailing dots come from punctuation at the ends of a name.
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 100);
}

/**
 * A username not already in `taken`, by appending a number.
 *
 * Two instructors called Felix would otherwise collide on `felix`, and the
 * second insert would fail on the unique constraint. Numbering from 2 means the
 * first Felix keeps the clean name, which matters because he already learned it.
 *
 * @param {string} base output of `usernameFromName`
 * @param {Set<string>|Array<string>} taken usernames already in use
 */
export function uniqueUsername(base, taken) {
  if (!base) return '';
  const used = taken instanceof Set
    ? taken
    : new Set(Array.isArray(taken) ? taken : []);

  if (!used.has(base)) return base;
  // Bounded so a pathological input cannot spin: past 99 duplicates of one name
  // something is wrong with the instructor list, not with this function.
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return '';
}

/**
 * Extract an email address from instructor remarks or contact notes.
 * E.g. "Email: muhajir.thelab@gmail.com" → "muhajir.thelab@gmail.com".
 */
export function extractEmailFromRemarks(remarks) {
  if (typeof remarks !== 'string') return '';
  const match = remarks.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : '';
}

/**
 * Which instructors still need an account.
 *
 * Matched on instructor id, not on name or username. Names get corrected and
 * usernames get edited; an id does not, so this stays idempotent — running
 * provisioning twice creates nothing the second time, and renaming an instructor
 * does not hand them a second account.
 *
 * Instructors with no usable name are reported separately rather than skipped
 * quietly, so whoever pressed the button finds out why they got fewer accounts
 * than instructors.
 *
 * @param {Array<{id: number, name: string, status?: string, contact?: string, remarks?: string, branches?: Array<string>|string, level?: string}>} instructors
 * @param {Array<{instructorId: number|null, username: string, email?: string}>} accounts
 * @returns {{ create: Array<{instructorId: number, name: string, username: string, email: string, contact: string, location: string, branches: Array<string>}>,
 *             skipped: Array<{instructorId: number, name: string, reason: string}> }}
 */
export function planInstructorAccounts(instructors, accounts) {
  const linked = new Set(
    (accounts || [])
      .map((account) => account.instructorId)
      .filter((id) => Number.isInteger(id))
  );
  // Seeded with every existing username, including those belonging to staff, so
  // a new instructor cannot collide with an account this run did not create.
  const taken = new Set((accounts || []).map((account) => account.username).filter(Boolean));
  const takenEmails = new Set((accounts || []).map((account) => (account.email ? account.email.toLowerCase() : '')).filter(Boolean));

  const create = [];
  const skipped = [];

  for (const instructor of instructors || []) {
    if (!instructor || !Number.isInteger(instructor.id)) continue;
    if (linked.has(instructor.id)) continue;

    const base = usernameFromName(instructor.name);
    if (!base) {
      skipped.push({
        instructorId: instructor.id,
        name: instructor.name ?? '',
        reason: 'No username could be made from this name.',
      });
      continue;
    }

    const username = uniqueUsername(base, taken);
    if (!username) {
      skipped.push({
        instructorId: instructor.id,
        name: instructor.name,
        reason: `Too many accounts already named "${base}".`,
      });
      continue;
    }

    // Added as this plan is built, so two instructors in the same batch who fold
    // to the same username get different numbers instead of both taking the base.
    taken.add(username);

    const entry = {
      instructorId: instructor.id,
      name: instructor.name,
      username,
    };

    // Prefer detected real email from remarks if present
    const detectedEmail = extractEmailFromRemarks(instructor.remarks);
    if (detectedEmail && !takenEmails.has(detectedEmail)) {
      entry.email = detectedEmail;
      takenEmails.add(detectedEmail);
    }

    if (instructor.contact) {
      entry.contact = instructor.contact;
    }

    const primaryBranch = Array.isArray(instructor.branches)
      ? (instructor.branches[0] || '')
      : (typeof instructor.branches === 'string' ? instructor.branches : '');
    if (primaryBranch) {
      entry.location = primaryBranch;
      entry.branches = Array.isArray(instructor.branches) ? instructor.branches : [primaryBranch];
    }

    if (instructor.level) {
      entry.level = instructor.level;
    }

    create.push(entry);
  }

  return { create, skipped };
}
