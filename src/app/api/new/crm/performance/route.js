import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { aggregateMonthlyData } from '@/utils/crmPerformance';

/**
 * Helper to map database rows into lead objects
 */
function mapRow(row) {
  const notesStr = String(row.notes || '');
  const attMatch = notesStr.match(/\[Attendance:\s*([a-z_]+)\]/i);
  const payMatch = notesStr.match(/\[Payment:\s*([a-z_]+)\]/i);

  let attendanceStatus = attMatch ? attMatch[1].toLowerCase() : row.attendance_status;
  if (!attendanceStatus) {
    if (notesStr.toLowerCase().includes('[attended]')) attendanceStatus = 'attended';
    else if (notesStr.toLowerCase().includes('[absent]')) attendanceStatus = 'absent';
    else attendanceStatus = 'pending';
  }

  let paymentStatus = payMatch ? payMatch[1].toLowerCase() : row.payment_status;
  if (!paymentStatus) {
    if (notesStr.toLowerCase().includes('[paid]')) paymentStatus = 'paid';
    else if (notesStr.toLowerCase().includes('[unpaid]')) paymentStatus = 'unpaid';
    else paymentStatus = 'pending';
  }

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    message: row.message,
    status: row.status,
    branch: row.branch,
    trialDate: row.trial_date,
    notes: row.notes,
    attendanceStatus: attendanceStatus || 'pending',
    paymentStatus: paymentStatus || 'pending',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch configured branches from internal_config if available
 */
async function getConfiguredBranches() {
  try {
    const res = await query(`SELECT value FROM internal_config WHERE key = 'branches' LIMIT 1`);
    if (res.rowCount > 0 && res.rows[0].value) {
      const val = res.rows[0].value;
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) return parsed;
        } catch (_) {}
      }
    }
  } catch (err) {
    // internal_config table may not exist yet or be empty
  }
  return ['Bekasi', 'Bintaro', 'Kelapa Gading', 'Pluit Village'];
}

/**
 * GET: Fetch aggregated CRM performance analytics
 * Query parameters:
 *   - year: '2026' | '2025' | 'all' (default: '2026')
 *   - branch: 'all' | '<branch_name>' (default: 'all')
 *   - month: 'YYYY-MM' | '1'-'12' | 'all' (optional filter for single month)
 *   - includeLeads: 'true' | 'false' (default: 'false' for performance)
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const selectedYear = searchParams.get('year') || String(new Date().getFullYear());
    const selectedBranch = searchParams.get('branch') || 'all';
    const monthParam = searchParams.get('month');
    const includeLeads = searchParams.get('includeLeads') === 'true';

    // Fetch all leads
    const leadsRes = await query(`SELECT * FROM new_crm_leads ORDER BY created_at ASC, updated_at ASC`);
    const leads = (leadsRes.rows || []).map(mapRow);

    // Fetch branch definitions
    const configuredBranches = await getConfiguredBranches();

    // Aggregate data using shared performance calculation engine
    const aggregation = aggregateMonthlyData(
      leads,
      selectedYear,
      selectedBranch,
      configuredBranches,
      includeLeads
    );

    let months = aggregation.months;
    let totals = aggregation.totals;

    // Handle month filter if specified (e.g. ?month=2026-08 or ?month=8)
    if (monthParam && monthParam !== 'all') {
      let targetKey = monthParam;
      // Convert single/double digit month (e.g. '8' or '08') into 'YYYY-MM'
      if (/^\d{1,2}$/.test(monthParam) && selectedYear !== 'all') {
        targetKey = `${selectedYear}-${String(monthParam).padStart(2, '0')}`;
      }

      const matchedMonth = months.find((m) => m.monthKey === targetKey);
      if (matchedMonth) {
        months = [matchedMonth];
        totals = {
          leads: matchedMonth.leadsCount,
          profiling: matchedMonth.profilingCount,
          scheduled: matchedMonth.scheduledCount,
          junk: matchedMonth.junkCount,
          profilingRate: matchedMonth.leadsCount > 0 ? ((matchedMonth.profilingCount / matchedMonth.leadsCount) * 100).toFixed(1) : '0.0',
          scheduledRate: matchedMonth.profilingCount > 0 ? ((matchedMonth.scheduledCount / matchedMonth.profilingCount) * 100).toFixed(1) : '0.0',
          junkRate: matchedMonth.leadsCount > 0 ? ((matchedMonth.junkCount / matchedMonth.leadsCount) * 100).toFixed(1) : '0.0',
        };
      } else {
        months = [];
        totals = {
          leads: 0,
          profiling: 0,
          scheduled: 0,
          junk: 0,
          profilingRate: '0.0',
          scheduledRate: '0.0',
          junkRate: '0.0',
        };
      }
    }

    return NextResponse.json({
      success: true,
      filter: {
        year: selectedYear,
        branch: selectedBranch,
        month: monthParam || null,
      },
      totals,
      months,
      branchTotals: aggregation.branchTotals,
      availableBranches: aggregation.availableBranches,
      allBranchesTotalLeads: aggregation.allBranchesTotalLeads,
    });
  } catch (error) {
    console.error('Error fetching CRM performance analytics:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
