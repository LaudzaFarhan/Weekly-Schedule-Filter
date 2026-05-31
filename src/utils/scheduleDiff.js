/**
 * Schedule diff utilities — compute what changed between two snapshots
 * of the master schedule and the conflicts derived from it.
 */

import { doTimeSlotsOverlap } from './timeUtils';

/**
 * Stable identity for a single class row.
 * Two rows with the same key are considered "the same class".
 */
function classKey(c) {
  return [
    c.branchName || '',
    c.day || '',
    c.time || '',
    c.teacher || '',
    c.student || '',
    c.program || '',
  ].join('|');
}

/**
 * Stable identity for a conflict.
 * Slots are sorted so order doesn't matter.
 */
function conflictKey(c) {
  const slots = [c.slot1, c.slot2].slice().sort().join('::');
  return `${c.teacher}|${c.day}|${slots}`;
}

/**
 * Compute conflicts from a flat array of classes.
 * Same logic that ScheduleContext used inline — extracted so we can run it
 * against pre-sync and post-sync snapshots.
 */
export function computeConflicts(classes) {
  const result = [];
  const teacherSchedule = {};

  classes.forEach((cls) => {
    if (!cls.teacher || cls.teacher === '-') return;
    const key = `${cls.day}|${cls.teacher}`;
    if (!teacherSchedule[key]) teacherSchedule[key] = [];
    const existing = teacherSchedule[key].find(
      (c) => c.time === cls.time && c.program === cls.program && c.branchName === cls.branchName
    );
    if (!existing) {
      teacherSchedule[key].push({
        time: cls.time,
        program: cls.program,
        branchName: cls.branchName || '',
      });
    }
  });

  for (const [key, items] of Object.entries(teacherSchedule)) {
    const [day, teacher] = key.split('|');
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (items[i].time !== items[j].time && doTimeSlotsOverlap(items[i].time, items[j].time)) {
          const branchesInvolved = new Set(
            [items[i].branchName, items[j].branchName].filter(Boolean)
          );
          result.push({
            teacher,
            day,
            slot1: `${items[i].time} (${items[i].program})`,
            slot2: `${items[j].time} (${items[j].program})`,
            time1: items[i].time,
            time2: items[j].time,
            program1: items[i].program,
            program2: items[j].program,
            branch1: items[i].branchName || '',
            branch2: items[j].branchName || '',
            branches: [...branchesInvolved],
          });
        }
      }
    }
  }
  return result;
}

/**
 * Diff two arrays of classes by their stable keys.
 * Optionally restrict the comparison to a single branchName so a single-branch
 * sync doesn't report churn from other branches that weren't touched.
 */
export function diffSchedule(prevClasses, nextClasses, { branchName = null } = {}) {
  const filterFn = branchName ? (c) => c.branchName === branchName : () => true;
  const prev = (prevClasses || []).filter(filterFn);
  const next = (nextClasses || []).filter(filterFn);

  const prevMap = new Map();
  prev.forEach((c) => prevMap.set(classKey(c), c));

  const nextMap = new Map();
  next.forEach((c) => nextMap.set(classKey(c), c));

  const added = [];
  const removed = [];

  for (const [key, cls] of nextMap) {
    if (!prevMap.has(key)) added.push(cls);
  }
  for (const [key, cls] of prevMap) {
    if (!nextMap.has(key)) removed.push(cls);
  }

  return { added, removed, prevTotal: prev.length, nextTotal: next.length };
}

/**
 * Diff two arrays of conflicts by their stable keys.
 */
export function diffConflicts(prevConflicts, nextConflicts) {
  const prevMap = new Map();
  (prevConflicts || []).forEach((c) => prevMap.set(conflictKey(c), c));

  const nextMap = new Map();
  (nextConflicts || []).forEach((c) => nextMap.set(conflictKey(c), c));

  const added = [];
  const resolved = [];

  for (const [key, c] of nextMap) {
    if (!prevMap.has(key)) added.push(c);
  }
  for (const [key, c] of prevMap) {
    if (!nextMap.has(key)) resolved.push(c);
  }

  return { added, resolved, prevTotal: prevMap.size, nextTotal: nextMap.size };
}

/**
 * Build the toast payload (chips array) from a sync diff.
 * Returns { chips, isInitial, hasChanges }.
 *
 * - chips: [{ label, value, variant }] ready to render
 * - isInitial: true when there was no prior data (first ever sync)
 * - hasChanges: true when any class or conflict count is non-zero
 */
export function buildSyncDiffSummary({
  scheduleDiff,
  conflictDiff,
  isInitial = false,
}) {
  const chips = [];

  if (isInitial) {
    chips.push({
      label: scheduleDiff.nextTotal === 1 ? 'class loaded' : 'classes loaded',
      value: scheduleDiff.nextTotal,
      variant: 'info',
    });
    if (conflictDiff.nextTotal > 0) {
      chips.push({
        label: conflictDiff.nextTotal === 1 ? 'conflict' : 'conflicts',
        value: conflictDiff.nextTotal,
        variant: 'warning',
      });
    }
    return { chips, isInitial: true, hasChanges: scheduleDiff.nextTotal > 0 };
  }

  const addedClasses = scheduleDiff.added.length;
  const removedClasses = scheduleDiff.removed.length;
  const addedConflicts = conflictDiff.added.length;
  const resolvedConflicts = conflictDiff.resolved.length;

  if (addedClasses > 0) {
    chips.push({
      label: addedClasses === 1 ? 'class' : 'classes',
      value: `+${addedClasses}`,
      variant: 'add',
    });
  }
  if (removedClasses > 0) {
    chips.push({
      label: removedClasses === 1 ? 'class' : 'classes',
      value: `-${removedClasses}`,
      variant: 'remove',
    });
  }
  if (addedConflicts > 0) {
    chips.push({
      label: addedConflicts === 1 ? 'new conflict' : 'new conflicts',
      value: `+${addedConflicts}`,
      variant: 'warning',
    });
  }
  if (resolvedConflicts > 0) {
    chips.push({
      label: resolvedConflicts === 1 ? 'conflict resolved' : 'conflicts resolved',
      value: `-${resolvedConflicts}`,
      variant: 'add',
    });
  }

  const hasChanges = chips.length > 0;
  if (!hasChanges) {
    chips.push({ label: 'No changes detected', value: '', variant: 'info' });
  }

  return { chips, isInitial: false, hasChanges };
}
