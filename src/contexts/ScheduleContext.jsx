'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';
import { buildInstructorMap } from '../utils/instructorUtils';
import { getAllProfiles } from '../services/profileService';
import { auth } from '../services/firebase';
import { onAuthStateChanged } from 'firebase/auth';

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

/** Cache schedule data to localStorage so it persists across page refreshes */
function cacheScheduleData(classes, teachers, baseTeachers, times, allTimeSlots) {
  try {
    localStorage.setItem('cachedSchedule_classes', JSON.stringify(classes));
    localStorage.setItem('cachedSchedule_teachers', JSON.stringify([...teachers]));
    localStorage.setItem('cachedSchedule_baseTeachers', JSON.stringify([...baseTeachers]));
    // Convert Set values to arrays for JSON serialization
    const timesObj = {};
    for (const [day, dayTimes] of Object.entries(times)) {
      timesObj[day] = dayTimes instanceof Set ? [...dayTimes] : dayTimes;
    }
    localStorage.setItem('cachedSchedule_times', JSON.stringify(timesObj));
    localStorage.setItem('cachedSchedule_allTimeSlots', JSON.stringify([...allTimeSlots]));
    localStorage.setItem('cachedSchedule_lastSync', JSON.stringify(new Date().toISOString()));
  } catch (e) {
    console.warn('Failed to cache schedule data:', e.message);
  }
}

/* ─── default values ─────────────────────────────────────────────── */

const DEFAULT_TOGGLES = {
  conflicts: true, availability: true, avail_available: true,
  avail_busy: true, avail_leave: true, leave: true,
  trial: true, trial_overview: true, finder: true, schedule: true, trial_input: true,
  api_docs: true, admin: true,
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

/* ─── provider ───────────────────────────────────────────────────── */

export function ScheduleProvider({ children }) {
  // Restore cached schedule data from localStorage on mount
  const [overallClasses, setOverallClasses] = useState(() => loadLocal('cachedSchedule_classes', []));
  const [uniqueTeachers, setUniqueTeachers] = useState(() => new Set(loadLocal('cachedSchedule_teachers', [])));
  const [uniqueBaseTeachers, setUniqueBaseTeachers] = useState(() => new Set(loadLocal('cachedSchedule_baseTeachers', [])));
  const [uniqueTimes, setUniqueTimes] = useState(() => {
    const cached = loadLocal('cachedSchedule_times', {});
    const restored = {};
    for (const [day, times] of Object.entries(cached)) {
      restored[day] = new Set(times);
    }
    return restored;
  });
  const [allTimeSlots, setAllTimeSlots] = useState(() => new Set(loadLocal('cachedSchedule_allTimeSlots', [])));
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
  const [leaveList, setLeaveList] = useState(() => loadLocal('leaveList', []));
  const [trialPriorityList, setTrialPriorityList] = useState(() => loadLocal('trialPriority', []));
  const [featureToggles, setFeatureToggles] = useState(() => loadLocal('featureToggles', DEFAULT_TOGGLES));
  const [disabledInstructors, setDisabledInstructors] = useState(() => new Set(loadLocal('disabledInstructors', [])));
  
  // RBAC Config
  const [users, setUsers] = useState(() => loadLocal('users', { 'admin@schedule.local': 'Admin' }));
  const [roleToggles, setRoleToggles] = useState(() => loadLocal('roleToggles', DEFAULT_ROLE_TOGGLES));

  // Instructor Profiles
  const [instructorProfiles, setInstructorProfiles] = useState([]);

  // Compute active branch name and its specific classes
  const activeBranchName = branches.find(b => b.id === activeBranchId)?.name || 'Default Branch';
  
  const allClasses = useMemo(() => {
    if (!activeBranchName) return overallClasses;
    return overallClasses.filter(c => c.branchName === activeBranchName);
  }, [overallClasses, activeBranchName]);

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
          setLeaveList(data.leaveList);
          localStorage.setItem('leaveList', JSON.stringify(data.leaveList));
        }
        if (data.trialPriority) {
          setTrialPriorityList(data.trialPriority);
          localStorage.setItem('trialPriority', JSON.stringify(data.trialPriority));
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
        if (data.branches) {
          setBranches(data.branches);
          localStorage.setItem('branches', JSON.stringify(data.branches));
        }
        if (data.users) {
          setUsers(data.users);
          localStorage.setItem('users', JSON.stringify(data.users));
        }
        if (data.roleToggles) {
          const merged = { ...DEFAULT_ROLE_TOGGLES, ...data.roleToggles };
          setRoleToggles(merged);
          localStorage.setItem('roleToggles', JSON.stringify(merged));
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
      // Delay slightly to not block initial render
      setTimeout(() => {
        syncAllBranches();
      }, 2000);
    }
  }, [branches, syncAllBranches]);

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

  const updateUsers = useCallback((newUsers) => {
    setUsers(newUsers);
    persistConfig('users', newUsers);
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

  // ─── Quick Sync (Single Branch) ───────────────────────────────

  const syncActiveBranch = useCallback(async () => {
    const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];
    if (!activeBranch || !activeBranch.url) {
      alert('Active branch does not have a valid Google Sheets Publish link.');
      return;
    }

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

      const newTeachers = new Set(data.teachers);
      const newBaseTeachers = new Set(data.baseTeachers);
      const newTimes = {};
      const newAllTimeSlots = new Set();

      for (const [day, dayTimes] of Object.entries(data.times)) {
        newTimes[day] = new Set(dayTimes);
        dayTimes.forEach((t) => newAllTimeSlots.add(t));
      }

      // Update overallClasses: replace this branch's classes, keep other branches
      setOverallClasses(prev => {
        const otherBranchClasses = prev.filter(c => c.branchName !== activeBranch.name);
        const updated = [...otherBranchClasses, ...data.classes];
        // Cache the updated schedule
        cacheScheduleData(updated, newTeachers, newBaseTeachers, newTimes, newAllTimeSlots);
        return updated;
      });
      setUniqueTeachers(newTeachers);
      setUniqueBaseTeachers(newBaseTeachers);
      setUniqueTimes(newTimes);
      setAllTimeSlots(newAllTimeSlots);
      setLastSyncTime(new Date());

      let statusMsg = `Synced ${activeBranch.name}: ${data.syncedTabs}/${data.totalTabs} day(s)`;
      if (data.failedTabs.length > 0) statusMsg += ` (${data.failedTabs.length} failed)`;
      setSyncStatus(statusMsg);
    } catch (error) {
      console.error('Quick Sync error:', error);
      setSyncStatus('Quick Sync Failed');
      alert(`Sync Failed for ${activeBranch.name}!\n\nError: ${error.message}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncProgress(0), 1000); // clear progress bar after a sec
    }
  }, [branches, activeBranchId]);

  // ─── Full Sync (All Branches) ───────────────────────────────────

  const syncAllBranches = useCallback(async () => {
    if (!branches || branches.length === 0) return;

    setIsSyncing(true);
    setSyncStatus('Syncing All Branches...');
    setSyncProgress(0);

    try {
      let completed = 0;
      let allCombinedClasses = [];
      const allTeachers = new Set();
      const allBaseTeachers = new Set();
      const allNewTimes = {};
      const newAllTimeSlots = new Set();
      
      // Parallel fetch all branches
      const results = await Promise.allSettled(
        branches.map(async (branch) => {
          if (!branch.url) return { success: false, error: 'No URL', branch };
          const qs = `sheetUrl=${encodeURIComponent(branch.url)}&branchId=${encodeURIComponent(branch.id)}&branchName=${encodeURIComponent(branch.name)}`;
          const res = await fetch(`/api/schedule?${qs}`);
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
          
          // Update progress
          completed++;
          setSyncProgress(Math.round((completed / branches.length) * 100));
          
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
          
          data.teachers.forEach(t => allTeachers.add(t));
          data.baseTeachers.forEach(t => allBaseTeachers.add(t));
          
          for (const [day, dayTimes] of Object.entries(data.times)) {
            if (!allNewTimes[day]) allNewTimes[day] = new Set();
            dayTimes.forEach(t => {
              allNewTimes[day].add(t);
              newAllTimeSlots.add(t);
            });
          }
          
          successCount++;
        } else {
          failCount++;
          const branch = result.status === 'fulfilled' ? result.value?.branch : null;
          if (branch) failed.push(branch.name);
        }
      }

      setFailedBranches(failed);

      setOverallClasses(allCombinedClasses);
      setUniqueTeachers(allTeachers);
      setUniqueBaseTeachers(allBaseTeachers);
      setUniqueTimes(allNewTimes);
      setAllTimeSlots(newAllTimeSlots);
      setLastSyncTime(new Date());
      setSyncStatus(`Full Sync: ${successCount} successful, ${failCount} failed.`);

      // Cache the synced data
      cacheScheduleData(allCombinedClasses, allTeachers, allBaseTeachers, allNewTimes, newAllTimeSlots);
    } catch (error) {
      console.error('Full Sync error:', error);
      setSyncStatus('Full Sync Failed');
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncProgress(0), 1000);
    }
  }, [branches]);

  // Legacy syncSchedule points to Quick Sync to not break existing calls
  const syncSchedule = syncActiveBranch;

  // ─── Conflict engine (all branches) ────────────────────────────────

  const conflicts = useMemo(() => {
    const result = [];
    const teacherSchedule = {};
    overallClasses.forEach((cls) => {
      if (!cls.teacher || cls.teacher === '-') return;
      const key = `${cls.day}|${cls.teacher}`;
      if (!teacherSchedule[key]) teacherSchedule[key] = [];
      const existing = teacherSchedule[key].find(
        (c) => c.time === cls.time && c.program === cls.program && c.branchName === cls.branchName
      );
      if (!existing) teacherSchedule[key].push({ time: cls.time, program: cls.program, branchName: cls.branchName || '' });
    });

    for (const [key, classes] of Object.entries(teacherSchedule)) {
      const [day, teacher] = key.split('|');
      for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) {
          if (classes[i].time !== classes[j].time && doTimeSlotsOverlap(classes[i].time, classes[j].time)) {
            // Collect branch names involved in this conflict
            const branchesInvolved = new Set([classes[i].branchName, classes[j].branchName].filter(Boolean));
            result.push({
              teacher, day,
              slot1: `${classes[i].time} (${classes[i].program})`,
              slot2: `${classes[j].time} (${classes[j].program})`,
              branch1: classes[i].branchName || '',
              branch2: classes[j].branchName || '',
              branches: [...branchesInvolved],
            });
          }
        }
      }
    }
    return result;
  }, [overallClasses]);

  // ─── Context value ────────────────────────────────────────────────

  const value = {
    // Branch state
    branches, updateBranches,
    activeBranchId, changeActiveBranch,
    activeBranchName,
    
    // Data state
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

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

export function useSchedule() {
  const context = useContext(ScheduleContext);
  if (!context) throw new Error('useSchedule must be used within ScheduleProvider');
  return context;
}
