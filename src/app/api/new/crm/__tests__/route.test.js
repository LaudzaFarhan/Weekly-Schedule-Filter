// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getCrm, PUT as putCrm } from '../route';

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

describe('PUT /api/new/crm Follow-up Journey Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs a new follow-up interaction, increments attempts, and tracks who did it', async () => {
    queryMock.mockImplementation(async (sql) => {
      if (sql.includes('ALTER TABLE')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT notes, follow_ups, name FROM new_crm_leads')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 10,
              name: 'Ibu Ratna (Parent of Kevin)',
              notes: 'Kelas 4 SD',
              follow_ups: JSON.stringify([
                { id: 'fu_1', attempt: 1, performedBy: 'Kak Sky', channel: 'WhatsApp', notes: 'First touch' },
              ]),
            },
          ],
        };
      }
      if (sql.includes('UPDATE new_crm_leads')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 10,
              name: 'Ibu Ratna (Parent of Kevin)',
              phone: '08123456789',
              status: 'profiling',
              branch: 'Bekasi',
              trial_date: null,
              notes: 'Kelas 4 SD [FollowUps: [{"attempt":1},{"attempt":2}]]',
              attendance_status: 'pending',
              payment_status: 'pending',
              follow_ups: [
                { id: 'fu_1', attempt: 1, performedBy: 'Kak Sky', channel: 'WhatsApp', notes: 'First touch' },
                { id: 'fu_2', attempt: 2, performedBy: 'Kak Muhajir', channel: 'Phone Call', notes: 'Discussed schedule' },
              ],
              created_at: '2026-08-01T10:00:00.000Z',
              updated_at: '2026-08-08T10:00:00.000Z',
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    });

    const req = new Request('http://localhost:3000/api/new/crm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 10,
        newFollowUp: {
          performedBy: 'Kak Muhajir',
          channel: 'Phone Call',
          notes: 'Discussed schedule',
        },
      }),
    });

    const res = await putCrm(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.id).toBe(10);
    expect(json.followUpCount).toBe(2);
    expect(json.lastFollowUp.performedBy).toBe('Kak Muhajir');
    expect(json.lastFollowUp.channel).toBe('Phone Call');
    expect(json.needsFollowUp).toBe(true);
  });
});
