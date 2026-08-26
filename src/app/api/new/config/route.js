/**
 * New Operations — application configuration.
 *
 * GET    /api/new/config          every setting, or ?key= for one
 * PUT    /api/new/config          write one setting  (Admin)
 * DELETE /api/new/config?key=     drop a setting back to its default  (Admin)
 *
 * This is the replacement for reading configuration out of the Google Sheet.
 * `/api/config` still serves Old Operations from the Sheet and is untouched; the
 * two run side by side until Old Operations is retired.
 *
 * Reading is open to any authenticated caller, because the UI needs the branch
 * list and the role map to render at all. Writing is Admin, because the role map
 * decides who is an Admin.
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { auditAccountAction, canAdminAccounts, identify, isAuthenticated } from '@/lib/apiIdentity';
import { ROLES } from '@/lib/authSession';
import { isoDayIndex } from '@/lib/opsSunset';
import { DEFAULT_BRANCH_LIST } from '@/utils/constants';

/**
 * Settings this route will accept, with the default served when unset.
 *
 * An allowlist rather than free-form keys: this table is writable by Admins over
 * HTTP, and without a fixed set of keys it becomes a place to stash arbitrary
 * JSON that nothing reads and nobody can audit. A new setting is a one-line
 * addition here.
 */
const SETTINGS = {
  /** Branch list. Shape matches what the header and ScheduleContext already use. */
  branches: { default: DEFAULT_BRANCH_LIST, describe: 'Branches, as [{ id, name, url?, trialUrl? }].' },
  /** email -> role. Replaces the Sheet-backed users map behind `useSchedule().users`. */
  userRoles: { default: {}, describe: 'Map of lowercase email to role.' },
  /** Which pages each role may see. Consumed by the sidebar's visibility check. */
  rolePages: { default: {}, describe: 'Map of role to the list of page ids it may open.' },
  /** Global on/off switches for pages, independent of role. */
  featureToggles: { default: {}, describe: 'Map of page id to boolean.' },
  /** Free-text operational notes shown on the dashboard. */
  announcements: { default: [], describe: 'Notices to show on the dashboard, newest first.' },
  /**
   * Retirement date for Old Operations. `null` means the shipped constant in
   * `@/lib/opsSunset` stands, so unsetting this key is a safe reset rather than a
   * way to switch the notice off.
   */
  oldOpsSunset: { default: null, describe: 'Retirement date for Old Operations, as "YYYY-MM-DD" in WIB.' },
};

const KEYS = Object.keys(SETTINGS);

/** Rows to a `{ key: value }` object, filling in defaults for anything unset. */
function withDefaults(rows) {
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const out = {};
  for (const key of KEYS) {
    out[key] = stored.has(key) ? stored.get(key) : SETTINGS[key].default;
  }
  return out;
}

/**
 * Shape checks, so a malformed write cannot brick the sidebar.
 *
 * `userRoles` is the one that matters: a bad role string there would leave people
 * with a role no check recognises, which fails closed and locks them out of every
 * page at once.
 */
function validate(key, value) {
  if (key === 'branches') {
    if (!Array.isArray(value)) return 'branches must be an array.';
    for (const branch of value) {
      if (!branch || typeof branch !== 'object') return 'Each branch must be an object.';
      if (typeof branch.id !== 'string' || branch.id.trim() === '') return 'Each branch needs a non-empty id.';
      if (typeof branch.name !== 'string' || branch.name.trim() === '') return 'Each branch needs a non-empty name.';
    }
    const ids = value.map((b) => b.id);
    if (new Set(ids).size !== ids.length) return 'Branch ids must be unique.';
    return null;
  }

  if (key === 'userRoles') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'userRoles must be an object.';
    for (const [email, role] of Object.entries(value)) {
      if (!email.includes('@')) return `"${email}" is not an email address.`;
      if (!ROLES.includes(role)) return `"${role}" is not a role. Use one of: ${ROLES.join(', ')}.`;
    }
    return null;
  }

  if (key === 'rolePages') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'rolePages must be an object.';
    for (const [role, pages] of Object.entries(value)) {
      if (!ROLES.includes(role)) return `"${role}" is not a role.`;
      if (!Array.isArray(pages) || pages.some((p) => typeof p !== 'string')) {
        return `rolePages.${role} must be a list of page ids.`;
      }
    }
    return null;
  }

  if (key === 'featureToggles') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'featureToggles must be an object.';
    for (const [page, on] of Object.entries(value)) {
      if (typeof on !== 'boolean') return `featureToggles.${page} must be true or false.`;
    }
    return null;
  }

  if (key === 'announcements') {
    if (!Array.isArray(value)) return 'announcements must be an array.';
    return null;
  }

  if (key === 'oldOpsSunset') {
    // `null` is the reset: the shipped constant takes over.
    if (value === null) return null;
    // The same reader the notice itself uses, so a date the route accepts is a
    // date the countdown can count to. It refuses non-strings, sloppy formats
    // like "2026-9-1", padded strings, and dates that do not exist
    // (`2026-02-30`, `2027-02-29`), while allowing real leap days.
    if (isoDayIndex(value) === null) {
      return 'oldOpsSunset must be null, or a real calendar date as "YYYY-MM-DD" in WIB, for example "2026-09-01".';
    }
    // No range check: moving the deadline into the past is a valid action.
    return null;
  }

  return null;
}

export async function GET(req) {
  try {
    const identity = await identify(req);
    if (!isAuthenticated(identity)) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Sign in, or send the New Operations API key.' },
        { status: 401 }
      );
    }

    await ensureTable('internal_config');

    const requested = new URL(req.url).searchParams.get('key');
    if (requested) {
      if (!KEYS.includes(requested)) {
        return NextResponse.json(
          { error: 'Unknown setting', message: `key must be one of: ${KEYS.join(', ')}.` },
          { status: 400 }
        );
      }
      const res = await query('SELECT key, value, updated_at, updated_by FROM internal_config WHERE key = $1', [requested]);
      const row = res.rows[0];
      return NextResponse.json({
        key: requested,
        value: row ? row.value : SETTINGS[requested].default,
        isDefault: !row,
        updatedAt: row?.updated_at ?? null,
        updatedBy: row?.updated_by ?? null,
      });
    }

    const res = await query('SELECT key, value FROM internal_config');
    return NextResponse.json({
      config: withDefaults(res.rows),
      settings: Object.fromEntries(KEYS.map((k) => [k, SETTINGS[k].describe])),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Changing configuration needs the Admin role, or the New Operations API key.' },
        { status: 403 }
      );
    }

    await ensureTable('internal_config');

    const body = await req.json().catch(() => null);
    const key = typeof body?.key === 'string' ? body.key.trim() : '';
    if (!KEYS.includes(key)) {
      return NextResponse.json(
        { error: 'Unknown setting', message: `key must be one of: ${KEYS.join(', ')}.` },
        { status: 400 }
      );
    }
    if (body?.value === undefined) {
      return NextResponse.json({ error: 'Missing value' }, { status: 400 });
    }

    const problem = validate(key, body.value);
    if (problem) {
      return NextResponse.json({ error: 'Invalid value', message: problem }, { status: 400 });
    }

    // Refusing to strip the last Admin from the role map, for the same reason the
    // users route refuses to delete the last Admin account.
    if (key === 'userRoles' && !Object.values(body.value).includes('Admin')) {
      return NextResponse.json(
        {
          error: 'That would leave no Admin',
          message: 'At least one email in userRoles has to be an Admin.',
        },
        { status: 409 }
      );
    }

    const res = await query(
      `INSERT INTO internal_config (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING key, value, updated_at, updated_by`,
      [key, JSON.stringify(body.value), identity.email || identity.username]
    );

    await auditAccountAction(identity, 'config', `Changed configuration: ${key}`);

    const row = res.rows[0];
    return NextResponse.json({
      key: row.key, value: row.value, updatedAt: row.updated_at, updatedBy: row.updated_by,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  return PUT(req);
}

export async function DELETE(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Changing configuration needs the Admin role, or the New Operations API key.' },
        { status: 403 }
      );
    }

    await ensureTable('internal_config');

    const key = new URL(req.url).searchParams.get('key');
    if (!KEYS.includes(key)) {
      return NextResponse.json(
        { error: 'Unknown setting', message: `key must be one of: ${KEYS.join(', ')}.` },
        { status: 400 }
      );
    }

    await query('DELETE FROM internal_config WHERE key = $1', [key]);
    await auditAccountAction(identity, 'config', `Reset configuration to default: ${key}`);

    // Deleting a setting is a reset, not a removal — the default takes over, so
    // the value it will now serve is returned rather than a bare success.
    return NextResponse.json({ success: true, key, value: SETTINGS[key].default });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
