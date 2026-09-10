// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, PUT, DELETE } from '../route';

const { queryMock, ensureTableMock, identifyMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  ensureTableMock: vi.fn(async () => {}),
  identifyMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  query: queryMock,
}));

vi.mock('@/lib/ensureSchema', () => ({
  ensureTable: ensureTableMock,
}));

vi.mock('@/lib/apiIdentity', async () => {
  const actual = await vi.importActual('@/lib/apiIdentity');
  return {
    ...actual,
    identify: identifyMock,
  };
});

describe('Leave API Role Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Unauthorized roles (Instructor, Supervisor, EC)', () => {
    it('refuses POST for Instructor sessions with 403 Forbidden', async () => {
      identifyMock.mockResolvedValueOnce({
        kind: 'session',
        userId: 10,
        email: 'inst@thelab.id',
        role: 'Instructor',
      });

      const req = new Request('http://localhost/api/new/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Felix Tio',
          startDate: '2026-09-15',
          endDate: '2026-09-16',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
      expect(data.message).toMatch(/only admin and spa/i);
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('refuses PUT for Supervisor sessions with 403 Forbidden', async () => {
      identifyMock.mockResolvedValueOnce({
        kind: 'session',
        userId: 11,
        email: 'sup@thelab.id',
        role: 'Supervisor',
      });

      const req = new Request('http://localhost/api/new/leave', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 5,
          status: 'Approved',
        }),
      });

      const res = await PUT(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('refuses DELETE for Instructor sessions with 403 Forbidden', async () => {
      identifyMock.mockResolvedValueOnce({
        kind: 'session',
        userId: 12,
        email: 'inst@thelab.id',
        role: 'Instructor',
      });

      const req = new Request('http://localhost/api/new/leave?id=5', {
        method: 'DELETE',
      });

      const res = await DELETE(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
      expect(queryMock).not.toHaveBeenCalled();
    });
  });

  describe('Authorized roles (Admin, SPA)', () => {
    it('allows Admin to record leave via POST', async () => {
      identifyMock.mockResolvedValueOnce({
        kind: 'session',
        userId: 1,
        email: 'admin@thelab.id',
        role: 'Admin',
      });

      // Dupe check returns 0
      queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // Insert returns record
      queryMock.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 1,
          instructor_name: 'Felix Tio',
          start_date: '2026-09-15',
          end_date: '2026-09-16',
          reason: 'Training',
          status: 'Approved',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      const req = new Request('http://localhost/api/new/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Felix Tio',
          startDate: '2026-09-15',
          endDate: '2026-09-16',
          reason: 'Training',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe('Felix Tio');
      expect(data.status).toBe('Approved');
    });

    it('allows SPA to update leave status via PUT', async () => {
      identifyMock.mockResolvedValueOnce({
        kind: 'session',
        userId: 2,
        email: 'spa@thelab.id',
        role: 'SPA',
      });

      queryMock.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 1,
          instructor_name: 'Felix Tio',
          start_date: '2026-09-15',
          end_date: '2026-09-16',
          reason: 'Training',
          status: 'Approved',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      const req = new Request('http://localhost/api/new/leave', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          status: 'Approved',
        }),
      });

      const res = await PUT(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('Approved');
    });

    it('allows SPA to delete leave record via DELETE', async () => {
      identifyMock.mockResolvedValueOnce({
        kind: 'session',
        userId: 2,
        email: 'spa@thelab.id',
        role: 'SPA',
      });

      queryMock.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 1 }],
      });

      const req = new Request('http://localhost/api/new/leave?id=1', {
        method: 'DELETE',
      });

      const res = await DELETE(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });
});
