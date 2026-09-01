// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../route';
import { encryptPassword } from '@/lib/employeeCredentials';

const { queryMock, ensureTableMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  ensureTableMock: vi.fn(async () => {}),
}));

vi.mock('@/lib/db', () => ({
  query: queryMock,
}));
vi.mock('@/lib/ensureSchema', () => ({
  ensureTable: ensureTableMock,
}));

describe('Login API Verification Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EMPLOYEE_CREDENTIAL_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  it('rejects an unverified instructor account with 403 and pending verification message', async () => {
    const encrypted = encryptPassword('password123');

    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 5,
        username: 'ahmad.muhajir',
        email: 'muhajir@thelab.id',
        role: 'Instructor',
        status: 'Active',
        is_verified: false,
        password_encrypted: encrypted,
      }],
    });

    const req = new Request('http://localhost/api/new/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'ahmad.muhajir', password: 'password123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Account Pending Verification');
    expect(body.isPendingVerification).toBe(true);
  });

  it('allows verified accounts to sign in', async () => {
    const encrypted = encryptPassword('password123');

    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 5,
        username: 'ahmad.muhajir',
        email: 'muhajir@thelab.id',
        role: 'Instructor',
        status: 'Active',
        is_verified: true,
        password_encrypted: encrypted,
      }],
    });

    // Session insert query
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // Update last_login_at query
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const req = new Request('http://localhost/api/new/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'ahmad.muhajir', password: 'password123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.username).toBe('ahmad.muhajir');
  });

  it('always allows Admin accounts even if is_verified flag was somehow unset', async () => {
    const encrypted = encryptPassword('password123');

    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 1,
        username: 'admin',
        email: 'admin@thelab.id',
        role: 'Admin',
        status: 'Active',
        is_verified: false,
        password_encrypted: encrypted,
      }],
    });

    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const req = new Request('http://localhost/api/new/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin', password: 'password123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.username).toBe('admin');
  });
});
