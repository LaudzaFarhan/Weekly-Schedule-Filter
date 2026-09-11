// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as postWebhook } from '../route';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  query: queryMock,
}));

describe('POST /api/new/crm/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ingests lead and auto-profiles when parent, child, and age are provided', async () => {
    queryMock.mockResolvedValueOnce({}); // ALTER TABLE ready
    queryMock.mockResolvedValueOnce({}); // ALTER TABLE ready
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: 101,
          name: 'Budi Santoso (Parent of Kenzo)',
          phone: '+62 812-3456-7890',
          message: 'Mau tanya trial',
          status: 'interest_trial',
          branch: 'Bekasi',
          trial_date: null,
          notes: '[profiled] [Age: 8 yo] Datang hari sabtu',
          attendance_status: 'pending',
          payment_status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });

    const payload = {
      parent_name: 'Budi Santoso',
      child_name: 'Kenzo',
      age: '8',
      phone: '081234567890',
      branch: 'Bekasi',
      message: 'Mau tanya trial',
      notes: 'Datang hari sabtu',
    };

    const req = new Request('http://localhost:3000/api/new/crm/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await postWebhook(req);
    expect(res.status).toBe(201);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.lead.id).toBe(101);
    expect(json.lead.name).toContain('Budi Santoso (Parent of Kenzo)');
    expect(json.classification.isProfiled).toBe(true);
    expect(json.classification.isJunk).toBe(false);
  });

  it('detects and classifies spam/junk leads from webhook', async () => {
    queryMock.mockResolvedValueOnce({});
    queryMock.mockResolvedValueOnce({});
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: 102,
          name: 'Pinjaman Online Cair Cepat',
          phone: '+62 899-1234-5678',
          message: 'Dapatkan pinjaman tanpa jaminan spam broadcast',
          status: 'spam',
          branch: 'Bekasi',
          trial_date: null,
          notes: '[junk]',
          attendance_status: 'pending',
          payment_status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });

    const payload = {
      name: 'Pinjaman Online Cair Cepat',
      phone: '089912345678',
      message: 'Dapatkan pinjaman tanpa jaminan spam broadcast',
      branch: 'Bekasi',
    };

    const req = new Request('http://localhost:3000/api/new/crm/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await postWebhook(req);
    expect(res.status).toBe(201);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.classification.isJunk).toBe(true);
  });

  it('rejects payload missing phone number with 400', async () => {
    queryMock.mockResolvedValueOnce({});
    queryMock.mockResolvedValueOnce({});

    const payload = {
      name: 'Tanpa Nomor Telepon',
      message: 'Halo',
    };

    const req = new Request('http://localhost:3000/api/new/crm/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await postWebhook(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Validation failed');
  });
});
