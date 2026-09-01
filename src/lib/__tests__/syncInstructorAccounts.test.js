// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoSyncInstructorAccounts } from '../syncInstructorAccounts';

const { queryMock, ensureTableMock, isCredentialKeyConfiguredMock, encryptPasswordMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  ensureTableMock: vi.fn(async () => {}),
  isCredentialKeyConfiguredMock: vi.fn(() => true),
  encryptPasswordMock: vi.fn((pwd) => `encrypted:${pwd}`),
}));

vi.mock('@/lib/db', () => ({
  query: queryMock,
  withTransaction: async (cb) => cb({ query: queryMock }),
}));
vi.mock('@/lib/ensureSchema', () => ({
  ensureTable: ensureTableMock,
}));
vi.mock('@/lib/employeeCredentials', () => ({
  isCredentialKeyConfigured: isCredentialKeyConfiguredMock,
  encryptPassword: encryptPasswordMock,
}));

describe('autoSyncInstructorAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isCredentialKeyConfiguredMock.mockReturnValue(true);
  });

  it('automatically provisions accounts for all unlinked instructors', async () => {
    // 1. query internal_instructors
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          name: 'Ahmad Muhajir',
          status: 'Active',
          contact: '0812345678',
          remarks: 'Email: muhajir.thelab@gmail.com',
          branches: ['Gading Serpong'],
          level: 'Junior and Coder',
        },
        {
          id: 11,
          name: 'Albert Henry',
          status: 'Active',
          contact: '0898765432',
          remarks: 'Email: alberthenry.thelab@gmail.com',
          branches: ['Bintaro'],
          level: 'Kinder and Junior',
        },
      ],
    });

    // 2. query internal_users
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 1, instructor_id: null, username: 'admin', email: 'admin@thelab.id' },
      ],
    });

    // 3. insert into internal_users in transaction
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          username: 'ahmad.muhajir',
          email: 'muhajir.thelab@gmail.com',
          role: 'Instructor',
          instructor_id: 10,
          is_verified: false,
        },
        {
          id: 3,
          username: 'albert.henry',
          email: 'alberthenry.thelab@gmail.com',
          role: 'Instructor',
          instructor_id: 11,
          is_verified: false,
        },
      ],
    });

    const res = await autoSyncInstructorAccounts();
    expect(res.created).toHaveLength(2);
    expect(res.created[0].username).toBe('ahmad.muhajir');
    expect(res.created[0].is_verified).toBe(false);
  });

  it('returns empty if all instructors already have accounts', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 10, name: 'Ahmad Muhajir', status: 'Active' },
      ],
    });
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 2, instructor_id: 10, username: 'ahmad.muhajir', email: 'muhajir.thelab@gmail.com' },
      ],
    });

    const res = await autoSyncInstructorAccounts();
    expect(res.created).toEqual([]);
  });
});
