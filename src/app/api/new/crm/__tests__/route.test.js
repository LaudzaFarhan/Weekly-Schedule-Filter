// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getCrm } from '../route';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  query: queryMock,
}));

describe('GET /api/new/crm enhancements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleLeads = [
    {
      id: 10,
      name: 'Ibu Ratna (Parent of Kevin)',
      phone: '08123456789',
      message: 'Halo',
      status: 'interest_trial',
      branch: 'Bekasi',
      trial_date: null,
      notes: '[Age: 7 yo]',
      attendance_status: 'pending',
      payment_status: 'pending',
      created_at: '2026-08-01T10:00:00.000Z',
      updated_at: '2026-08-01T10:00:00.000Z',
    },
    {
      id: 20,
      name: 'Spam Nomor Penipuan',
      phone: '08999999999',
      message: 'testing bot penipuan',
      status: 'junk',
      branch: 'Bintaro',
      trial_date: null,
      notes: '[junk]',
      attendance_status: 'pending',
      payment_status: 'pending',
      created_at: '2026-08-02T10:00:00.000Z',
      updated_at: '2026-08-02T10:00:00.000Z',
    },
  ];

  it('fetches single lead when ?id= is supplied', async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [sampleLeads[0]],
    });

    const req = new Request('http://localhost:3000/api/new/crm?id=10');
    const res = await getCrm(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(10);
    expect(json.name).toBe('Ibu Ratna (Parent of Kevin)');
  });

  it('returns 404 when ?id= does not match any record', async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const req = new Request('http://localhost:3000/api/new/crm?id=999');
    const res = await getCrm(req);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Lead not found');
  });

  it('filters leads by metric=profiling', async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: sampleLeads.length,
      rows: sampleLeads,
    });

    const req = new Request('http://localhost:3000/api/new/crm?metric=profiling');
    const res = await getCrm(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].id).toBe(10);
  });

  it('filters leads by metric=junk', async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: sampleLeads.length,
      rows: sampleLeads,
    });

    const req = new Request('http://localhost:3000/api/new/crm?metric=junk');
    const res = await getCrm(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].id).toBe(20);
  });
});
