'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ui/Toast';
import { DAY_NAMES } from '../utils/constants';
import { getInstructorBranch } from '../utils/instructorUtils';
import {
  buildWorkloadReport,
  buildIdleWorkloadRow,
  summarizeWorkload,
  classifyWeekly,
  classifyDaily,
  formatHoursMinutes,
  formatMinutesToClock,
  WORKING_WINDOW_START_MIN,
  WORKING_WINDOW_END_MIN,
  DEFAULT_THRESHOLDS,
} from '../utils/workloadUtils';
import {
  saveSnapshot, snapshotExists, getSnapshot,
  listBranchSnapshots, cleanupOldSnapshots, todayKey, RETENTION_DAYS,
} from '../services/workloadHistoryService';
import KpiCard from '../components/ui/KpiCard';
import Pagination from '../components/ui/Pagination';
import {
  Activity, Users, Clock, AlertOctagon, Minus,
  Search, ChevronDown, ChevronRight, BarChart3, MapPin,
  Save, History, Calendar as CalendarIcon, TrendingUp, X,
} from 'lucide-react';

const PAGE_SIZE = 8;

const STATUS_VARIANT = {
  idle: { bg: 'var(--bg-color)', fg: 'var(--text-muted)', label: 'Idle' },
  low: { bg: 'var(--primary-blue-light)', fg: 'var(--primary-blue)', label: 'Light' },
  normal: { bg: 'var(--success-bg)', fg: 'var(--success)', label: 'Healthy' },
  overload: { bg: 'var(--danger-bg)', fg: 'var(--danger)', label: 'Overload' },
};

const statusTooltip = (variant, t) => {
  switch (variant) {
    case 'overload': return `Teaching more than ${t.weeklyRed} h/week — risk of burnout.`;
    case 'normal':   return `Healthy load (${t.weeklyAmber}–${t.weeklyRed} h/week).`;
    case 'low':      return `Light load (under ${t.weeklyAmber} h/week) — has room for more classes.`;
    case 'idle':     return 'No classes scheduled this week.';
    default:         return '';
  }
};

function StatusPill({ variant, thresholds }) {
  const v = STATUS_VARIANT[variant] || STATUS_VARIANT.idle;
  return (
    <span
      title={thresholds ? statusTooltip(variant, thresholds) : undefined}
      style={{
        background: v.bg,
        color: v.fg,
        padding: '0.15rem 0.55rem',
        borderRadius: '99px',
        fontSize: '0.7rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        cursor: thresholds ? 'help' : 'default',
      }}
    >
      {v.label}
    </span>
  );
}

/** Compact hour bar — visual for a single value compared to a max. */
function HourBar({ hours, max, variant = 'normal' }) {
  const pct = max > 0 ? Math.min(100, (hours / max) * 100) : 0;
  const v = STATUS_VARIANT[variant] || STATUS_VARIANT.normal;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div
        style={{
          flex: 1,
          height: '6px',
          background: 'var(--bg-color)',
          borderRadius: '3px',
          overflow: 'hidden',
          minWidth: '60px',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: v.fg,
            transition: 'width 0.3s',
          }}
        />
      </div>
      <span style={{ fontSize: '0.75rem', color: v.fg, fontWeight: 600, minWidth: '38px', textAlign: 'right' }}>
        {formatHoursMinutes(hours)}
      </span>
    </div>
  );
}

export default function WorkloadPage() {
  const {
    overallClasses,
    activeBranchName,
    disabledInstructors,
    leaveList,
    enabledBranches,
    instructorProfiles,
  } = useSchedule();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [branchFilter, setBranchFilter] = useState(activeBranchName || 'all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('hours');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(new Set());

  // Heatmap drill-down: clicking a filled cell opens a session-level modal
  // showing exactly what the instructor teaches that day.
  const [heatmapDetail, setHeatmapDetail] = useState(null); // { teacher, day, dayData }

  // History state
  const [isSaving, setIsSaving] = useState(false);
  const [snapshots, setSnapshots] = useState([]);     // list of { id, date, branch, rows[] }
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    // Default to yesterday so today shows up after the first save
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return todayKey(d);
  });
  const [trendInstructor, setTrendInstructor] = useState('');

  const thresholds = DEFAULT_THRESHOLDS;

  // Source classes: respect branch filter. "all" means every enabled branch.
  const sourceClasses = useMemo(() => {
    if (branchFilter === 'all') return overallClasses;
    return overallClasses.filter((c) => c.branchName === branchFilter);
  }, [overallClasses, branchFilter]);

  // Build the full report once per data change
  const rawReport = useMemo(
    () => buildWorkloadReport(sourceClasses, { disabledInstructors }),
    [sourceClasses, disabledInstructors]
  );

  // Lookup for profile-declared locations — used to filter the workload list
  // by an instructor's HOME BRANCH (per Instructor Profiles), not just the
  // branch a class row happens to belong to.
  // Keys are normalised (lowercased + trimmed) so a sheet typo like
  // "Christian " or "christian" still resolves to the right profile.
  const profileLocationByName = useMemo(() => {
    const map = new Map();
    const norm = (s) => String(s || '').trim().toLowerCase();
    for (const p of instructorProfiles) {
      if (!p.location) continue;
      const candidates = [
        p.nickname,
        p.fullname,
        p.id ? p.id.split('@')[0] : null,
      ].filter(Boolean);
      for (const name of candidates) {
        const key = norm(name);
        if (key && !map.has(key)) map.set(key, p.location);
      }
    }
    // Wrap in a function-style API so callers don't have to know about the
    // normalisation — they just call get(rawName).
    return {
      get: (rawName) => map.get(norm(rawName)) || null,
      has: (rawName) => map.has(norm(rawName)),
    };
  }, [instructorProfiles]);

  // Merge profile-only instructors (those with a profile but no class rows
  // yet) into the report as zero-hour "Idle" rows. Without this, anyone who
  // has been added to Instructor Profiles but hasn't been put on the
  // schedule yet is silently invisible — exactly what was happening when a
  // newly added profile didn't show up in the workload.
  //
  // Display-name precedence is **nickname → fullname → email-prefix** so it
  // matches what you see in the Instructor Profiles table. Dedup considers
  // both nickname and fullname AND a normalised (case/space-insensitive)
  // form, so a sheet typo like "christian " still ties back to the profile.
  const reportWithIdle = useMemo(() => {
    const norm = (s) => String(s || '').trim().toLowerCase();
    const existingByExact = new Set(rawReport.map((r) => r.teacher));
    const existingByNorm = new Set(rawReport.map((r) => norm(r.teacher)));
    const extras = [];
    for (const profile of instructorProfiles) {
      const candidates = [
        profile.nickname,
        profile.fullname,
        profile.id ? profile.id.split('@')[0] : null,
      ].filter(Boolean);
      if (candidates.length === 0) continue;

      // Skip if any candidate name is already represented in the schedule,
      // either exactly or under a forgiving normalisation.
      const alreadyKnown = candidates.some((c) =>
        existingByExact.has(c) || existingByNorm.has(norm(c))
      );
      if (alreadyKnown) continue;

      const displayName = candidates[0];
      if (disabledInstructors && disabledInstructors.has(displayName)) continue;

      extras.push(buildIdleWorkloadRow(displayName));
      candidates.forEach((c) => {
        existingByExact.add(c);
        existingByNorm.add(norm(c));
      });
    }

    return rawReport.concat(extras);
  }, [rawReport, instructorProfiles, disabledInstructors]);

  // When a single branch is selected, drop instructors whose profile assigns
  // them to a different branch — even if they happen to show up in this
  // branch's schedule (e.g., a stray class row or stale data). This keeps the
  // workload list aligned with the Instructor Profiles page.
  const report = useMemo(() => {
    if (branchFilter === 'all') return reportWithIdle;
    return reportWithIdle.filter((r) => {
      const profileLoc = profileLocationByName.get(r.teacher);
      if (profileLoc) {
        // Profile is the source of truth: match the selected branch
        // or instructors flagged "All Branches".
        return profileLoc === branchFilter || profileLoc === 'All Branches';
      }
      // Unprofiled instructors fall through — they still appear if they
      // have classes in the selected branch (legacy behaviour).
      return true;
    });
  }, [reportWithIdle, branchFilter, profileLocationByName]);

  // Resolve a profile-based "home branch" tag for each instructor in the report.
  // Falls back to the schedule-derived branch when no profile location exists.
  const instructorTagMap = useMemo(() => {
    const map = new Map();
    for (const r of report) {
      const tag = getInstructorBranch(r.teacher, instructorProfiles, overallClasses);
      map.set(r.teacher, tag === 'Unknown' ? null : tag);
    }
    return map;
  }, [report, instructorProfiles, overallClasses]);

  const summary = useMemo(() => summarizeWorkload(report, thresholds), [report, thresholds]);

  // Apply UI filters (search + status)
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return report.filter((r) => {
      if (s && !r.teacher.toLowerCase().includes(s)) return false;
      if (statusFilter !== 'all') {
        const cls = classifyWeekly(r.weekly.hours, thresholds);
        if (cls !== statusFilter) return false;
      }
      return true;
    });
  }, [report, search, statusFilter, thresholds]);

  // Sort
  const sorted = useMemo(() => {
    const arr = filtered.slice();
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av, bv;
      switch (sortBy) {
        case 'name':
          av = a.teacher;
          bv = b.teacher;
          return av.localeCompare(bv) * dir;
        case 'branch':
          av = instructorTagMap.get(a.teacher) || '';
          bv = instructorTagMap.get(b.teacher) || '';
          return av.localeCompare(bv) * dir;
        case 'sessions':
          av = a.weekly.sessions; bv = b.weekly.sessions; break;
        case 'students':
          av = a.weekly.students; bv = b.weekly.students; break;
        case 'days':
          av = a.weekly.activeDays; bv = b.weekly.activeDays; break;
        case 'utilization':
          av = a.weekly.utilization; bv = b.weekly.utilization; break;
        case 'avgGroup':
          av = a.weekly.avgGroupSize; bv = b.weekly.avgGroupSize; break;
        case 'hours':
        default:
          av = a.weekly.hours; bv = b.weekly.hours;
      }
      return (av - bv) * dir;
    });
    return arr;
  }, [filtered, sortBy, sortDir, instructorTagMap]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Heatmap max — used to scale per-day bars/colors consistently
  const heatmapMax = useMemo(() => {
    let max = 0;
    for (const r of report) {
      for (const d of DAY_NAMES) {
        if (r.byDay[d].hours > max) max = r.byDay[d].hours;
      }
    }
    return max;
  }, [report]);

  // Aggregate parser-warning samples so we can flag bad time strings
  const parserWarnings = useMemo(() => {
    const samples = [];
    let total = 0;
    for (const r of report) {
      if (r.weekly.unparsedCount > 0) {
        total += r.weekly.unparsedCount;
        for (const s of r.weekly.unparsedSamples) {
          if (samples.length < 5) {
            samples.push({ teacher: r.teacher, ...s });
          }
        }
      }
    }
    return { total, samples };
  }, [report]);

  /**
   * Build a workload report scoped to a single branch (for snapshot saves
   * when the user has "All Branches" selected we want one doc per branch).
   * Applies the same profile-location filter as the live view so a snapshot
   * for "Branch X" only contains instructors whose profile lives there,
   * and includes profile-only instructors as zero-hour "Idle" rows.
   *
   * Display-name precedence matches the live view: nickname → fullname →
   * email-prefix.
   */
  const buildReportForBranch = useCallback((branchName) => {
    const scoped = overallClasses.filter((c) => c.branchName === branchName);
    const built = buildWorkloadReport(scoped, { disabledInstructors });

    // Inject idle rows for profile-only instructors who belong to this branch.
    const existing = new Set(built.map((r) => r.teacher));
    for (const profile of instructorProfiles) {
      const candidates = [
        profile.nickname,
        profile.fullname,
        profile.id ? profile.id.split('@')[0] : null,
      ].filter(Boolean);
      if (candidates.length === 0) continue;
      const alreadyKnown = candidates.some((c) => existing.has(c));
      if (alreadyKnown) continue;

      const displayName = candidates[0];
      if (disabledInstructors && disabledInstructors.has(displayName)) continue;

      const loc = profile.location;
      if (loc !== branchName && loc !== 'All Branches') continue;

      built.push(buildIdleWorkloadRow(displayName));
      candidates.forEach((c) => existing.add(c));
    }

    return built.filter((r) => {
      const profileLoc = profileLocationByName.get(r.teacher);
      if (profileLoc) {
        return profileLoc === branchName || profileLoc === 'All Branches';
      }
      return true;
    });
  }, [overallClasses, disabledInstructors, profileLocationByName, instructorProfiles]);

  /** Save today's snapshot for ALL enabled branches (one doc per branch). */
  const handleSaveSnapshot = useCallback(async () => {
    if (isSaving) return;
    if (!enabledBranches || enabledBranches.length === 0) {
      showToast({
        title: 'No branches to snapshot',
        message: 'Enable at least one branch in Admin Settings.',
        variant: 'warning',
        duration: 5000,
      });
      return;
    }

    setIsSaving(true);
    const dateKey = todayKey();
    const targets = enabledBranches.map((b) => b.name);

    try {
      // Confirm overwrite if any of the targets already have a snapshot for today
      const existingChecks = await Promise.all(
        targets.map((b) => snapshotExists(b, dateKey).then((exists) => ({ b, exists })))
      );
      const alreadySaved = existingChecks.filter((c) => c.exists).map((c) => c.b);
      if (alreadySaved.length > 0) {
        const ok = window.confirm(
          `A snapshot for ${dateKey} already exists for: ${alreadySaved.join(', ')}.\n\nOverwrite with current data?`
        );
        if (!ok) {
          setIsSaving(false);
          return;
        }
      }

      let savedCount = 0;
      let totalRows = 0;
      let skippedEmpty = 0;
      for (const branch of targets) {
        const branchReport = buildReportForBranch(branch);
        if (branchReport.length === 0) {
          // No classes for this branch — skip rather than save an empty doc
          skippedEmpty++;
          continue;
        }
        const result = await saveSnapshot({
          branch,
          report: branchReport,
          instructorTagMap,
          dateKey,
          capturedBy: user?.email || null,
        });
        savedCount++;
        totalRows += result.count;
      }

      // Cleanup beyond 90 days (fire-and-forget)
      cleanupOldSnapshots().catch(() => {});

      const msgParts = [`${savedCount} branch${savedCount === 1 ? '' : 'es'}`, `${totalRows} row${totalRows === 1 ? '' : 's'}`, dateKey];
      if (skippedEmpty > 0) msgParts.push(`${skippedEmpty} skipped (no data)`);

      showToast({
        title: savedCount > 0 ? 'Snapshot saved' : 'Nothing saved',
        message: msgParts.join(' · '),
        variant: savedCount > 0 ? 'success' : 'warning',
        duration: 6000,
      });

      // Refresh history list
      loadHistory();
    } catch (err) {
      console.error('Snapshot save failed:', err);
      showToast({
        title: 'Snapshot failed',
        message: err.message || 'Unable to save workload snapshot',
        variant: 'error',
        duration: 8000,
      });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, enabledBranches, instructorTagMap, user, buildReportForBranch, showToast]);

  /**
   * Load history list across ALL branches (we filter client-side in the
   * history panel so the user can switch branches without refetching).
   */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      // Pass null branch to fetch every branch's snapshots within retention
      const list = await listBranchSnapshots(null, RETENTION_DAYS);
      setSnapshots(list);
    } catch (err) {
      console.error('History load failed:', err);
      showToast({
        title: 'Failed to load history',
        message: err.message || 'Unknown error',
        variant: 'error',
        duration: 6000,
      });
    } finally {
      setHistoryLoading(false);
    }
  }, [showToast]);

  // History branch filter (independent from the page-level branch filter so
  // users can compare past records without changing the live view).
  const [historyBranchFilter, setHistoryBranchFilter] = useState('all');

  // Auto-load history once on mount
  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshots scoped to the history-side branch filter
  const filteredSnapshots = useMemo(() => {
    if (historyBranchFilter === 'all') return snapshots;
    return snapshots.filter((s) => s.branch === historyBranchFilter);
  }, [snapshots, historyBranchFilter]);

  // Selected snapshot — when "All Branches" is selected we may have multiple
  // for the same date; keep them all so the table can stack them.
  const selectedSnapshots = useMemo(
    () => filteredSnapshots.filter((s) => s.date === selectedDate),
    [filteredSnapshots, selectedDate]
  );

  // Distinct dates for the strip — when "All", a date may be backed by
  // multiple branch docs; keep only one chip per date.
  const distinctDates = useMemo(() => {
    const seen = new Map();
    for (const s of filteredSnapshots) {
      if (!seen.has(s.date)) seen.set(s.date, s.date);
    }
    return Array.from(seen.keys()).sort();
  }, [filteredSnapshots]);

  // Trend instructor branch filter (independent from the snapshot branch filter)
  const [trendBranchTag, setTrendBranchTag] = useState('all');

  // Trend dataset: combine snapshot rows by date for the chosen instructor
  // (or all instructors). Optionally narrow to a single branch so the
  // numbers reflect only what was taught at that branch.
  const trendData = useMemo(() => {
    // Pick which snapshots feed the trend math:
    //  - "all" → every loaded snapshot
    //  - <branch name> → only snapshots from that branch
    const scope = trendBranchTag === 'all'
      ? filteredSnapshots
      : filteredSnapshots.filter((s) => s.branch === trendBranchTag);

    // Group snapshots by date so we can sum across branches if needed.
    const dateBuckets = new Map(); // date -> Map<teacher, {hours, sessions}>
    for (const s of scope) {
      if (!dateBuckets.has(s.date)) dateBuckets.set(s.date, new Map());
      const dayBucket = dateBuckets.get(s.date);
      for (const r of (s.rows || [])) {
        const prev = dayBucket.get(r.teacher) || { hours: 0, sessions: 0 };
        dayBucket.set(r.teacher, {
          hours: prev.hours + (r.hours || 0),
          sessions: prev.sessions + (r.sessions || 0),
        });
      }
    }

    const dates = Array.from(dateBuckets.keys()).sort();
    return { dates, dateBuckets };
  }, [filteredSnapshots, trendBranchTag]);

  // List of every instructor seen in the filtered snapshots,
  // along with the branches they actually taught at and their last-known
  // profile branch tag (used as a fallback display label).
  const instructorsInHistory = useMemo(() => {
    const map = new Map(); // teacher -> { branchTag, taughtAt: Set<branch> }
    filteredSnapshots.forEach((s) => (s.rows || []).forEach((r) => {
      if (!map.has(r.teacher)) {
        map.set(r.teacher, { branchTag: r.branchTag || null, taughtAt: new Set() });
      }
      const entry = map.get(r.teacher);
      if (r.branchTag && !entry.branchTag) entry.branchTag = r.branchTag;
      if (s.branch) entry.taughtAt.add(s.branch);
    }));
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([teacher, info]) => ({
        teacher,
        branchTag: info.branchTag,
        taughtAt: Array.from(info.taughtAt),
      }));
  }, [filteredSnapshots]);

  // Distinct branches that have snapshots loaded — these drive the trend
  // branch dropdown. Filtering by one of these means "show instructors who
  // actually appeared in that branch's snapshots", which is what users
  // expect when they say e.g. "Default Branch teachers".
  const historyBranchTags = useMemo(() => {
    const set = new Set();
    filteredSnapshots.forEach((s) => {
      if (s.branch) set.add(s.branch);
    });
    return Array.from(set).sort();
  }, [filteredSnapshots]);

  // Apply the branch filter on top of the instructor list:
  // include any instructor who taught at the selected branch in any loaded snapshot.
  const visibleTrendInstructors = useMemo(() => {
    if (trendBranchTag === 'all') return instructorsInHistory;
    return instructorsInHistory.filter((i) => i.taughtAt.includes(trendBranchTag));
  }, [instructorsInHistory, trendBranchTag]);

  const visibleTrendInstructorNames = useMemo(
    () => visibleTrendInstructors.map((i) => i.teacher),
    [visibleTrendInstructors]
  );

  // Single-instructor series (used when trendInstructor is a real name)
  const trendSeries = useMemo(() => {
    if (!trendInstructor || trendInstructor === 'all') return [];
    return trendData.dates.map((date) => {
      const e = trendData.dateBuckets.get(date)?.get(trendInstructor) || { hours: 0, sessions: 0 };
      return { date, hours: e.hours, sessions: e.sessions };
    });
  }, [trendInstructor, trendData]);

  const trendMax = useMemo(() => {
    let m = 0;
    for (const p of trendSeries) if (p.hours > m) m = p.hours;
    return m;
  }, [trendSeries]);

  // All-instructors trend: an array of {teacher, series, total} sorted by total desc
  const allInstructorsTrend = useMemo(() => {
    if (trendInstructor !== 'all') return [];
    const out = [];
    for (const { teacher, branchTag } of visibleTrendInstructors) {
      const series = trendData.dates.map((date) => {
        const e = trendData.dateBuckets.get(date)?.get(teacher) || { hours: 0, sessions: 0 };
        return { date, hours: e.hours, sessions: e.sessions };
      });
      const total = series.reduce((s, p) => s + p.hours, 0);
      out.push({ teacher, branchTag, series, total });
    }
    out.sort((a, b) => b.total - a.total);
    return out;
  }, [trendInstructor, visibleTrendInstructors, trendData]);

  const allInstructorsTrendMax = useMemo(() => {
    let m = 0;
    for (const row of allInstructorsTrend) {
      for (const p of row.series) if (p.hours > m) m = p.hours;
    }
    return m;
  }, [allInstructorsTrend]);

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      // Sensible default direction per column
      setSortDir(key === 'name' || key === 'branch' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const toggleExpand = (teacher) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(teacher)) next.delete(teacher);
      else next.add(teacher);
      return next;
    });
  };

  const onLeaveDaysFor = (teacher) =>
    new Set(leaveList.filter((l) => l.name === teacher).map((l) => l.day));

  const sortIndicator = (key) => {
    if (sortBy !== key) return null;
    return <span style={{ marginLeft: '0.25rem', fontSize: '0.65rem' }}>{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  const headerCellStyle = {
    padding: '0.7rem 0.75rem',
    textAlign: 'left',
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-muted)',
    background: 'var(--bg-color)',
    borderBottom: '2px solid var(--border-color)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  };

  const headerCellCenterStyle = { ...headerCellStyle, textAlign: 'center' };

  const cellStyle = {
    padding: '0.65rem 0.75rem',
    fontSize: '0.85rem',
    borderBottom: '1px solid var(--border-color)',
    verticalAlign: 'middle',
  };

  const cellCenterStyle = { ...cellStyle, textAlign: 'center' };

  return (
    <section className="dashboard-view active" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* KPI strip */}
      <div className="kpi-grid">
        <KpiCard
          icon={<Users size={22} />}
          title="Active Instructors"
          value={summary.instructors}
          variant="blue"
        />
        <KpiCard
          icon={<Clock size={22} />}
          title="Total Teaching Hours"
          value={formatHoursMinutes(summary.totalHours)}
          variant="green"
        />
        <KpiCard
          icon={<Activity size={22} />}
          title="Avg Hours / Instructor"
          value={formatHoursMinutes(summary.avgHours)}
          variant="orange"
        />
        <KpiCard
          icon={<AlertOctagon size={22} />}
          title="Overloaded"
          value={`${summary.overloadedCount} / ${summary.instructors}`}
          variant="red"
        />
      </div>

      {/* Top / bottom load callouts */}
      {report.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>          <div className="panel" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertOctagon size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Highest Load
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
                {summary.maxTeacher} — {formatHoursMinutes(summary.maxHours)}
              </div>
            </div>
          </div>
          <div className="panel" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--primary-blue-light)', color: 'var(--primary-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Minus size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Lightest Load
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
                {summary.minTeacher} — {formatHoursMinutes(summary.minHours)}
              </div>
            </div>
          </div>
        </div>
      )}

      {parserWarnings.total > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.6rem',
            padding: '0.75rem 1rem',
            background: 'var(--warning-bg)',
            color: 'var(--warning)',
            border: '1px solid var(--warning-border)',
            borderRadius: '8px',
            fontSize: '0.82rem',
          }}
        >
          <AlertOctagon size={16} style={{ marginTop: '2px', flexShrink: 0 }} />
          <div>
            <strong>{parserWarnings.total}</strong> class row{parserWarnings.total === 1 ? '' : 's'} could not be parsed (invalid time format) and were excluded from workload totals.
            {parserWarnings.samples.length > 0 && (
              <div style={{ marginTop: '0.3rem', color: 'var(--text-secondary)' }}>
                Examples:&nbsp;
                {parserWarnings.samples.map((s, i) => (
                  <span key={i} style={{ fontFamily: 'monospace', marginRight: '0.6rem' }}>
                    {s.teacher} · {s.day} · &quot;{s.time}&quot;
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Workload table */}
      <div className="panel">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div className="panel-header-left">
            <h2>Instructor Workload</h2>
            <span className="subtext">
              Branch: <strong>{branchFilter === 'all' ? 'All Branches' : branchFilter}</strong>
              {' '}· Window {formatMinutesToClock(WORKING_WINDOW_START_MIN)}–{formatMinutesToClock(WORKING_WINDOW_END_MIN)}
              {' '}· Healthy {thresholds.weeklyAmber}–{thresholds.weeklyRed} h/week
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleSaveSnapshot}
              disabled={isSaving || (enabledBranches?.length || 0) === 0}
              title="Save today's workload for every enabled branch (one history entry per branch)"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.45rem 0.85rem',
                background: isSaving ? 'var(--bg-color)' : 'var(--primary-blue)',
                color: isSaving ? 'var(--text-muted)' : 'white',
                border: '1px solid var(--primary-blue)',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 500,
                cursor: isSaving || (enabledBranches?.length || 0) === 0 ? 'not-allowed' : 'pointer',
                opacity: (enabledBranches?.length || 0) === 0 ? 0.5 : 1,
              }}
            >
              <Save size={14} />
              {isSaving ? 'Saving...' : 'Save Snapshot'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <MapPin size={14} style={{ color: 'var(--text-muted)' }} />
              <select
                value={branchFilter}
                onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}
                style={{
                  padding: '0.4rem 0.6rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  background: 'white',
                  cursor: 'pointer',
                }}
              >
                <option value="all">All Branches</option>
                {(enabledBranches || []).map((b) => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>
            <div style={{ position: 'relative' }}>
              <Search
                size={14}
                style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search instructors..."
                style={{
                  padding: '0.4rem 0.7rem 0.4rem 2rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  width: '220px',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.3rem' }}>
              {[
                { id: 'all', label: 'All', tip: 'Show every instructor regardless of workload.' },
                { id: 'overload', label: 'Overload', tip: `More than ${thresholds.weeklyRed} hours of teaching per week. Risk of burnout — consider redistributing classes.` },
                { id: 'normal', label: 'Healthy', tip: `Between ${thresholds.weeklyAmber} and ${thresholds.weeklyRed} hours per week. The recommended teaching load.` },
                { id: 'low', label: 'Light', tip: `Less than ${thresholds.weeklyAmber} hours per week but still teaching. Has capacity for more classes or trials.` },
                { id: 'idle', label: 'Idle', tip: 'No classes scheduled this week.' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => { setStatusFilter(opt.id); setPage(1); }}
                  title={opt.tip}
                  aria-label={opt.tip}
                  style={{
                    padding: '0.3rem 0.65rem',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    borderRadius: '6px',
                    border: statusFilter === opt.id ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                    background: statusFilter === opt.id ? 'var(--primary-blue-light)' : 'transparent',
                    fontWeight: statusFilter === opt.id ? 600 : 400,
                    color: statusFilter === opt.id ? 'var(--primary-blue)' : 'var(--text-secondary)',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="panel-body" style={{ padding: 0 }}>
          {report.length === 0 ? (
            <div className="empty-state" style={{ padding: '2.5rem 1.5rem' }}>
              <BarChart3 size={36} />
              <p>Sync the schedule to compute instructor workload.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...headerCellStyle, width: '32px', cursor: 'default' }} />
                    <th style={headerCellStyle} onClick={() => handleSort('name')}>
                      Instructor{sortIndicator('name')}
                    </th>
                    <th style={headerCellStyle} onClick={() => handleSort('branch')}>
                      Branch{sortIndicator('branch')}
                    </th>
                    <th style={headerCellStyle} onClick={() => handleSort('hours')}>
                      Weekly Hours{sortIndicator('hours')}
                    </th>
                    <th style={headerCellCenterStyle} onClick={() => handleSort('sessions')}>
                      Sessions{sortIndicator('sessions')}
                    </th>
                    <th style={headerCellCenterStyle} onClick={() => handleSort('students')}>
                      Students{sortIndicator('students')}
                    </th>
                    <th style={headerCellCenterStyle} onClick={() => handleSort('avgGroup')}>
                      Avg Group{sortIndicator('avgGroup')}
                    </th>
                    <th style={headerCellCenterStyle} onClick={() => handleSort('days')}>
                      Active Days{sortIndicator('days')}
                    </th>
                    <th style={headerCellCenterStyle} onClick={() => handleSort('utilization')}>
                      Utilization{sortIndicator('utilization')}
                    </th>
                    <th style={{ ...headerCellCenterStyle, cursor: 'default' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan="10" style={{ ...cellStyle, textAlign: 'center', color: 'var(--text-muted)' }}>
                        No instructors match your filter.
                      </td>
                    </tr>
                  ) : paged.map((r) => {
                    const isOpen = expanded.has(r.teacher);
                    const cls = classifyWeekly(r.weekly.hours, thresholds);
                    const peakMax = Math.max(summary.maxHours, thresholds.weeklyRed);
                    const onLeave = onLeaveDaysFor(r.teacher);
                    const branchTag = instructorTagMap.get(r.teacher);
                    return (
                      <FragmentRow
                        key={r.teacher}
                        row={r}
                        cellStyle={cellStyle}
                        cellCenterStyle={cellCenterStyle}
                        cls={cls}
                        peakMax={peakMax}
                        isOpen={isOpen}
                        onToggle={() => toggleExpand(r.teacher)}
                        heatmapMax={heatmapMax}
                        thresholds={thresholds}
                        onLeave={onLeave}
                        branchTag={branchTag}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      </div>

      {/* Heatmap */}
      {report.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-header-left">
              <h2>Daily Workload Heatmap</h2>
              <span className="subtext">Hours per day, per instructor. Red cells exceed {thresholds.dailyRed}h.</span>
            </div>
            <Legend thresholds={thresholds} />
          </div>
          <div className="panel-body" style={{ overflowX: 'auto' }}>
            <Heatmap
              report={sorted.slice(0, 25)}
              max={heatmapMax}
              thresholds={thresholds}
              onCellClick={(teacher, day, dayData) => setHeatmapDetail({ teacher, day, dayData })}
            />
            {sorted.length > 25 && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                Showing top 25 by current sort. Refine the filter above to see more.
              </p>
            )}
          </div>
        </div>
      )}

      {heatmapDetail && (
        <HeatmapDetailModal
          teacher={heatmapDetail.teacher}
          day={heatmapDetail.day}
          dayData={heatmapDetail.dayData}
          onClose={() => setHeatmapDetail(null)}
        />
      )}

      {/* History card */}
      <HistoryPanel
        allBranches={enabledBranches || []}
        historyBranchFilter={historyBranchFilter}
        onChangeHistoryBranchFilter={setHistoryBranchFilter}
        snapshots={filteredSnapshots}
        distinctDates={distinctDates}
        loading={historyLoading}
        onReload={loadHistory}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        selectedSnapshots={selectedSnapshots}
        instructorsInHistory={instructorsInHistory}
        visibleTrendInstructors={visibleTrendInstructorNames}
        historyBranchTags={historyBranchTags}
        trendBranchTag={trendBranchTag}
        onChangeTrendBranchTag={setTrendBranchTag}
        trendInstructor={trendInstructor}
        onSelectTrendInstructor={setTrendInstructor}
        trendSeries={trendSeries}
        trendMax={trendMax}
        allInstructorsTrend={allInstructorsTrend}
        allInstructorsTrendMax={allInstructorsTrendMax}
        thresholds={thresholds}
      />
    </section>
  );
}

function FragmentRow({ row, cellStyle, cellCenterStyle, cls, peakMax, isOpen, onToggle, heatmapMax, thresholds, onLeave, branchTag }) {
  return (
    <>
      <tr style={{ background: isOpen ? 'var(--primary-blue-light)' : undefined, transition: 'background 0.15s' }}>
        <td style={{ ...cellStyle, textAlign: 'center', cursor: 'pointer' }} onClick={onToggle}>
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </td>
        <td style={{ ...cellStyle, fontWeight: 600 }}>
          <button
            type="button"
            onClick={onToggle}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', textAlign: 'left' }}
          >
            {row.teacher}
          </button>
          {row.weekly.busiestDay && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Busiest: {row.weekly.busiestDay} ({formatHoursMinutes(row.weekly.busiestDayHours)})
            </div>
          )}
        </td>
        <td style={cellStyle}>
          {branchTag ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.18rem 0.55rem',
                borderRadius: '99px',
                fontSize: '0.72rem',
                fontWeight: 500,
                background: branchTag === 'All Branches' ? 'var(--primary-blue-light)' : 'var(--bg-color)',
                color: branchTag === 'All Branches' ? 'var(--primary-blue)' : 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                whiteSpace: 'nowrap',
              }}
            >
              <MapPin size={10} />
              {branchTag}
            </span>
          ) : (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
          )}
        </td>
        <td style={{ ...cellStyle, minWidth: '160px' }}>
          <HourBar hours={row.weekly.hours} max={peakMax} variant={cls} />
        </td>
        <td style={cellCenterStyle}>{row.weekly.sessions}</td>
        <td style={cellCenterStyle}>{row.weekly.students}</td>
        <td style={cellCenterStyle}>{row.weekly.avgGroupSize.toFixed(1)}</td>
        <td style={cellCenterStyle}>{row.weekly.activeDays} / {DAY_NAMES.length}</td>
        <td style={cellCenterStyle}>{row.weekly.utilization.toFixed(0)}%</td>
        <td style={cellCenterStyle}><StatusPill variant={cls} thresholds={thresholds} /></td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan="10" style={{ background: 'var(--bg-color)', padding: 0 }}>
            <PerDayPanel row={row} thresholds={thresholds} onLeave={onLeave} max={heatmapMax} />
          </td>
        </tr>
      )}
    </>
  );
}

function PerDayPanel({ row, thresholds, onLeave, max }) {
  const overloadDays = DAY_NAMES.filter((d) => row.byDay[d].hours > thresholds.dailyRed);
  return (
    <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${DAY_NAMES.length}, 1fr)`, gap: '0.5rem' }}>
        {DAY_NAMES.map((day) => {
          const d = row.byDay[day];
          const variant = classifyDaily(d.hours, thresholds);
          const isLeave = onLeave.has(day);
          return (
            <div
              key={day}
              style={{
                padding: '0.6rem 0.7rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--panel-bg)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                  {day.slice(0, 3)}
                </span>
                {isLeave && (
                  <span style={{ fontSize: '0.6rem', color: 'var(--warning)', fontWeight: 600 }}>LEAVE</span>
                )}
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: STATUS_VARIANT[variant].fg }}>
                {formatHoursMinutes(d.hours)}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {d.sessions} session{d.sessions === 1 ? '' : 's'} · {d.students} student{d.students === 1 ? '' : 's'}
              </div>
              {d.busiestStartMin !== null && (
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {formatMinutesToClock(d.busiestStartMin)} – {formatMinutesToClock(d.busiestEndMin)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
        <div>Avg session: <strong>{Math.round(row.weekly.avgSessionMin)}m</strong></div>
        <div>Avg group size: <strong>{row.weekly.avgGroupSize.toFixed(1)} students</strong></div>
        <div>Avg gap between classes: <strong>{Math.round(row.weekly.avgGapMin)}m</strong></div>
        <div>Total enrolments (sum across sessions): <strong>{row.weekly.studentEnrolments}</strong></div>
        {overloadDays.length > 0 && (
          <div style={{ color: 'var(--danger)', fontWeight: 600 }}>
            Overloaded: {overloadDays.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

function Heatmap({ report, max, thresholds, onCellClick }) {
  const rowHeight = 28;
  const labelWidth = 160;

  const cellColor = (hours) => {
    if (hours <= 0) return 'var(--bg-color)';
    if (hours > thresholds.dailyRed) return 'rgba(239, 68, 68, 0.85)';
    if (hours > thresholds.dailyAmber) return 'rgba(245, 158, 11, 0.75)';
    // Light blue scale below amber
    const intensity = max > 0 ? Math.min(1, hours / Math.max(thresholds.dailyAmber, 1)) : 0;
    const opacity = 0.25 + intensity * 0.55;
    return `rgba(79, 70, 229, ${opacity})`;
  };

  return (
    <div style={{ minWidth: `${labelWidth + DAY_NAMES.length * 60}px` }}>
      {/* Header row */}
      <div style={{ display: 'grid', gridTemplateColumns: `${labelWidth}px repeat(${DAY_NAMES.length}, 1fr)`, gap: '4px', marginBottom: '4px' }}>
        <div />
        {DAY_NAMES.map((d) => (
          <div key={d} style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {d.slice(0, 3)}
          </div>
        ))}
      </div>

      {report.map((r) => (
        <div
          key={r.teacher}
          style={{
            display: 'grid',
            gridTemplateColumns: `${labelWidth}px repeat(${DAY_NAMES.length}, 1fr)`,
            gap: '4px',
            marginBottom: '4px',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: '0.78rem',
              color: 'var(--text-main)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              paddingRight: '0.5rem',
            }}
            title={r.teacher}
          >
            {r.teacher}
          </div>
          {DAY_NAMES.map((d) => {
            const dayData = r.byDay[d];
            const hrs = dayData.hours;
            const hasData = hrs > 0;
            const handleClick = hasData && onCellClick
              ? () => onCellClick(r.teacher, d, dayData)
              : undefined;
            return (
              <button
                key={d}
                type="button"
                onClick={handleClick}
                disabled={!hasData}
                title={hasData
                  ? `${r.teacher} · ${d}: ${formatHoursMinutes(hrs)} (${dayData.sessions} sessions) — click for details`
                  : `${r.teacher} · ${d}: no class`}
                style={{
                  height: rowHeight,
                  borderRadius: '4px',
                  background: cellColor(hrs),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: hrs > thresholds.dailyAmber ? 'white' : (hrs > 0 ? 'white' : 'var(--text-muted)'),
                  border: 'none',
                  padding: 0,
                  cursor: hasData ? 'pointer' : 'default',
                  transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                }}
                onMouseEnter={(e) => {
                  if (!hasData) return;
                  e.currentTarget.style.transform = 'scale(1.04)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.18)';
                }}
                onMouseLeave={(e) => {
                  if (!hasData) return;
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {hrs > 0 ? formatHoursMinutes(hrs) : '·'}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Legend({ thresholds }) {
  const items = [
    { color: 'var(--bg-color)', label: 'No class' },
    { color: 'rgba(79, 70, 229, 0.55)', label: `< ${thresholds.dailyAmber}h` },
    { color: 'rgba(245, 158, 11, 0.75)', label: `${thresholds.dailyAmber}–${thresholds.dailyRed}h` },
    { color: 'rgba(239, 68, 68, 0.85)', label: `> ${thresholds.dailyRed}h` },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
      {items.map((i) => (
        <div key={i.label} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
          <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: i.color, border: '1px solid var(--border-color)' }} />
          {i.label}
        </div>
      ))}
    </div>
  );
}

/**
 * Heatmap drill-down modal — opened by clicking a filled cell.
 * Shows every session that instructor teaches on that day, including time
 * slot, program / lesson code, branch, and the student list. Lets the user
 * answer "what did Sugi do at 4h on Tuesday?" without leaving the page.
 */
function HeatmapDetailModal({ teacher, day, dayData, onClose }) {
  const sessions = (dayData?.sessionList || []).slice().sort((a, b) => a.start - b.start);

  // Close on ESC for keyboard users
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${teacher} schedule on ${day}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--panel-bg, white)',
          borderRadius: '12px',
          maxWidth: '720px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
          border: '1px solid var(--border-color)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            position: 'sticky',
            top: 0,
            background: 'var(--panel-bg, white)',
            zIndex: 1,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {teacher} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {day}</span>
            </h3>
            <div style={{ marginTop: '0.3rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <span><strong>{formatHoursMinutes(dayData.hours)}</strong> teaching</span>
              <span><strong>{dayData.sessions}</strong> session{dayData.sessions === 1 ? '' : 's'}</span>
              <span><strong>{dayData.students}</strong> student{dayData.students === 1 ? '' : 's'}</span>
              {dayData.busiestStartMin !== null && (
                <span>
                  Window: {formatMinutesToClock(dayData.busiestStartMin)} – {formatMinutesToClock(dayData.busiestEndMin)}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '0.25rem',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-color)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1rem 1.5rem 1.25rem 1.5rem' }}>
          {sessions.length === 0 ? (
            <div style={{ padding: '1.5rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
              No sessions recorded for this day.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {sessions.map((s, i) => (
                <SessionRow key={`${s.time}-${i}`} session={s} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A single time-slot row inside the heatmap detail modal. */
function SessionRow({ session }) {
  const programLabel = session.programs?.length > 0
    ? session.programs.join(', ')
    : '—';
  const branchLabel = session.branches?.length > 0
    ? session.branches.join(' · ')
    : null;

  return (
    <div
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: '10px',
        padding: '0.75rem 0.9rem',
        background: 'var(--panel-bg, white)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {session.time}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {Math.round(session.durationMin)}m · {session.students} student{session.students === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-end' }}>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--primary-blue)',
              background: 'var(--primary-blue-light)',
              padding: '0.2rem 0.55rem',
              borderRadius: '99px',
            }}
          >
            {programLabel}
          </span>
          {branchLabel && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
              <MapPin size={10} /> {branchLabel}
            </span>
          )}
        </div>
      </div>

      {/* Student detail rows */}
      {(session.studentDetails?.length || 0) > 0 && (
        <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {session.studentDetails.map((sd, idx) => (
            <span
              key={`${sd.student}-${idx}`}
              title={[sd.fullProgram, sd.remarks].filter(Boolean).join(' · ') || undefined}
              style={{
                fontSize: '0.74rem',
                padding: '0.18rem 0.55rem',
                borderRadius: '6px',
                background: sd.notArranged ? '#fef3c7' : 'var(--bg-color)',
                color: sd.notArranged ? '#92400e' : 'var(--text-secondary)',
                border: sd.notArranged ? '1px dashed #f59e0b' : '1px solid var(--border-color)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              {sd.student || '—'}
              {sd.lessonDetail && sd.lessonDetail !== programLabel && (
                <span style={{ fontWeight: 600, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  {sd.lessonDetail}
                </span>
              )}
              {sd.notArranged && (
                <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#d97706', background: '#fde68a', padding: '0.05rem 0.3rem', borderRadius: '3px' }}>
                  izin
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── History card ─────────────────────────────────────────────── */

function HistoryPanel({
  allBranches,
  historyBranchFilter,
  onChangeHistoryBranchFilter,
  snapshots,
  distinctDates,
  loading,
  onReload,
  selectedDate,
  onSelectDate,
  selectedSnapshots,
  instructorsInHistory,
  visibleTrendInstructors,
  historyBranchTags,
  trendBranchTag,
  onChangeTrendBranchTag,
  trendInstructor,
  onSelectTrendInstructor,
  trendSeries,
  trendMax,
  allInstructorsTrend,
  allInstructorsTrendMax,
  thresholds,
}) {
  const oldestDate = distinctDates[0];
  const newestDate = distinctDates[distinctDates.length - 1];

  // Auto-pick the first instructor when nothing selected yet, and reset
  // when the active filter would hide the current selection.
  useEffect(() => {
    if (visibleTrendInstructors.length === 0) return;
    if (!trendInstructor || (trendInstructor !== 'all' && !visibleTrendInstructors.includes(trendInstructor))) {
      onSelectTrendInstructor(visibleTrendInstructors[0]);
    }
  }, [trendInstructor, visibleTrendInstructors, onSelectTrendInstructor]);

  return (
    <div className="panel">
      <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div className="panel-header-left">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <History size={18} /> Workload History
          </h2>
          <span className="subtext">
            Last {RETENTION_DAYS} days
            {snapshots.length > 0 && (
              <> · {distinctDates.length} day{distinctDates.length === 1 ? '' : 's'} ({oldestDate} → {newestDate})</>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <MapPin size={14} style={{ color: 'var(--text-muted)' }} />
            <select
              value={historyBranchFilter}
              onChange={(e) => onChangeHistoryBranchFilter(e.target.value)}
              style={{
                padding: '0.4rem 0.6rem',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                background: 'white',
                cursor: 'pointer',
              }}
              title="Filter saved snapshots by branch"
            >
              <option value="all">All Branches</option>
              {allBranches.map((b) => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <CalendarIcon size={14} style={{ color: 'var(--text-muted)' }} />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onSelectDate(e.target.value)}
              style={{
                padding: '0.4rem 0.6rem',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            />
          </div>
          <button
            type="button"
            onClick={onReload}
            disabled={loading}
            style={{
              padding: '0.4rem 0.7rem',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
              cursor: loading ? 'wait' : 'pointer',
            }}
            title="Reload history"
          >
            {loading ? 'Loading...' : 'Reload'}
          </button>
        </div>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {loading && snapshots.length === 0 ? (
          <div className="empty-state" style={{ padding: '1.5rem', color: 'var(--text-muted)' }}>
            Loading snapshots...
          </div>
        ) : snapshots.length === 0 ? (
          <div className="empty-state" style={{ padding: '1.5rem' }}>
            <History size={28} />
            <p>No snapshots saved yet{historyBranchFilter !== 'all' ? ` for ${historyBranchFilter}` : ''}.</p>
            <span className="subtext">Click <strong>Save Snapshot</strong> at the top of the page to capture today.</span>
          </div>
        ) : (
          <>
            <SnapshotDateStrip
              dates={distinctDates}
              selectedDate={selectedDate}
              onSelectDate={onSelectDate}
            />
            {selectedSnapshots.length > 0 ? (
              <SnapshotTable
                snapshots={selectedSnapshots}
                showBranch={historyBranchFilter === 'all'}
                thresholds={thresholds}
              />
            ) : (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
                No snapshot for {selectedDate}. Pick another date from the strip above.
              </div>
            )}

            {instructorsInHistory.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <TrendingUp size={16} /> Instructor Trend
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {historyBranchTags.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <MapPin size={14} style={{ color: 'var(--text-muted)' }} />
                        <select
                          value={trendBranchTag}
                          onChange={(e) => onChangeTrendBranchTag(e.target.value)}
                          title="Show only instructors who taught at this branch"
                          style={{
                            padding: '0.4rem 0.6rem',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            fontSize: '0.85rem',
                            background: 'white',
                            cursor: 'pointer',
                            minWidth: '160px',
                          }}
                        >
                          <option value="all">All Branches</option>
                          {historyBranchTags.map((tag) => (
                            <option key={tag} value={tag}>{tag}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <select
                      value={trendInstructor}
                      onChange={(e) => onSelectTrendInstructor(e.target.value)}
                      style={{
                        padding: '0.4rem 0.6rem',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        background: 'white',
                        cursor: 'pointer',
                        minWidth: '200px',
                      }}
                    >
                      <option value="all">All Instructors</option>
                      {visibleTrendInstructors.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {visibleTrendInstructors.length === 0 ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
                    No instructors match this branch tag.
                  </div>
                ) : trendInstructor === 'all' ? (
                  <AllInstructorsTrendChart
                    rows={allInstructorsTrend}
                    max={allInstructorsTrendMax}
                    thresholds={thresholds}
                  />
                ) : (
                  <TrendChart series={trendSeries} max={trendMax} thresholds={thresholds} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Horizontal scrolling strip of distinct snapshot dates — click to jump. */
function SnapshotDateStrip({ dates, selectedDate, onSelectDate }) {
  return (
    <div style={{ display: 'flex', gap: '0.3rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
      {dates.map((d) => {
        const isSelected = d === selectedDate;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelectDate(d)}
            style={{
              flexShrink: 0,
              padding: '0.4rem 0.7rem',
              border: isSelected ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
              background: isSelected ? 'var(--primary-blue-light)' : 'white',
              color: isSelected ? 'var(--primary-blue)' : 'var(--text-secondary)',
              fontWeight: isSelected ? 600 : 400,
              borderRadius: '6px',
              fontSize: '0.78rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Render saved rows for one or more snapshots on the same date.
 * If multiple branches are involved, group the table by branch.
 */
function SnapshotTable({ snapshots, showBranch, thresholds }) {
  const sections = useMemo(() => {
    return snapshots.map((s) => ({
      branch: s.branch,
      rows: [...(s.rows || [])].sort((a, b) => (b.hours || 0) - (a.hours || 0)),
    }));
  }, [snapshots]);

  const overallMax = useMemo(() => {
    let m = 0;
    for (const s of sections) for (const r of s.rows) if ((r.hours || 0) > m) m = r.hours;
    return m;
  }, [sections]);

  const headerStyle = {
    padding: '0.55rem 0.7rem',
    textAlign: 'left',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-muted)',
    background: 'var(--bg-color)',
    borderBottom: '2px solid var(--border-color)',
    whiteSpace: 'nowrap',
  };
  const headerCenter = { ...headerStyle, textAlign: 'center' };
  const cellStyle = {
    padding: '0.5rem 0.7rem',
    fontSize: '0.82rem',
    borderBottom: '1px solid var(--border-color)',
  };
  const cellCenter = { ...cellStyle, textAlign: 'center' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {sections.map((section) => (
        <div key={section.branch} style={{ overflowX: 'auto' }}>
          {showBranch && (
            <div style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              padding: '0.35rem 0.7rem',
              background: 'var(--bg-color)',
              borderRadius: '6px 6px 0 0',
              borderBottom: '1px solid var(--border-color)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}>
              <MapPin size={12} /> {section.branch}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {section.rows.length} instructor{section.rows.length === 1 ? '' : 's'}</span>
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headerStyle}>Instructor</th>
                <th style={headerStyle}>Branch</th>
                <th style={headerStyle}>Hours</th>
                <th style={headerCenter}>Sessions</th>
                <th style={headerCenter}>Students</th>
                <th style={headerCenter}>Avg Group</th>
                <th style={headerCenter}>Active Days</th>
                <th style={headerCenter}>Utilization</th>
                <th style={headerCenter}>Status</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ ...cellStyle, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No rows in this snapshot.
                  </td>
                </tr>
              ) : section.rows.map((r) => {
                const cls = classifyWeekly(r.hours, thresholds);
                return (
                  <tr key={`${section.branch}::${r.teacher}`}>
                    <td style={{ ...cellStyle, fontWeight: 600 }}>{r.teacher}</td>
                    <td style={cellStyle}>
                      {r.branchTag ? (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <MapPin size={10} /> {r.branchTag}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ ...cellStyle, minWidth: '140px' }}>
                      <HourBar hours={r.hours} max={Math.max(overallMax, thresholds.weeklyRed)} variant={cls} />
                    </td>
                    <td style={cellCenter}>{r.sessions}</td>
                    <td style={cellCenter}>{r.students}</td>
                    <td style={cellCenter}>{(r.avgGroupSize || 0).toFixed(1)}</td>
                    <td style={cellCenter}>{r.activeDays} / {DAY_NAMES.length}</td>
                    <td style={cellCenter}>{Math.round(r.utilization || 0)}%</td>
                    <td style={cellCenter}><StatusPill variant={cls} thresholds={thresholds} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** Tiny SVG-free bar chart for an instructor's daily-hours trend. */
function TrendChart({ series, max, thresholds }) {
  if (!series || series.length === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
        No trend data — save more snapshots first.
      </div>
    );
  }

  const ceiling = Math.max(max || 0, thresholds.weeklyRed) || 1;
  const total = series.reduce((s, p) => s + p.hours, 0);
  const avg = total / series.length;
  const peak = series.reduce((best, p) => (p.hours > best.hours ? p : best), series[0]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.78rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <div>Total: <strong>{formatHoursMinutes(total)}</strong> across {series.length} day{series.length === 1 ? '' : 's'}</div>
        <div>Avg: <strong>{formatHoursMinutes(avg)}</strong> / snapshot</div>
        <div>Peak: <strong>{formatHoursMinutes(peak.hours)}</strong> on {peak.date}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '120px', overflowX: 'auto', padding: '0 2px' }}>
        {series.map((p) => {
          const pct = ceiling > 0 ? Math.max(2, (p.hours / ceiling) * 100) : 0;
          const cls = classifyWeekly(p.hours, thresholds);
          const v = STATUS_VARIANT[cls] || STATUS_VARIANT.normal;
          return (
            <div
              key={p.date}
              title={`${p.date}: ${formatHoursMinutes(p.hours)} · ${p.sessions} sessions`}
              style={{
                flex: '0 0 14px',
                height: `${pct}%`,
                minHeight: '2px',
                background: p.hours > 0 ? v.fg : 'var(--border-color)',
                borderRadius: '2px',
                transition: 'height 0.2s',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}


/**
 * All-instructors trend: a vertical bar chart. Each instructor is one
 * column showing total hours across the loaded snapshots. Name labels
 * sit at the bottom (rotated when there are many bars). Hover any bar to
 * see total + peak day. Sorted by total hours descending.
 */
function AllInstructorsTrendChart({ rows, max, thresholds }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
        No trend data — save snapshots first.
      </div>
    );
  }

  const ceiling = Math.max(max || 0, thresholds.weeklyRed) || 1;

  // Aggregate row totals so the y-axis shows real numbers, not per-day max
  const enriched = rows.map((row) => {
    const total = row.total;
    const peak = row.series.reduce(
      (best, p) => (p.hours > best.hours ? p : best),
      row.series[0] || { hours: 0, date: '' }
    );
    return { ...row, totalHours: total, peak };
  });

  const totalCeiling = Math.max(...enriched.map((r) => r.totalHours), thresholds.weeklyRed) || 1;

  // Rotate names when more than 8 bars to avoid overlap
  const rotateLabels = enriched.length > 8;

  // Reasonable bar width: shrink when many bars but keep min readable size
  const barMinWidth = enriched.length > 20 ? 28 : enriched.length > 10 ? 36 : 48;

  // Y-axis ticks (4 segments)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(totalCeiling * t));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.78rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <div>{enriched.length} instructor{enriched.length === 1 ? '' : 's'} · totals across loaded snapshots</div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {/* Y-axis labels */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: `0 0.4rem ${rotateLabels ? '70px' : '36px'} 0`,
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          textAlign: 'right',
          minWidth: '40px',
          height: '260px',
        }}>
          {ticks.slice().reverse().map((t, i) => (
            <span key={i}>{formatHoursMinutes(t)}</span>
          ))}
        </div>

        {/* Chart area — horizontally scrollable when many bars */}
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '6px',
              height: '260px',
              minWidth: '100%',
              borderLeft: '1px solid var(--border-color)',
              borderBottom: '1px solid var(--border-color)',
              paddingLeft: '0.4rem',
              paddingRight: '0.4rem',
              position: 'relative',
            }}
          >
            {/* Reference lines for amber / red thresholds */}
            <ThresholdLine
              percent={1 - (thresholds.weeklyAmber / totalCeiling)}
              color="var(--warning)"
              label={`${thresholds.weeklyAmber}h`}
            />
            <ThresholdLine
              percent={1 - (thresholds.weeklyRed / totalCeiling)}
              color="var(--danger)"
              label={`${thresholds.weeklyRed}h`}
            />

            {enriched.map((row) => {
              const pct = totalCeiling > 0
                ? Math.max(2, (row.totalHours / totalCeiling) * 100)
                : 0;
              const cls = classifyWeekly(row.totalHours, thresholds);
              const v = STATUS_VARIANT[cls] || STATUS_VARIANT.normal;

              return (
                <div
                  key={row.teacher}
                  style={{
                    flex: `0 0 ${barMinWidth}px`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    height: '100%',
                    justifyContent: 'flex-end',
                    position: 'relative',
                  }}
                  title={`${row.teacher}\nTotal: ${formatHoursMinutes(row.totalHours)}\nPeak: ${formatHoursMinutes(row.peak.hours)} on ${row.peak.date}\nDays tracked: ${row.series.length}`}
                >
                  {/* Total label above the bar */}
                  <div style={{
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    color: v.fg,
                    marginBottom: '4px',
                    whiteSpace: 'nowrap',
                  }}>
                    {formatHoursMinutes(row.totalHours)}
                  </div>
                  {/* The bar */}
                  <div
                    style={{
                      width: '100%',
                      height: `${pct}%`,
                      minHeight: '2px',
                      background: row.totalHours > 0 ? v.fg : 'var(--border-color)',
                      borderRadius: '3px 3px 0 0',
                      transition: 'height 0.25s',
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Name labels row — same gap & widths as bars so they line up */}
          <div
            style={{
              display: 'flex',
              gap: '6px',
              paddingLeft: '0.4rem',
              paddingRight: '0.4rem',
              marginTop: '0.4rem',
              minWidth: '100%',
              alignItems: 'flex-start',
            }}
          >
            {enriched.map((row) => (
              <div
                key={`label-${row.teacher}`}
                title={row.teacher}
                style={{
                  flex: `0 0 ${barMinWidth}px`,
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                  ...(rotateLabels
                    ? {
                        transform: 'rotate(-45deg)',
                        transformOrigin: 'top right',
                        height: '60px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        paddingLeft: '0',
                      }
                    : {
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }
                  ),
                }}
              >
                {row.teacher}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dashed horizontal line marking a workload threshold inside the chart. */
function ThresholdLine({ percent, color, label }) {
  if (percent < 0 || percent > 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: `${percent * 100}%`,
        left: 0,
        right: 0,
        borderTop: `1px dashed ${color}`,
        opacity: 0.6,
        pointerEvents: 'none',
      }}
    >
      <span style={{
        position: 'absolute',
        right: '4px',
        top: '-9px',
        fontSize: '0.6rem',
        color,
        background: 'var(--panel-bg)',
        padding: '0 4px',
        fontWeight: 600,
      }}>
        {label}
      </span>
    </div>
  );
}
