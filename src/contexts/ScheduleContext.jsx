'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { buildInstructorMap, isValidTeacherName } from '../utils/instructorUtils';
import { computeConflicts, diffSchedule, diffConflicts, buildSyncDiffSummary } from '../utils/scheduleDiff';
import { getAllProfiles } from '../services/profileService';
import { auth } from '../services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useToast } from '../components/ui/Toast';
import { logActivity } from '../services/activityService';
import { getWorkingDaysForBranch } from '../utils/constants';
import SyncReportModal from '../components/ui/SyncReportModal';

const ScheduleContext = createContext(null);

/* ─── helpers ────────────────────────────────────────────────────── */

/** Safe localStorage read, merges with defaults if it's an object */
function loadLocal(key, fallback) {
  try {
    if (typeof window === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);

    // If it's the toggles object, merge with defaults to prevent missing new keys
    if (key === 'featureToggles' && typeof parsed === 'object') {
      return { ...fallback, ...parsed };
    }

    return parsed;
  } catch { return fallback; }
}

/** Save to localStorage (instant) + POST to API (background) */
function persistConfig(key, value) {
  // 1) localStorage — instant cache
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }

  // 2) API — background fire-and-forget
  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => { /* API not configured or offline — localStorage is the fallback */ });
}

/** Cache raw schedule data (all branches) so it persists across page refreshes */
function cacheScheduleData(rawClasses) {
  try {
    localStorage.setItem('cachedSchedule_classes', JSON.stringify(rawClasses));
    localStorage.setItem('cachedSchedule_lastSync', JSON.stringify(new Date().toISOString()));
  } catch (e) {
    console.warn('Failed to cache schedule data:', e.message);
  }
}

/** Derive the per-day → Set(times) shape and a flat allTimeSlots Set */
function deriveTimes(classes) {
  const byDay = {};
  const all = new Set();
  classes.forEach((c) => {
    if (!c.day || !c.time) return;
    if (!byDay[c.day]) byDay[c.day] = new Set();
    byDay[c.day].add(c.time);
    all.add(c.time);
  });
  return { byDay, all };
}

/* ─── default values ─────────────────────────────────────────────── */

const DEFAULT_TOGGLES = {
  // Global "internal feature" toggles (some pages also expose role-level controls)
  conflicts: true, availability: true, avail_available: true,
  avail_busy: true, avail_leave: true, leave: true,
  trial: true, trial_overview: true, student_distribution: false, finder: true, schedule: true, trial_input: true,
  workload: true, tasks: true, crm: true,
  api_docs: true, admin: true,
  // Sidebar role-permission keys for every sidebar entry
  home: true,
  trial_priority: true,
  profiles: true,
};

const DEFAULT_ROLE_TOGGLES = {
  Admin: { ...DEFAULT_TOGGLES },
  SPA: { ...DEFAULT_TOGGLES },
  EC: { ...DEFAULT_TOGGLES, api_docs: false, admin: false },
  Instructor: { ...DEFAULT_TOGGLES, api_docs: false, admin: false, trial_input: false },
  Supervisor: { ...DEFAULT_TOGGLES }
};

const DEFAULT_SHEET_URL = process.env.NEXT_PUBLIC_DEFAULT_SHEET_URL ||
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vS2ZEndjqsEzgvblfHF44IPQmJQRVHo65zzOya727KEZ0HjtmhXNAmXgzDXTPtGt9q3A02RqG0EV-7d/pubhtml';

const DEFAULT_BRANCHES = [
  { id: 'default', name: 'Default Branch', url: DEFAULT_SHEET_URL }
];

/**
 * Deep-merge stored role toggles with defaults so newly added sidebar keys
 * (e.g. when we add a new feature) automatically appear as enabled for every
 * role rather than missing from the UI.
 */
function mergeRoleToggles(stored) {
  const merged = {};
  for (const role of Object.keys(DEFAULT_ROLE_TOGGLES)) {
    merged[role] = { ...DEFAULT_ROLE_TOGGLES[role], ...(stored?.[role] || {}) };
  }
  // Preserve any custom roles the admin may have created
  for (const role of Object.keys(stored || {})) {
    if (!merged[role]) {
      merged[role] = { ...DEFAULT_TOGGLES, ...stored[role] };
    }
  }
  return merged;
}

/* ─── provider ───────────────────────────────────────────────────── */

export function ScheduleProvider({ children }) {
  const { showToast } = useToast();

  // Raw classes from sync — full data for ALL branches (incl. disabled)
  const [rawClasses, setRawClasses] = useState(() => loadLocal('cachedSchedule_classes', []));

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(() => {
    const cached = loadLocal('cachedSchedule_classes', []);
    return cached.length > 0 ? 'Loaded from cache' : 'Ready to Sync';
  });
  const [syncProgress, setSyncProgress] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState(() => {
    const cached = loadLocal('cachedSchedule_lastSync', null);
    return cached ? new Date(cached) : null;
  });
  const [failedBranches, setFailedBranches] = useState([]);

  // Config data — initialised from localStorage (instant), then overwritten by API
  const [branches, setBranches] = useState(() => loadLocal('branches', DEFAULT_BRANCHES));
  const [activeBranchId, setActiveBranchId] = useState(() => loadLocal('activeBranchId', 'default'));
  const [leaveList, setLeaveList] = useState(() => {
    const list = loadLocal('leaveList', []);
    return list.filter(l => isValidTeacherName(l.name));
  });
  const [trialPriorityList, setTrialPriorityList] = useState(() => {
    const list = loadLocal('trialPriority', []);
    return list.filter(p => isValidTeacherName(p.name));
  });
  const [featureToggles, setFeatureToggles] = useState(() => loadLocal('featureToggles', DEFAULT_TOGGLES));
  const [disabledInstructors, setDisabledInstructors] = useState(() => new Set(loadLocal('disabledInstructors', [])));
  const [disabledBranches, setDisabledBranches] = useState(() => new Set(loadLocal('disabledBranches', [])));

  // RBAC Config
  const [users, setUsers] = useState(() => {
    const loaded = loadLocal('users', { 'admin@schedule.local': 'Admin' });
    const normalized = {};
    for (const [k, v] of Object.entries(loaded || {})) {
      if (k) normalized[k.toLowerCase()] = v;
    }
    return normalized;
  });
  const [roleToggles, setRoleToggles] = useState(() => mergeRoleToggles(loadLocal('roleToggles', DEFAULT_ROLE_TOGGLES)));

  // Instructor Profiles
  const [instructorProfiles, setInstructorProfiles] = useState([]);

  // Sync report details state for modal
  const [syncReportDetails, setSyncReportDetails] = useState(null);

  // ─── Derived data — automatically reflects disabled branches ─────

  /**
   * Schedule classes excluding any disabled-branch entries.
   * Also filters out the branch's off-day (Holiday)
   *
   * The filter matches a row to a disabled branch by **either** branchName
   * **or** branchId. This makes us resilient to the case where a branch was
   * renamed or where an older cached row was tagged with a slightly
   * different name (e.g. "Default" vs "Default Branch") — the row still
   * disappears from every view as soon as the branch is disabled.
   */
  const overallClasses = useMemo(() => {
    // Build a set of disabled branch IDs once, so the row-level check is O(1).
    const disabledIds = new Set(
      branches
        .filter((b) => disabledBranches?.has(b.name))
        .map((b) => b.id)
    );
    const result = rawClasses.filter((c) => {
      const workingDays = getWorkingDaysForBranch(c.branchName === 'All Branches' ? 'default' : c.branchName);
      if (!workingDays.includes(c.day)) return false;
      
      if (disabledBranches?.has(c.branchName)) return false;
      if (c.branchId && disabledIds.has(c.branchId)) return false;
      return true;
    });

    return result;
  }, [rawClasses, disabledBranches, branches]);

  /** Branches the user actually wants to consider (the one we expose to filters). */
  const enabledBranches = useMemo(
    () => branches.filter(b => !disabledBranches.has(b.name)),
    [branches, disabledBranches]
  );

  // Compute active branch — fall back to first enabled if active branch is disabled
  const activeBranchName = useMemo(() => {
    const active = branches.find(b => b.id === activeBranchId);
    if (active && !disabledBranches.has(active.name)) return active.name;
    const firstEnabled = enabledBranches[0];
    return firstEnabled?.name || active?.name || 'Default Branch';
  }, [branches, activeBranchId, disabledBranches, enabledBranches]);

  const allClasses = useMemo(() => {
    if (!activeBranchName) return overallClasses;
    return overallClasses.filter(c => c.branchName === activeBranchName);
  }, [overallClasses, activeBranchName]);

  const uniqueTeachers = useMemo(() => {
    const set = new Set();
    overallClasses.forEach((c) => {
      if (isValidTeacherName(c.teacher)) set.add(c.teacher);
    });
    return set;
  }, [overallClasses]);

  /**
   * Base teachers = the pool that drives availability views, "free finder" etc.
   * We treat any teacher present in classes as a base teacher for filtering UX.
   * If an instructor exists in BOTH a disabled and an enabled branch, they
   * remain visible because the enabled-branch class keeps them in the set.
   */
  const uniqueBaseTeachers = uniqueTeachers;

  const { uniqueTimes, allTimeSlots } = useMemo(() => {
    const { byDay, all } = deriveTimes(overallClasses);
    return { uniqueTimes: byDay, allTimeSlots: all };
  }, [overallClasses]);

  // Build instructor identity map — profiles are source of truth
  const instructorMap = useMemo(() => {
    return buildInstructorMap(instructorProfiles, overallClasses);
  }, [instructorProfiles, overallClasses]);

  // Track whether we already loaded from API to avoid overwriting user edits
  const apiLoaded = useRef(false);

  // ─── Dual Storage: load from API on mount ────────────────────────
  useEffect(() => {
    if (apiLoaded.current) return;
    apiLoaded.current = true;

    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (!data.configured) {
          console.log('Config API: not configured — using localStorage only');
          return;
        }
        console.log('Config API: loaded from Google Sheets');

        // Only overwrite if the API returned data for each key
        if (data.leaveList) {
          const cleanLeave = data.leaveList.filter(l => isValidTeacherName(l.name));
          setLeaveList(cleanLeave);
          localStorage.setItem('leaveList', JSON.stringify(cleanLeave));
        }
        if (data.trialPriority) {
          const cleanPriority = data.trialPriority.filter(p => isValidTeacherName(p.name));
          setTrialPriorityList(cleanPriority);
          localStorage.setItem('trialPriority', JSON.stringify(cleanPriority));
        }
        if (data.featureToggles) {
          const mergedToggles = { ...DEFAULT_TOGGLES, ...data.featureToggles };
          setFeatureToggles(mergedToggles);
          localStorage.setItem('featureToggles', JSON.stringify(mergedToggles));
        }
        if (data.disabledInstructors) {
          setDisabledInstructors(new Set(data.disabledInstructors));
          localStorage.setItem('disabledInstructors', JSON.stringify(data.disabledInstructors));
        }
        if (data.disabledBranches) {
          setDisabledBranches(new Set(data.disabledBranches));
          localStorage.setItem('disabledBranches', JSON.stringify(data.disabledBranches));
        }
        if (data.branches) {
          setBranches(data.branches);
          localStorage.setItem('branches', JSON.stringify(data.branches));
        }
        if (data.users) {
          const normalized = {};
          for (const [k, v] of Object.entries(data.users || {})) {
            if (k) normalized[k.toLowerCase()] = v;
          }
          setUsers(normalized);
          localStorage.setItem('users', JSON.stringify(normalized));
        }
        if (data.roleToggles) {
          const merged = mergeRoleToggles(data.roleToggles);
          setRoleToggles(merged);
          localStorage.setItem('roleToggles', JSON.stringify(merged));
        }
        if (data.bugTracker) {
          localStorage.setItem('bugTracker', JSON.stringify(data.bugTracker));
        }
      })
      .catch(() => {
        console.log('Config API: unreachable — using localStorage only');
      });
  }, []);

  // ─── Fetch profiles when Auth is ready ──────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        getAllProfiles().then(profiles => {
          setInstructorProfiles(profiles);
        }).catch(err => {
          console.error('Failed to load instructor profiles from Firestore:', err);
        });
      } else {
        setInstructorProfiles([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // ─── Update functions (dual storage) ─────────────────────────────

  const updateLeaveList = useCallback((newList) => {
    setLeaveList(newList);
    persistConfig('leaveList', newList);
  }, []);

  const updateBranches = useCallback((newBranches) => {
    setBranches(newBranches);
    persistConfig('branches', newBranches);
  }, []);

  const changeActiveBranch = useCallback((branchId) => {
    setActiveBranchId(branchId);
    try { localStorage.setItem('activeBranchId', JSON.stringify(branchId)); } catch {}
  }, []);

  const updateTrialPriorityList = useCallback((newList) => {
    setTrialPriorityList(newList);
    persistConfig('trialPriority', newList);
  }, []);

  const updateFeatureToggles = useCallback((newToggles) => {
    setFeatureToggles(newToggles);
    persistConfig('featureToggles', newToggles);
  }, []);

  const updateDisabledInstructors = useCallback((newSet) => {
    setDisabledInstructors(newSet);
    persistConfig('disabledInstructors', [...newSet]);
  }, []);

  const updateDisabledBranches = useCallback((newSet) => {
    setDisabledBranches(newSet);
    persistConfig('disabledBranches', [...newSet]);
  }, []);

  /** Toggle a single branch on/off by name. Convenience wrapper. */
  const toggleBranchEnabled = useCallback((branchName) => {
    setDisabledBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branchName)) next.delete(branchName);
      else next.add(branchName);
      persistConfig('disabledBranches', [...next]);
      return next;
    });
  }, []);

  const updateUsers = useCallback((newUsers) => {
    const normalized = {};
    for (const [k, v] of Object.entries(newUsers || {})) {
      if (k) normalized[k.toLowerCase()] = v;
    }
    setUsers(normalized);
    persistConfig('users', normalized);
  }, []);

  const updateRoleToggles = useCallback((newRoleToggles) => {
    setRoleToggles(newRoleToggles);
    persistConfig('roleToggles', newRoleToggles);
  }, []);

  const refreshProfiles = useCallback(async () => {
    try {
      const profiles = await getAllProfiles();
      setInstructorProfiles(profiles);
    } catch (err) {
      console.error('Failed to refresh instructor profiles:', err);
    }
  }, []);

  // If the user disables the active branch, jump to the first enabled one
  useEffect(() => {
    const active = branches.find(b => b.id === activeBranchId);
    if (active && disabledBranches.has(active.name)) {
      const firstEnabled = branches.find(b => !disabledBranches.has(b.name));
      if (firstEnabled && firstEnabled.id !== activeBranchId) {
        setActiveBranchId(firstEnabled.id);
        try { localStorage.setItem('activeBranchId', JSON.stringify(firstEnabled.id)); } catch {}
      }
    }
  }, [branches, activeBranchId, disabledBranches]);

  // ─── Quick Sync (Single Branch) ───────────────────────────────

  const syncActiveBranch = useCallback(async () => {
    const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
    if (!activeBranch || !activeBranch.url) {
      alert('Active branch does not have a valid Google Sheets Publish link.');
      return;
    }
    if (disabledBranches.has(activeBranch.name)) {
      showToast({
        title: `${activeBranch.name} is disabled`,
        message: 'Re-enable the branch in Admin Settings to sync it.',
        variant: 'warning',
        duration: 6000,
      });
      return;
    }

    // Snapshot pre-sync state for diffing (use visible scope)
    const prevClasses = overallClasses;
    const prevConflicts = computeConflicts(prevClasses);
    const isInitialSync = !lastSyncTime;

    setIsSyncing(true);
    setSyncStatus(`Syncing ${activeBranch.name}...`);
    setSyncProgress(0);

    try {
      const qs = `sheetUrl=${encodeURIComponent(activeBranch.url)}&branchId=${encodeURIComponent(activeBranch.id)}&branchName=${encodeURIComponent(activeBranch.name)}`;
      const response = await fetch(`/api/schedule?${qs}`);
      const data = await response.json();

      setSyncProgress(100);

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Sync failed');
      }

      // Update raw classes: replace this branch's classes, keep other branches
      const updatedRaw = [
        ...rawClasses.filter(c => c.branchName !== activeBranch.name),
        ...data.classes,
      ];
      setRawClasses(updatedRaw);
      cacheScheduleData(updatedRaw);
      setLastSyncTime(new Date());

      let statusMsg = `Synced ${activeBranch.name}: ${data.syncedTabs}/${data.totalTabs} day(s)`;
      if (data.failedTabs.length > 0) statusMsg += ` (${data.failedTabs.length} failed)`;
      setSyncStatus(statusMsg);

      if (auth.currentUser?.email) {
        logActivity(auth.currentUser.email, `synced ${activeBranch.name}`);
      }

      // Compute and show diff toast — diff using visible (post-filter) classes
      const updatedVisible = updatedRaw.filter(c => !disabledBranches.has(c.branchName));
      const scheduleDiff = diffSchedule(prevClasses, updatedVisible, { branchName: activeBranch.name });
      const newConflicts = computeConflicts(updatedVisible);
      const conflictDiff = diffConflicts(prevConflicts, newConflicts);
      const summary = buildSyncDiffSummary({ scheduleDiff, conflictDiff, isInitial: isInitialSync });

      showToast({
        title: `${activeBranch.name} synced`,
        message: data.failedTabs.length > 0
          ? `${data.syncedTabs} of ${data.totalTabs} days loaded · ${data.failedTabs.length} failed`
          : `${data.syncedTabs} of ${data.totalTabs} days loaded`,
        details: summary.chips,
        variant: data.failedTabs.length > 0 ? 'warning' : 'success',
        duration: 7000,
      });
    } catch (error) {
      console.error('Quick Sync error:', error);
      setSyncStatus('Quick Sync Failed');
      showToast({
        title: `${activeBranch.name} sync failed`,
        message: error.message || 'Unable to fetch schedule',
        variant: 'error',
        duration: 8000,
      });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncProgress(0), 1000); // clear progress bar after a sec
    }
  }, [branches, activeBranchId, rawClasses, overallClasses, disabledBranches, lastSyncTime, showToast]);

  // ─── Full Sync (All Enabled Branches) ───────────────────────────

  const syncAllBranches = useCallback(async () => {
    if (!branches || branches.length === 0) return;

    const branchesToSync = branches.filter(b => !disabledBranches.has(b.name));
    const skipped = branches.filter(b => disabledBranches.has(b.name)).map(b => b.name);

    if (branchesToSync.length === 0) {
      showToast({
        title: 'Nothing to sync',
        message: 'All branches are currently disabled.',
        variant: 'warning',
        duration: 6000,
      });
      return;
    }

    // Snapshot pre-sync state for diffing
    const prevClasses = overallClasses;
    const prevConflicts = computeConflicts(prevClasses);
    const isInitialSync = !lastSyncTime;

    setIsSyncing(true);
    setSyncStatus('Syncing All Branches...');
    setSyncProgress(0);

    try {
      let completed = 0;
      let allCombinedClasses = [];

      // Parallel fetch all enabled branches
      const results = await Promise.allSettled(
        branchesToSync.map(async (branch) => {
          if (!branch.url) return { success: false, error: 'No URL', branch };
          const qs = `sheetUrl=${encodeURIComponent(branch.url)}&branchId=${encodeURIComponent(branch.id)}&branchName=${encodeURIComponent(branch.name)}`;
          const res = await fetch(`/api/schedule?${qs}`);
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Failed');

          completed++;
          setSyncProgress(Math.round((completed / branchesToSync.length) * 100));

          return { success: true, data, branch };
        })
      );

      let successCount = 0;
      let failCount = 0;
      const failed = [];

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          const { data } = result.value;
          allCombinedClasses.push(...data.classes);
          successCount++;
        } else {
          failCount++;
          const branch = result.status === 'fulfilled' ? result.value?.branch : null;
          if (branch) failed.push(branch.name);
        }
      }

      setFailedBranches(failed);

      // Preserve any existing classes from disabled branches (we didn't refetch them)
      const preservedDisabled = rawClasses.filter(c => disabledBranches.has(c.branchName));
      const newRaw = [...preservedDisabled, ...allCombinedClasses];
      setRawClasses(newRaw);
      cacheScheduleData(newRaw);

      setLastSyncTime(new Date());
      setSyncStatus(`Full Sync: ${successCount} successful, ${failCount} failed.`);

      if (auth.currentUser?.email) {
        logActivity(auth.currentUser.email, 'synced all branches');
      }

      // Compute and show diff toast (visible scope)
      const newVisible = newRaw.filter(c => !disabledBranches.has(c.branchName));
      const scheduleDiff = diffSchedule(prevClasses, newVisible);
      const newConflicts = computeConflicts(newVisible);
      const conflictDiff = diffConflicts(prevConflicts, newConflicts);
      const summary = buildSyncDiffSummary({ scheduleDiff, conflictDiff, isInitial: isInitialSync });

      let toastVariant = 'success';
      let toastTitle = 'All branches synced';
      if (failCount > 0 && successCount > 0) {
        toastVariant = 'warning';
        toastTitle = 'Sync completed with warnings';
      } else if (failCount > 0 && successCount === 0) {
        toastVariant = 'error';
        toastTitle = 'Sync failed';
      }

      const messageParts = [`${successCount} of ${branchesToSync.length} branches`];
      if (failCount > 0) messageParts.push(`${failed.join(', ')} failed`);
      if (skipped.length > 0) messageParts.push(`${skipped.length} disabled, skipped`);

      showToast({
        title: toastTitle,
        message: messageParts.join(' · '),
        details: summary.chips,
        variant: toastVariant,
        duration: 8000,
        onClick: () => setSyncReportDetails({
          successCount, failCount, failed, skipped, scheduleDiff, conflictDiff
        }),
      });
    } catch (error) {
      console.error('Full Sync error:', error);
      setSyncStatus('Full Sync Failed');
      showToast({
        title: 'Sync failed',
        message: error.message || 'Unable to sync branches',
        variant: 'error',
        duration: 8000,
      });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncProgress(0), 1000);
    }
  }, [branches, disabledBranches, rawClasses, overallClasses, lastSyncTime, showToast]);

  // Legacy syncSchedule points to Quick Sync to not break existing calls
  const syncSchedule = syncActiveBranch;

  // ─── Auto-sync if cache is stale (older than 2 hours) ────────────
  const autoSyncTriggered = useRef(false);
  useEffect(() => {
    if (autoSyncTriggered.current) return;
    const cachedSync = loadLocal('cachedSchedule_lastSync', null);
    if (!cachedSync) return; // Never synced — user must do first sync manually

    const lastSync = new Date(cachedSync);
    const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);

    if (hoursSinceSync >= 2 && branches.length > 0) {
      autoSyncTriggered.current = true;
      console.log(`Auto-sync: cache is ${Math.round(hoursSinceSync)}h old, refreshing...`);
      setTimeout(() => {
        syncAllBranches();
      }, 2000);
    }
  }, [branches, syncAllBranches]);

  // ─── Conflict engine (visible scope) ──────────────────────────────

  const conflicts = useMemo(() => computeConflicts(overallClasses), [overallClasses]);

  // ─── Context value ────────────────────────────────────────────────

  const value = {
    // Branch state
    branches, updateBranches,
    enabledBranches,
    disabledBranches, updateDisabledBranches, toggleBranchEnabled,
    activeBranchId, changeActiveBranch,
    activeBranchName,

    // Data state (filtered to enabled branches)
    allClasses, overallClasses,
    uniqueTeachers, uniqueBaseTeachers, uniqueTimes, allTimeSlots,
    instructorMap,

    // Sync state
    isSyncing, syncStatus, syncProgress, lastSyncTime, failedBranches,
    syncSchedule, syncActiveBranch, syncAllBranches,

    conflicts,
    leaveList, updateLeaveList,
    trialPriorityList, updateTrialPriorityList,
    featureToggles, updateFeatureToggles,
    disabledInstructors, updateDisabledInstructors,
    users, updateUsers,
    roleToggles, updateRoleToggles,
    instructorProfiles, refreshProfiles,
  };

  return (
    <ScheduleContext.Provider value={value}>
      {children}
      {syncReportDetails && (
        <SyncReportModal 
          report={syncReportDetails} 
          onClose={() => setSyncReportDetails(null)} 
        />
      )}
    </ScheduleContext.Provider>
  );
}

export function useSchedule() {
  const context = useContext(ScheduleContext);
  if (!context) throw new Error('useSchedule must be used within ScheduleProvider');
  return context;
}
