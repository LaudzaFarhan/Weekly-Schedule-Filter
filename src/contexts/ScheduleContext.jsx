'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';

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

/* ─── default values ─────────────────────────────────────────────── */

const DEFAULT_TOGGLES = {
  conflicts: true, availability: true, avail_available: true,
  avail_busy: true, avail_leave: true, leave: true,
  trial: true, trial_overview: true, finder: true, schedule: true, trial_input: true,
};

const DEFAULT_SHEET_URL = process.env.NEXT_PUBLIC_DEFAULT_SHEET_URL ||
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vS2ZEndjqsEzgvblfHF44IPQmJQRVHo65zzOya727KEZ0HjtmhXNAmXgzDXTPtGt9q3A02RqG0EV-7d/pubhtml';

/* ─── provider ───────────────────────────────────────────────────── */

export function ScheduleProvider({ children }) {
  // Schedule data
  const [allClasses, setAllClasses] = useState([]);
  const [uniqueTeachers, setUniqueTeachers] = useState(new Set());
  const [uniqueBaseTeachers, setUniqueBaseTeachers] = useState(new Set());
  const [uniqueTimes, setUniqueTimes] = useState({});
  const [allTimeSlots, setAllTimeSlots] = useState(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Ready to Sync');
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [sheetUrl, setSheetUrl] = useState(DEFAULT_SHEET_URL);

  // Config data — initialised from localStorage (instant), then overwritten by API
  const [leaveList, setLeaveList] = useState(() => loadLocal('leaveList', []));
  const [trialPriorityList, setTrialPriorityList] = useState(() => loadLocal('trialPriority', []));
  const [featureToggles, setFeatureToggles] = useState(() => loadLocal('featureToggles', DEFAULT_TOGGLES));
  const [disabledInstructors, setDisabledInstructors] = useState(() => new Set(loadLocal('disabledInstructors', [])));

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
      })
      .catch(() => {
        console.log('Config API: unreachable — using localStorage only');
      });
  }, []);

  // ─── Update functions (dual storage) ─────────────────────────────

  const updateLeaveList = useCallback((newList) => {
    setLeaveList(newList);
    persistConfig('leaveList', newList);
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

  // ─── Schedule sync ───────────────────────────────────────────────

  const syncSchedule = useCallback(async () => {
    if (!sheetUrl) {
      alert('Please enter a valid Google Sheets Publish link.');
      return;
    }

    setIsSyncing(true);
    setSyncStatus('Syncing via API...');

    try {
      const response = await fetch(`/api/schedule?sheetUrl=${encodeURIComponent(sheetUrl)}`);
      const data = await response.json();

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

      setAllClasses(data.classes);
      setUniqueTeachers(newTeachers);
      setUniqueBaseTeachers(newBaseTeachers);
      setUniqueTimes(newTimes);
      setAllTimeSlots(newAllTimeSlots);
      setLastSyncTime(new Date());

      let statusMsg = `Synced ${data.syncedTabs}/${data.totalTabs} day(s)`;
      if (data.failedTabs.length > 0) statusMsg += ` (${data.failedTabs.length} failed)`;
      setSyncStatus(statusMsg);
    } catch (error) {
      console.error('Sync error:', error);
      setSyncStatus('Sync Failed');
      alert(`Sync Failed!\n\nError: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  }, [sheetUrl]);

  // ─── Conflict engine ─────────────────────────────────────────────

  const conflicts = (() => {
    const result = [];
    const teacherSchedule = {};
    allClasses.forEach((cls) => {
      if (!cls.teacher || cls.teacher === '-') return;
      const key = `${cls.day}|${cls.teacher}`;
      if (!teacherSchedule[key]) teacherSchedule[key] = [];
      const existing = teacherSchedule[key].find(
        (c) => c.time === cls.time && c.program === cls.program
      );
      if (!existing) teacherSchedule[key].push({ time: cls.time, program: cls.program });
    });

    for (const [key, classes] of Object.entries(teacherSchedule)) {
      const [day, teacher] = key.split('|');
      for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) {
          if (classes[i].time !== classes[j].time && doTimeSlotsOverlap(classes[i].time, classes[j].time)) {
            result.push({
              teacher, day,
              slot1: `${classes[i].time} (${classes[i].program})`,
              slot2: `${classes[j].time} (${classes[j].program})`,
            });
          }
        }
      }
    }
    return result;
  })();

  // ─── Context value ────────────────────────────────────────────────

  const value = {
    allClasses, uniqueTeachers, uniqueBaseTeachers, uniqueTimes, allTimeSlots,
    isSyncing, syncStatus, lastSyncTime, sheetUrl, setSheetUrl,
    syncSchedule, conflicts,
    leaveList, updateLeaveList,
    trialPriorityList, updateTrialPriorityList,
    featureToggles, updateFeatureToggles,
    disabledInstructors, updateDisabledInstructors,
  };

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

export function useSchedule() {
  const context = useContext(ScheduleContext);
  if (!context) throw new Error('useSchedule must be used within ScheduleProvider');
  return context;
}
