// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PUT as putUser } from '../route';
import { PUT as putVerify } from '../verify/route';

const { queryMock, ensureTableMock, auditMock, identifyMock, canAdminMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  ensureTableMock: vi.fn(async () => {}),
  auditMock: vi.fn(async () => {}),
  identifyMock: vi.fn(async () => ({ kind: 'session', userId: 1, email: 'admin@kodekiddo.com', role: 'Admin' })),
  canAdminMock: vi.fn(() => true),
}));

vi.mock('@/lib/db', () => ({
  query: queryMock,
  withTransaction: async (cb) => cb({ query: queryMock }),
}));
vi.mock('@/lib/ensureSchema', () => ({ ensureTable: ensureTableMock }));
vi.mock('@/lib/apiIdentity', () => ({
  identify: identifyMock,
  canAdminAccounts: canAdminMock,
  auditAccountAction: auditMock,
}));

describe('User Verification API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies a user account via PUT /api/new/users', async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 2,
        username: 'ahmad.muhajir',
        email: 'muhajir@thelab.id',
        role: 'Instructor',
        status: 'Active',
        is_verified: true,
        verified_at: new Date().toISOString(),
        verified_by: 'admin@kodekiddo.com',
      }],
    });

    const req = new Request('http://localhost/api/new/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 2, isVerified: true }),
    });

    const res = await putUser(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.isVerified).toBe(true);
    expect(body.user.verifiedBy).toBe('admin@kodekiddo.com');
  });

  it('bulk verifies pending users via PUT /api/new/users/verify', async () => {
    // Select all pending query
    queryMock.mockResolvedValueOnce({
      rowCount: 2,
      rows: [{ id: 10 }, { id: 11 }],
    });

    // Update query
    queryMock.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        { id: 10, username: 'adit', role: 'Instructor', is_verified: true },
        { id: 11, username: 'vivi', role: 'Instructor', is_verified: true },
      ],
    });

    const req = new Request('http://localhost/api/new/users/verify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allPending: true, isVerified: true }),
    });

    const res = await putVerify(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.verifiedCount).toBe(2);
  });
});
