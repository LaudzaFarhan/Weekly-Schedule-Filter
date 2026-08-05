// @vitest-environment jsdom
// This file mounts the real provider, so it opts in to a DOM. The suite default
// is `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Where the branch list is read from and written to.
 *
 * Branches used to travel over `/api/config`, which is backed by Google Sheets
 * and needs `GOOGLE_SPREADSHEET_ID` plus a service account. Without those the
 * route answers `{ configured: false }`, stores nothing, and returns no
 * `branches` key — so the list only ever existed in one browser's
 * `localStorage`, adding a branch looked like it worked, and the branch was gone
 * on the next machine. `/api/new/config` is backed by PostgreSQL, already
 * allowlists `branches` and validates their shape, so it is the store now.
 *
 * What this file pins down:
 *   - a populated store wins over the local seed, and is mirrored into the cache
 *   - an empty store keeps the local seed and seeds the store from it, once
 *   - a refused seed write is quiet: the local list stands, nothing is retried
 *   - every load failure — rejected fetch, non-ok status, malformed body — leaves
 *     the local list in force, because branches must never disappear because a
 *     request failed
 *   - a write goes to `PUT /api/new/config` as `{ key: 'branches', value }`
 *   - a refused write rejects with the server's own message and rolls the
 *     optimistic update back, in state and in the cache
 *
 * The provider is real. Firebase, the profile/activity services, the toast host
 * and the sync-report modal are stubbed, because none of them have anything to
 * do with branch durability and the Firebase ones cannot initialise in a test.
 * `fetch` is a router over the two endpoints the provider touches on mount.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
// Unmounting between tests is handled globally by vitest.setup.js.
import { act, render, waitFor } from '@testing-library/react';
import { ScheduleProvider, useSchedule } from '@/contexts/ScheduleContext';

/* ------------------------------------------------------------------- mocks */

vi.mock('@/services/firebase', () => ({
  auth: { currentUser: null },
  db: {},
  secondaryAuth: {},
  firebaseConfigured: false,
  default: {},
}));

vi.mock('firebase/auth', () => ({
  // Signed out, and nothing to unsubscribe from.
  onAuthStateChanged: (_auth, cb) => { cb(null); return () => {}; },
}));

vi.mock('@/services/profileService', () => ({
  getAllProfiles: vi.fn(async () => []),
}));

vi.mock('@/services/activityService', () => ({
  logActivity: vi.fn(async () => {}),
}));

vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }) => children,
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/components/ui/SyncReportModal', () => ({ default: () => null }));

/* ---------------------------------------------------------------- fixtures */

const LOCAL = [{ id: 'bintaro', name: 'Bintaro', url: 'https://sheet/bintaro' }];
const STORED = [
  { id: 'kemang', name: 'Kemang', url: 'https://sheet/kemang' },
  { id: 'bsd', name: 'BSD' },
];

/** The live context value, so a test can call `updateBranches` directly. */
let ctx = null;

function Probe() {
  const value = useSchedule();
  // Published from an effect rather than during render, so the probe itself
  // stays a pure component.
  useEffect(() => { ctx = value; }, [value]);
  return <div data-testid="branches">{JSON.stringify(value.branches)}</div>;
}

/** Mount the provider and wait for its mount-time effects to settle. */
async function mount() {
  const view = render(<ScheduleProvider><Probe /></ScheduleProvider>);
  // One flush for the `/api/config` and `/api/new/config` reads, one more for
  // the follow-up seed write the empty-store path makes.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return view;
}

const rendered = (view) => JSON.parse(view.getByTestId('branches').textContent);
const cached = () => JSON.parse(localStorage.getItem('branches'));

/** A `Response`-alike, enough for the two shapes the provider reads. */
const reply = (body, { ok = true, status = 200 } = {}) => ({
  ok, status, json: async () => body,
});

/**
 * Route `fetch` over the endpoints the provider touches.
 *
 * `branchesGet` / `branchesPut` are per-test handlers; `/api/config` always
 * answers the way the unconfigured Sheets route does in this project, so the
 * other config keys behave exactly as they do in production.
 */
let branchesGet;
let branchesPut;

const calls = () => fetch.mock.calls.map(([url, init]) => ({
  url: String(url),
  method: init?.method || 'GET',
  body: init?.body ? JSON.parse(init.body) : null,
}));

const putCalls = () => calls().filter((c) => c.method === 'PUT');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('branches', JSON.stringify(LOCAL));

  branchesGet = async () => reply({ key: 'branches', value: [], isDefault: true, updatedAt: null, updatedBy: null });
  branchesPut = async () => reply({ key: 'branches', value: STORED, updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'admin@example.com' });

  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const href = String(url);
    if (href.startsWith('/api/new/config')) {
      return (init?.method === 'PUT' ? branchesPut : branchesGet)(init);
    }
    if (href.startsWith('/api/config')) return reply({ configured: false });
    throw new Error(`unexpected request: ${init?.method || 'GET'} ${href}`);
  }));

  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  ctx = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Console notes the branch loader emitted. */
const branchNotes = () => console.log.mock.calls
  .map(([first]) => String(first))
  .filter((line) => line.startsWith('Branches:'));

/* ------------------------------------------------------------------- tests */

describe('loading branches from the PostgreSQL-backed store', () => {
  it('adopts a populated store and mirrors it into the localStorage cache', async () => {
    branchesGet = async () => reply({
      key: 'branches', value: STORED, isDefault: false,
      updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'admin@example.com',
    });

    const view = await mount();

    expect(rendered(view)).toEqual(STORED);
    expect(cached()).toEqual(STORED);
    // A store that already has branches is not written back to.
    expect(putCalls()).toHaveLength(0);
    // Read with the single-key query, not the whole config document.
    expect(calls().some((c) => c.url === '/api/new/config?key=branches')).toBe(true);
  });

  it('reads branches from the new store and never from the Sheets route', async () => {
    branchesGet = async () => reply({ key: 'branches', value: STORED, isDefault: false });
    // If the Sheet ever becomes configured, its branch list must be ignored.
    fetch.mockImplementation(async (url, init) => {
      const href = String(url);
      if (href.startsWith('/api/new/config')) {
        return (init?.method === 'PUT' ? branchesPut : branchesGet)(init);
      }
      return reply({ configured: true, branches: [{ id: 'sheet', name: 'From The Sheet' }] });
    });

    const view = await mount();

    expect(rendered(view)).toEqual(STORED);
    expect(rendered(view).some((b) => b.id === 'sheet')).toBe(false);
  });

  it.each([
    ['isDefault with an empty array', { key: 'branches', value: [], isDefault: true }],
    ['an absent value', { key: 'branches', isDefault: true }],
    ['an explicitly null value', { key: 'branches', value: null, isDefault: true }],
  ])('keeps the local list and seeds the store when it is empty (%s)', async (_label, body) => {
    branchesGet = async () => reply(body);

    const view = await mount();

    expect(rendered(view)).toEqual(LOCAL);
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(putCalls()[0]).toMatchObject({
      url: '/api/new/config',
      body: { key: 'branches', value: LOCAL },
    });
  });

  it('keeps the local list quietly when the seed write is refused, and does not retry', async () => {
    branchesPut = async () => reply(
      { error: 'Forbidden', message: 'Changing configuration needs the Admin role, or the New Operations API key.' },
      { ok: false, status: 403 }
    );

    const view = await mount();

    expect(rendered(view)).toEqual(LOCAL);
    expect(cached()).toEqual(LOCAL);
    expect(branchNotes()).toHaveLength(1);
    // No loop: a second flush must not produce a second attempt.
    await act(async () => { await Promise.resolve(); });
    expect(putCalls()).toHaveLength(1);
  });

  it.each([
    ['the request is rejected', () => { throw new Error('offline'); }],
    ['the status is 401', async () => reply({ error: 'Unauthorized' }, { ok: false, status: 401 })],
    ['the status is 500', async () => reply({ error: 'boom' }, { ok: false, status: 500 })],
    ['the body is not JSON', async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })],
    ['the body is a bare string', async () => reply('nope')],
    ['the value is not an array', async () => reply({ key: 'branches', value: { id: 'x' } })],
  ])('leaves branches intact when %s', async (_label, handler) => {
    branchesGet = handler;

    const view = await mount();

    expect(rendered(view)).toEqual(LOCAL);
    expect(cached()).toEqual(LOCAL);
    // A failed read is never treated as "the store is empty", so nothing is
    // written on the back of it.
    expect(putCalls()).toHaveLength(0);
    expect(branchNotes().length).toBeLessThanOrEqual(1);
  });

  it('falls back to the shipped default when there is no local seed either', async () => {
    localStorage.removeItem('branches');
    branchesGet = async () => { throw new Error('offline'); };

    const view = await mount();

    expect(rendered(view)).toHaveLength(1);
    expect(rendered(view)[0]).toMatchObject({ id: 'default' });
  });
});

describe('writing branches through updateBranches', () => {
  const next = [...LOCAL, { id: 'kemang', name: 'Kemang', url: '', trialUrl: '' }];

  it('PUTs the list to the new store and resolves', async () => {
    branchesGet = async () => reply({ key: 'branches', value: LOCAL, isDefault: false });
    const view = await mount();
    fetch.mockClear();

    branchesPut = async () => reply({ key: 'branches', value: next, updatedBy: 'admin@example.com' });

    let result;
    await act(async () => { result = await ctx.updateBranches(next); });

    expect(putCalls()).toEqual([{
      url: '/api/new/config',
      method: 'PUT',
      body: { key: 'branches', value: next },
    }]);
    expect(result).toMatchObject({ key: 'branches', value: next });
    expect(rendered(view)).toEqual(next);
    expect(cached()).toEqual(next);
  });

  it.each([
    [
      'a 403 from the Admin gate',
      { error: 'Forbidden', message: 'Changing configuration needs the Admin role, or the New Operations API key.' },
      403,
      'Changing configuration needs the Admin role, or the New Operations API key.',
    ],
    [
      'a 400 from the shape check',
      { error: 'Invalid value', message: 'Each branch needs a non-empty name.' },
      400,
      'Each branch needs a non-empty name.',
    ],
    [
      'a body carrying only `error`',
      { error: 'Branch ids must be unique.' },
      400,
      'Branch ids must be unique.',
    ],
  ])('rejects with the server message and rolls back on %s', async (_label, body, status, message) => {
    branchesGet = async () => reply({ key: 'branches', value: LOCAL, isDefault: false });
    const view = await mount();

    branchesPut = async () => reply(body, { ok: false, status });

    let error;
    await act(async () => {
      error = await ctx.updateBranches(next).then(() => null, (e) => e);
    });

    // The real reason reaches the caller — `handleAddBranchSubmit` shows
    // `err.message` — rather than resolving as if the save had happened.
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(message);

    // Rolled back: the UI must not show a branch that was never stored.
    expect(rendered(view)).toEqual(LOCAL);
    expect(cached()).toEqual(LOCAL);
  });

  it('rejects and rolls back when the request never lands', async () => {
    branchesGet = async () => reply({ key: 'branches', value: LOCAL, isDefault: false });
    const view = await mount();

    branchesPut = async () => { throw new Error('Failed to fetch'); };

    let error;
    await act(async () => {
      error = await ctx.updateBranches(next).then(() => null, (e) => e);
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Failed to fetch');
    expect(rendered(view)).toEqual(LOCAL);
    expect(cached()).toEqual(LOCAL);
  });

  it('rejects with a status-bearing message when the error body is unreadable', async () => {
    branchesGet = async () => reply({ key: 'branches', value: LOCAL, isDefault: false });
    const view = await mount();

    branchesPut = async () => ({
      ok: false, status: 502, json: async () => { throw new Error('not json'); },
    });

    let error;
    await act(async () => {
      error = await ctx.updateBranches(next).then(() => null, (e) => e);
    });

    expect(error.message).toMatch(/502/);
    expect(rendered(view)).toEqual(LOCAL);
  });

  it('rolls back to the list that was on screen, not to the shipped default', async () => {
    branchesGet = async () => reply({ key: 'branches', value: STORED, isDefault: false });
    const view = await mount();
    expect(rendered(view)).toEqual(STORED);

    branchesPut = async () => reply({ error: 'Forbidden', message: 'Needs Admin.' }, { ok: false, status: 403 });

    await act(async () => { await ctx.updateBranches([]).catch(() => {}); });

    expect(rendered(view)).toEqual(STORED);
    expect(cached()).toEqual(STORED);
  });
});
