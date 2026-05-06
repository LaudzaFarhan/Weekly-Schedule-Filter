import { createContext, useContext, useState, useCallback } from 'react';
import { discoverTabs, filterDayTabs, getBaseUrl, getProxyUrl, fetchWithTimeout } from '../services/sheetsApi';
import { parseCSVData } from '../utils/csvParser';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';

const ScheduleContext = createContext(null);

export function ScheduleProvider({ children }) {
  const [allClasses, setAllClasses] = useState([]);
  const [uniqueTeachers, setUniqueTeachers] = useState(new Set());
  const [uniqueBaseTeachers, setUniqueBaseTeachers] = useState(new Set());
  const [uniqueTimes, setUniqueTimes] = useState({});
  const [allTimeSlots, setAllTimeSlots] = useState(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Ready to Sync');
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [sheetUrl, setSheetUrl] = useState(
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vS2ZEndjqsEzgvblfHF44IPQmJQRVHo65zzOya727KEZ0HjtmhXNAmXgzDXTPtGt9q3A02RqG0EV-7d/pubhtml'
  );

  // Leave list (persisted in localStorage)
  const [leaveList, setLeaveList] = useState(() => {
    try { return JSON.parse(localStorage.getItem('leaveList') || '[]'); } catch { return []; }
  });

  // Trial priority list (persisted in localStorage)
  const [trialPriorityList, setTrialPriorityList] = useState(() => {
    try { return JSON.parse(localStorage.getItem('trialPriority') || '[]'); } catch { return []; }
  });

  // Feature toggles
  const [featureToggles, setFeatureToggles] = useState(() => {
    const defaults = {
      conflicts: true, availability: true, avail_available: true,
      avail_busy: true, avail_leave: true, leave: true,
      trial: true, trial_overview: true, finder: true, schedule: true, trial_input: true,
    };
    try { return JSON.parse(localStorage.getItem('featureToggles') || JSON.stringify(defaults)); } catch { return defaults; }
  });

  // Disabled instructors (persisted in localStorage)
  const [disabledInstructors, setDisabledInstructors] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('disabledInstructors') || '[]')); } catch { return new Set(); }
  });

  const updateLeaveList = useCallback((newList) => {
    setLeaveList(newList);
    localStorage.setItem('leaveList', JSON.stringify(newList));
  }, []);

  const updateTrialPriorityList = useCallback((newList) => {
    setTrialPriorityList(newList);
    localStorage.setItem('trialPriority', JSON.stringify(newList));
  }, []);

  const updateFeatureToggles = useCallback((newToggles) => {
    setFeatureToggles(newToggles);
    localStorage.setItem('featureToggles', JSON.stringify(newToggles));
  }, []);

  const updateDisabledInstructors = useCallback((newSet) => {
    setDisabledInstructors(newSet);
    localStorage.setItem('disabledInstructors', JSON.stringify([...newSet]));
  }, []);

  const syncSchedule = useCallback(async () => {
    const baseUrl = getBaseUrl(sheetUrl);
    if (!baseUrl) {
      alert('Please enter a valid Google Sheets Publish link.');
      return;
    }

    setIsSyncing(true);
    setSyncStatus('Discovering tabs...');

    try {
      const allTabs = await discoverTabs(baseUrl);
      const dayTabs = filterDayTabs(allTabs);

      if (dayTabs.length === 0) {
        const tabNames = allTabs.map((t) => t.name).join(', ');
        throw new Error(`No day tabs found! Found tabs: [${tabNames}]`);
      }

      setSyncStatus(`Syncing ${dayTabs.length} tabs...`);

      const results = await Promise.allSettled(
        dayTabs.map(async (tab) => {
          const targetUrl = `${baseUrl}?gid=${tab.gid}&single=true&output=csv`;
          const proxyUrl = getProxyUrl(targetUrl);
          const response = await fetchWithTimeout(proxyUrl, 15000);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const csvText = await response.text();
          return { tab, csvText };
        })
      );

      const newClasses = [];
      const newTeachers = new Set();
      const newBaseTeachers = new Set();
      const newTimes = {};
      const newAllTimeSlots = new Set();
      let successCount = 0;
      let failedTabs = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { tab, csvText } = result.value;
          const parsed = parseCSVData(csvText, tab.name);
          newClasses.push(...parsed.classes);
          parsed.teachers.forEach((t) => newTeachers.add(t));
          parsed.baseTeachers.forEach((t) => newBaseTeachers.add(t));
          if (!newTimes[tab.name]) newTimes[tab.name] = new Set();
          parsed.times.forEach((t) => { newTimes[tab.name].add(t); newAllTimeSlots.add(t); });
          successCount++;
        } else {
          failedTabs.push(result.reason.message);
        }
      }

      if (successCount === 0) {
        throw new Error('All tabs failed to load.');
      }

      setAllClasses(newClasses);
      setUniqueTeachers(newTeachers);
      setUniqueBaseTeachers(newBaseTeachers);
      setUniqueTimes(newTimes);
      setAllTimeSlots(newAllTimeSlots);
      setLastSyncTime(new Date());

      let statusMsg = `Synced ${successCount}/${dayTabs.length} day(s)`;
      if (failedTabs.length > 0) statusMsg += ` (${failedTabs.length} failed)`;
      setSyncStatus(statusMsg);
    } catch (error) {
      console.error('Sync error:', error);
      setSyncStatus('Sync Failed');
      alert(`Sync Failed!\n\nError: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  }, [sheetUrl]);

  // Conflict engine
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
