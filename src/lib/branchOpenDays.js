/**
 * Whether a branch is open on a given weekday or date.
 *
 * The Operationals page is the source of truth: `internal_operationals` holds one
 * row per branch and weekday with an `is_open` flag. Nothing may be scheduled at
 * a branch on a day it is closed — not a class, not a progress update, not a
 * meeting.
 *
 * Pure and dependency-light on purpose. The check has to run in the browser (to
 * stop you picking a closed day) and on the server (to stop anything that skips
 * the UI), so nothing here may touch React or the database.
 *
 * Rows are accepted in either shape — camelCase as the API returns them, or raw
 * snake_case straight out of Postgres — because the server reads the table
 * directly while the client goes through `/api/new/operationals`.
 */

import { DAY_NAMES, isSameBranch } from '../utils/constants';

const rowBranch = (row) => row?.branchName ?? row?.branch_name ?? '';
const rowDay = (row) => row?.day ?? '';
const rowIsOpen = (row) => (row?.isOpen ?? row?.is_open) === true;

/** Rows belonging to one branch, tolerating casing and spacing differences. */
const rowsForBranch = (rules, branchName) => {
  if (!branchName) return [];
  return (rules || []).filter((r) => isSameBranch(rowBranch(r), branchName));
};

/**
 * Has this branch been configured at all?
 *
 * A branch with no rows is not "closed all week" — it simply has not been set up.
 * Treating it as closed would lock every newly added branch out of the whole app
 * until someone visited Operationals, so callers are expected to allow it. This
 * mirrors what the Schedule page's day picker already does.
 */
export function isBranchConfigured(rules, branchName) {
  return rowsForBranch(rules, branchName).length > 0;
}

/** The weekday names a branch is open, in week order. */
export function openDayNames(rules, branchName) {
  const rows = rowsForBranch(rules, branchName);
  const open = new Set(rows.filter(rowIsOpen).map(rowDay));
  return DAY_NAMES.filter((d) => open.has(d));
}

/**
 * 'open' | 'closed' | 'unconfigured'
 *
 * A configured branch with no row for the day counts as closed, not unconfigured:
 * Bintaro has rows for Tuesday to Sunday and none for Monday, and Monday is
 * genuinely shut. Only a branch with no rows at all is unconfigured.
 */
export function branchDayState(rules, branchName, day) {
  if (!branchName || !day) return 'unconfigured';
  const rows = rowsForBranch(rules, branchName);
  if (rows.length === 0) return 'unconfigured';
  const row = rows.find((r) => rowDay(r) === day);
  return row && rowIsOpen(row) ? 'open' : 'closed';
}

/** Convenience: is scheduling allowed? Unconfigured counts as allowed. */
export function canScheduleOn(rules, branchName, day) {
  return branchDayState(rules, branchName, day) !== 'closed';
}

/**
 * The weekday name of a "YYYY-MM-DD" date.
 *
 * Built from the parts rather than `new Date(iso)`, which parses a bare ISO date
 * as UTC and can land on the previous day west of Greenwich. Returns '' for
 * anything unparseable so callers can tell "no date yet" from "closed".
 */
export function dayNameOfISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return '';
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dt.getTime())) return '';
  // getDay() is Sunday-first; DAY_NAMES is Monday-first.
  const idx = dt.getDay();
  return idx === 0 ? 'Sunday' : DAY_NAMES[idx - 1];
}

/** "YYYY-MM-DD" for a Date, in local time. */
const isoOf = (dt) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

/**
 * Is this date one the branch is closed on?
 *
 * False when the date is unreadable or the branch is unconfigured, so a missing
 * setup never blocks the user.
 */
export function isClosedOnDate(rules, branchName, iso) {
  const day = dayNameOfISO(iso);
  if (!day) return false;
  return branchDayState(rules, branchName, day) === 'closed';
}

/**
 * The first date on or after `iso` that the branch is open, or '' if it is closed
 * all week. Searches two weeks, which is more than enough for a seven-day cycle
 * and terminates even when every day is shut.
 */
export function nextOpenDateFrom(rules, branchName, iso) {
  const open = openDayNames(rules, branchName);
  if (open.length === 0) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  const start = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date();
  for (let i = 0; i < 14; i += 1) {
    const probe = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const candidate = isoOf(probe);
    if (!isClosedOnDate(rules, branchName, candidate)) return candidate;
  }
  return '';
}

/**
 * Reason text for a refused day, shared by the UI and the API so both say the
 * same thing. Lists the open days, because "closed" without "so when?" just
 * moves the question along.
 */
export function closedDayMessage(rules, branchName, day) {
  const open = openDayNames(rules, branchName);
  const openText = open.length
    ? `Open ${open.map((d) => d.slice(0, 3)).join(', ')}.`
    : 'It has no open days configured.';
  return `${branchName} is closed on ${day}. ${openText}`;
}
