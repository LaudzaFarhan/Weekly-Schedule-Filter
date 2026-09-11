// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getPerformance } from '../route';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  query: queryMock,
}));

describe('GET /api/new/crm/performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleDbRows = [
    {
      id: 1,
      name: 'Ibu Linda (Parent of Kenzo)',
      phone: '08123456789',
      message: 'Halo mau tanya kelas',
      status: 'interest_trial',
      branch: 'Bekasi',
      trial_date: null,
      notes: '[Age: 8 yo]',
      attendance_status: 'pending',
      payment_status: 'pending',
      created_at: '2026-08-05T10:00:00.000Z',
      updated_at: '2026-08-05T10:00:00.000Z',
    },
    {
      id: 2,
      name: 'Pak Doni (Parent of Anya)',
      phone: '08129876543',
      message: 'Daftar trial sabtu',
      status: 'trial_booked',
      branch: 'Bekasi',
      trial_date: '2026-08-15',
      notes: '[profiled] Usia 9 tahun',
      attendance_status: 'attended',
      payment_status: 'paid',
      created_at: '2026-08-10T11:00:00.000Z',
      updated_at: '2026-08-10T11:00:00.000Z',
    },
    {
      id: 3,
      name: 'Promo Pinjaman Online',
      phone: '08999999999',
      message: 'Spam broadcast message',
      status: 'spam',
      branch: 'Bintaro',
      trial_date: null,
      notes: '[junk]',
      attendance_status: 'pending',
      payment_status: 'pending',
      created_at: '2026-08-12T12:00:00.000Z',
      updated_at: '2026-08-12T12:00:00.000Z',
    },
    {
      id: 4,
      name: 'Budi (Parent of Dave)',
      phone: '08111222333',
      message: 'Trial coding',
      status: 'interest_trial',
      branch: 'Kelapa Gading',
      trial_date: null,
      notes: '7 th',
      attendance_status: 'pending',
      payment_status: 'pending',
      created_at: '2026-07-20T14:00:00.000Z',
      updated_at: '2026-07-20T14:00:00.000Z',
    },
  ];

  it('aggregates performance metrics across all branches for year 2026', async () => {
    // 1. SELECT * FROM new_crm_leads
    queryMock.mockResolvedValueOnce({ rowCount: sampleDbRows.length, rows: sampleDbRows });
    // 2. SELECT value FROM internal_config WHERE key = 'branches'
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ value: ['Bekasi', 'Bintaro', 'Kelapa Gading', 'Pluit Village'] }],
    });

    const req = new Request('http://localhost:3000/api/new/crm/performance?year=2026&branch=all');
    const res = await getPerformance(req);

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.filter.year).toBe('2026');
    expect(json.filter.branch).toBe('all');

    // Total 4 leads in 2026
    expect(json.totals.leads).toBe(4);
    // Profiling: Kenzo (8yo), Anya (trial_booked), Dave (7th) = 3
    expect(json.totals.profiling).toBe(3);
    // Scheduled: Anya (trial_booked) = 1
    expect(json.totals.scheduled).toBe(1);
    // Junk: Promo Pinjaman (spam) = 1
    expect(json.totals.junk).toBe(1);

    expect(json.totals.profilingRate).toBe('75.0');
    expect(json.totals.scheduledRate).toBe('33.3');
    expect(json.totals.junkRate).toBe('25.0');

    // 12 pre-seeded months exist
    expect(json.months).toHaveLength(12);

    // Check August 2026 (index 7 or key '2026-08')
    const aug = json.months.find((m) => m.monthKey === '2026-08');
    expect(aug).toBeDefined();
    expect(aug.leadsCount).toBe(3);
    expect(aug.profilingCount).toBe(2);
    expect(aug.scheduledCount).toBe(1);
    expect(aug.junkCount).toBe(1);
    expect(aug.branchBreakdown.length).toBeGreaterThanOrEqual(4);
  });

  it('filters performance by branch (e.g. branch=Bekasi)', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: sampleDbRows.length, rows: sampleDbRows });
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ value: ['Bekasi', 'Bintaro', 'Kelapa Gading', 'Pluit Village'] }],
    });

    const req = new Request('http://localhost:3000/api/new/crm/performance?year=2026&branch=Bekasi');
    const res = await getPerformance(req);

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.totals.leads).toBe(2);
    expect(json.totals.profiling).toBe(2);
    expect(json.totals.scheduled).toBe(1);
    expect(json.totals.junk).toBe(0);
  });

  it('filters performance by single month (e.g. month=2026-08)', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: sampleDbRows.length, rows: sampleDbRows });
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ value: ['Bekasi', 'Bintaro', 'Kelapa Gading', 'Pluit Village'] }],
    });

    const req = new Request('http://localhost:3000/api/new/crm/performance?year=2026&branch=all&month=2026-08');
    const res = await getPerformance(req);

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.months).toHaveLength(1);
    expect(json.months[0].monthKey).toBe('2026-08');
    expect(json.totals.leads).toBe(3);
  });

  it('handles database errors with 500 status', async () => {
    queryMock.mockRejectedValueOnce(new Error('PostgreSQL connection timeout'));

    const req = new Request('http://localhost:3000/api/new/crm/performance?year=2026');
    const res = await getPerformance(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('PostgreSQL connection timeout');
  });
});
