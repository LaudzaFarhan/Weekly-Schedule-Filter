/**
 * Shared CRM Performance & Classification Utilities
 * Provides lead classification, monthly aggregation, and cross-branch metrics calculation
 * used by both API endpoints and UI dashboard views.
 */

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Color palettes for branch visual identity
 */
export const BRANCH_PALETTES = {
  'Bekasi': { solid: '#3b82f6', light: 'rgba(59, 130, 246, 0.12)', border: '#2563eb' },
  'Bintaro': { solid: '#8b5cf6', light: 'rgba(139, 92, 246, 0.12)', border: '#7c3aed' },
  'Kelapa Gading': { solid: '#10b981', light: 'rgba(16, 185, 129, 0.12)', border: '#059669' },
  'Pluit Village': { solid: '#f59e0b', light: 'rgba(245, 158, 11, 0.12)', border: '#d97706' },
  fallback: [
    { solid: '#ec4899', light: 'rgba(236, 72, 153, 0.12)', border: '#db2777' },
    { solid: '#06b6d4', light: 'rgba(6, 182, 212, 0.12)', border: '#0891b2' },
    { solid: '#6366f1', light: 'rgba(99, 102, 241, 0.12)', border: '#4f46e5' },
    { solid: '#14b8a6', light: 'rgba(20, 184, 166, 0.12)', border: '#0d9488' },
    { solid: '#f97316', light: 'rgba(249, 115, 22, 0.12)', border: '#ea580c' },
  ],
};

export function getBranchColors(branchName, index = 0) {
  if (BRANCH_PALETTES[branchName]) {
    return BRANCH_PALETTES[branchName];
  }
  const fallbackList = BRANCH_PALETTES.fallback;
  return fallbackList[index % fallbackList.length];
}

/**
 * Classify a CRM lead into the 4 business metrics:
 * 1. Leads: Total customer inbound chats/inquiries.
 * 2. Profiling: Lead with student name, parent name, and age captured.
 * 3. Trial Scheduled: Scheduled for a trial and expected to attend.
 * 4. Junk Leads: Spam, invalid contacts, or test inquiries.
/**
 * Safely extract follow-up journey array from a lead object or its notes
 */
export function getLeadFollowUps(lead) {
  if (!lead) return [];
  if (Array.isArray(lead.followUps)) return lead.followUps;
  if (Array.isArray(lead.follow_ups)) return lead.follow_ups;

  if (typeof lead.followUps === 'string') {
    try {
      const parsed = JSON.parse(lead.followUps);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  if (typeof lead.follow_ups === 'string') {
    try {
      const parsed = JSON.parse(lead.follow_ups);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }

  // Fallback search in notes for [FollowUps: [...]]
  const notesStr = String(lead.notes || '');
  const match = notesStr.match(/\[FollowUps:\s*(\[.*?\])\]/s);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }

  return [];
}

/**
 * Classify a CRM lead into the 4 business metrics:
 * 1. Leads: Total customer inbound chats/inquiries.
 * 2. Profiling: Lead with student name, parent name, and age captured.
 * 3. Trial Scheduled: Scheduled for a trial and expected to attend.
 * 4. Junk Leads: Spam, invalid contacts, or test inquiries.
 * Also computes follow-up status (needsFollowUp) and journey history.
 */
export function classifyLead(lead) {
  if (!lead) {
    return {
      isJunk: false,
      isScheduled: false,
      isProfiled: false,
      needsFollowUp: false,
      followUps: [],
      followUpCount: 0,
      lastFollowUp: null,
    };
  }

  const name = String(lead.name || '').trim();
  const notes = String(lead.notes || '').trim();
  const message = String(lead.message || '').trim();
  const status = String(lead.status || '').toLowerCase().trim();
  const combinedText = `${name} ${notes} ${message}`.toLowerCase();

  // 1. Junk Leads: spam, test, or invalid contacts
  const isJunk =
    status === 'junk' ||
    status === 'spam' ||
    combinedText.includes('[junk]') ||
    combinedText.includes('[spam]') ||
    /\b(spam|junk|salah sambung|penipuan|broadcast|testing bot|fake lead)\b/i.test(combinedText);

  if (isJunk) {
    return {
      isJunk: true,
      isScheduled: false,
      isProfiled: false,
      needsFollowUp: false,
      followUps: [],
      followUpCount: 0,
      lastFollowUp: null,
    };
  }

  // 2. Trial Scheduled: status is booked or explicit trial date set
  const isScheduled =
    status === 'trial_booked' ||
    Boolean(lead.trialDate || lead.trial_date);

  // 3. Profiling: customer already chatted us and filled student name, parent name, age
  // If status is profiling or scheduled, it is part of profiling.
  const hasParentChildName =
    /(parent of|ortu|ayah|ibu|mama|papa|anak)/i.test(name) ||
    name.includes('(') ||
    /(parent|student|child|nama anak|nama ortu|ortu:|murid)/i.test(combinedText);

  const hasAgeIndicator =
    /(age|usia|\b\d{1,2}\s*(th|tahun|yo|years|bln|bulan))\b/i.test(combinedText) ||
    /kelas\s*\d/i.test(combinedText) ||
    /grade\s*\d/i.test(combinedText) ||
    /(kinder|junior|coder)/i.test(combinedText);

  const hasExplicitProfileTag = combinedText.includes('[profiled]');

  const isProfiled =
    status === 'profiling' ||
    status === 'profile' ||
    isScheduled ||
    hasExplicitProfileTag ||
    (hasParentChildName && (hasAgeIndicator || name.includes('Parent of')));

  // Follow-up Journey metrics
  const followUps = getLeadFollowUps(lead);
  const followUpCount = followUps.length;
  const lastFollowUp = followUpCount > 0 ? followUps[followUpCount - 1] : null;

  // A parent in the profiling category who has not yet scheduled trial is a lead that NEEDS FOLLOW UP
  const needsFollowUp =
    !isScheduled &&
    (isProfiled || combinedText.includes('[need follow up]') || combinedText.includes('[need_follow_up]') || combinedText.includes('[follow up]'));

  return {
    isJunk: false,
    isScheduled,
    isProfiled,
    needsFollowUp,
    followUps,
    followUpCount,
    lastFollowUp,
  };
}

/**
 * Format a month key (YYYY-MM) into a human-friendly display label (e.g. "Aug 2026")
 */
export function formatMonthLabel(monthKey) {
  if (!monthKey || typeof monthKey !== 'string') return '';
  const [yearStr, monthStr] = monthKey.split('-');
  const monthIdx = parseInt(monthStr, 10) - 1;
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return monthKey;
  return `${MONTH_NAMES[monthIdx]} ${yearStr}`;
}

/**
 * Extract YYYY-MM from lead date
 */
export function getLeadMonth(lead) {
  const dateStr = lead.createdAt || lead.created_at || lead.updatedAt || lead.updated_at || lead.trialDate || lead.trial_date;
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Aggregate leads across months based on the 4 metric categories and cross-branch breakdown
 * @param {Array} leads - Array of CRM lead objects
 * @param {string} selectedYear - Year string e.g. '2026' or 'all'
 * @param {string} selectedBranch - Branch name filter e.g. 'Bekasi' or 'all'
 * @param {Array} configuredBranches - List of configured branch objects or names
 * @param {boolean} includeLeads - Whether to include raw leads in the output arrays
 */
export function aggregateMonthlyData(
  leads = [],
  selectedYear = '2026',
  selectedBranch = 'all',
  configuredBranches = [],
  includeLeads = true
) {
  // Collect all known branches
  const branchNameSet = new Set();
  (Array.isArray(configuredBranches) ? configuredBranches : []).forEach((b) => {
    const name = typeof b === 'string' ? b : (b?.name || b?.id);
    if (name && String(name).trim()) branchNameSet.add(String(name).trim());
  });

  // Extract any branch present in the leads dataset
  leads.forEach((l) => {
    const b = String(l?.branch || '').trim();
    if (b) branchNameSet.add(b);
  });

  // Default fallback branches if empty
  if (branchNameSet.size === 0) {
    ['Bekasi', 'Bintaro', 'Kelapa Gading', 'Pluit Village'].forEach((b) => branchNameSet.add(b));
  }

  const distinctBranches = Array.from(branchNameSet).sort();

  // Pre-seed full year branch totals map
  const branchTotalsMap = new Map();
  distinctBranches.forEach((br) => {
    branchTotalsMap.set(br, {
      branchName: br,
      leads: 0,
      profiling: 0,
      scheduled: 0,
      junk: 0,
      profilingRate: '0.0',
      scheduledRate: '0.0',
      junkRate: '0.0',
      shareOfTotal: '0.0',
    });
  });

  const createInitialBranchBreakdown = () => {
    return distinctBranches.map((br) => ({
      branchName: br,
      leadsCount: 0,
      profilingCount: 0,
      scheduledCount: 0,
      junkCount: 0,
      profilingRate: '0.0',
      scheduledRate: '0.0',
      junkRate: '0.0',
      leadsList: includeLeads ? [] : undefined,
    }));
  };

  // Collect monthly map
  const monthMap = new Map();

  // Pre-seed all 12 months if a specific year is chosen (e.g. 2026)
  if (selectedYear !== 'all' && !isNaN(parseInt(selectedYear, 10))) {
    const y = parseInt(selectedYear, 10);
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      monthMap.set(key, {
        monthKey: key,
        monthLabel: formatMonthLabel(key),
        year: y,
        leadsCount: 0,
        profilingCount: 0,
        scheduledCount: 0,
        junkCount: 0,
        leadsList: includeLeads ? [] : undefined,
        branchBreakdown: createInitialBranchBreakdown(),
      });
    }
  }

  // Iterate over all leads
  leads.forEach((lead) => {
    const monthKey = getLeadMonth(lead);
    if (!monthKey) return;

    const [leadYear] = monthKey.split('-');
    if (selectedYear !== 'all' && leadYear !== String(selectedYear)) {
      return;
    }

    const branchName = String(lead.branch || 'Unassigned').trim();
    const classification = classifyLead(lead);

    // Track in full-year branch totals
    if (!branchTotalsMap.has(branchName)) {
      branchTotalsMap.set(branchName, {
        branchName,
        leads: 0,
        profiling: 0,
        scheduled: 0,
        junk: 0,
        profilingRate: '0.0',
        scheduledRate: '0.0',
        junkRate: '0.0',
        shareOfTotal: '0.0',
      });
    }
    const bTotal = branchTotalsMap.get(branchName);
    bTotal.leads += 1;
    if (classification.isJunk) {
      bTotal.junk += 1;
    } else {
      if (classification.isProfiled) bTotal.profiling += 1;
      if (classification.isScheduled) bTotal.scheduled += 1;
    }

    // Ensure month entry exists
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        monthKey,
        monthLabel: formatMonthLabel(monthKey),
        year: parseInt(leadYear, 10) || new Date().getFullYear(),
        leadsCount: 0,
        profilingCount: 0,
        scheduledCount: 0,
        junkCount: 0,
        leadsList: includeLeads ? [] : undefined,
        branchBreakdown: createInitialBranchBreakdown(),
      });
    }

    const mData = monthMap.get(monthKey);

    // Find or add branch entry in this month's branchBreakdown
    let monthBranchEntry = mData.branchBreakdown.find(
      (b) => b.branchName.toLowerCase() === branchName.toLowerCase()
    );
    if (!monthBranchEntry) {
      monthBranchEntry = {
        branchName,
        leadsCount: 0,
        profilingCount: 0,
        scheduledCount: 0,
        junkCount: 0,
        profilingRate: '0.0',
        scheduledRate: '0.0',
        junkRate: '0.0',
        leadsList: includeLeads ? [] : undefined,
      };
      mData.branchBreakdown.push(monthBranchEntry);
    }

    monthBranchEntry.leadsCount += 1;
    if (classification.isJunk) {
      monthBranchEntry.junkCount += 1;
    } else {
      if (classification.isProfiled) monthBranchEntry.profilingCount += 1;
      if (classification.isScheduled) monthBranchEntry.scheduledCount += 1;
    }
    if (includeLeads && monthBranchEntry.leadsList) {
      monthBranchEntry.leadsList.push({ ...lead, classification });
    }

    // Also update month's top-level totals if matches selectedBranch
    const matchesSelectedBranch =
      !selectedBranch ||
      selectedBranch === 'all' ||
      branchName.toLowerCase() === String(selectedBranch).toLowerCase().trim();

    if (matchesSelectedBranch) {
      mData.leadsCount += 1;
      if (classification.isJunk) {
        mData.junkCount += 1;
      } else {
        if (classification.isProfiled) {
          mData.profilingCount += 1;
        }
        if (classification.isScheduled) {
          mData.scheduledCount += 1;
        }
      }
      if (includeLeads && mData.leadsList) {
        mData.leadsList.push({ ...lead, classification });
      }
    }
  });

  // Compute rates for each month's branch breakdown and sort
  monthMap.forEach((m) => {
    m.branchBreakdown.forEach((b) => {
      b.profilingRate = b.leadsCount > 0 ? ((b.profilingCount / b.leadsCount) * 100).toFixed(1) : '0.0';
      b.scheduledRate = b.profilingCount > 0 ? ((b.scheduledCount / b.profilingCount) * 100).toFixed(1) : '0.0';
      b.junkRate = b.leadsCount > 0 ? ((b.junkCount / b.leadsCount) * 100).toFixed(1) : '0.0';
    });
    // Sort branches inside month by leadsCount desc, then branch name
    m.branchBreakdown.sort((a, b) => b.leadsCount - a.leadsCount || a.branchName.localeCompare(b.branchName));
  });

  // Sort months chronologically
  const sortedMonths = Array.from(monthMap.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  // Compute overall totals for the selected branch filter
  let totalLeads = 0;
  let totalProfiling = 0;
  let totalScheduled = 0;
  let totalJunk = 0;

  sortedMonths.forEach((m) => {
    totalLeads += m.leadsCount;
    totalProfiling += m.profilingCount;
    totalScheduled += m.scheduledCount;
    totalJunk += m.junkCount;
  });

  // Calculate totals across all branches
  let allBranchesTotalLeads = 0;
  branchTotalsMap.forEach((b) => {
    allBranchesTotalLeads += b.leads;
    b.profilingRate = b.leads > 0 ? ((b.profiling / b.leads) * 100).toFixed(1) : '0.0';
    b.scheduledRate = b.profiling > 0 ? ((b.scheduled / b.profiling) * 100).toFixed(1) : '0.0';
    b.junkRate = b.leads > 0 ? ((b.junk / b.leads) * 100).toFixed(1) : '0.0';
  });

  const branchTotalsArray = Array.from(branchTotalsMap.values()).map((b) => ({
    ...b,
    shareOfTotal: allBranchesTotalLeads > 0 ? ((b.leads / allBranchesTotalLeads) * 100).toFixed(1) : '0.0',
  })).sort((a, b) => b.leads - a.leads || a.branchName.localeCompare(b.branchName));

  return {
    months: sortedMonths,
    totals: {
      leads: totalLeads,
      profiling: totalProfiling,
      scheduled: totalScheduled,
      junk: totalJunk,
      profilingRate: totalLeads > 0 ? ((totalProfiling / totalLeads) * 100).toFixed(1) : '0.0',
      scheduledRate: totalProfiling > 0 ? ((totalScheduled / totalProfiling) * 100).toFixed(1) : '0.0',
      junkRate: totalLeads > 0 ? ((totalJunk / totalLeads) * 100).toFixed(1) : '0.0',
    },
    branchTotals: branchTotalsArray,
    availableBranches: distinctBranches,
    allBranchesTotalLeads,
  };
}
