/**
 * Date utility functions for the schedule filter.
 */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Gets the date object for a given day of the current week.
 * Assumes Monday is the start of the week.
 * @param {string} dayName - e.g., 'Monday', 'Tuesday'
 * @returns {Date} The Date object for that day in the current week.
 */
export function getDateForCurrentWeekDay(dayName) {
  const dayIndex = DAY_NAMES.indexOf(dayName);
  if (dayIndex === -1) return new Date();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay; // Distance to this week's Monday
  
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);

  const targetDate = new Date(monday);
  targetDate.setDate(monday.getDate() + dayIndex);

  return targetDate;
}

/**
 * Checks if a specific day of the current week falls within a given date range.
 * @param {string} dayName - e.g., 'Monday'
 * @param {string} startDateStr - YYYY-MM-DD
 * @param {string} endDateStr - YYYY-MM-DD
 * @returns {boolean} True if the day falls within the range.
 */
export function isDayInLeaveRange(dayName, startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return false;

  const targetDate = getDateForCurrentWeekDay(dayName);
  const targetTime = targetDate.getTime();

  const start = new Date(startDateStr);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDateStr);
  end.setHours(23, 59, 59, 999);

  return targetTime >= start.getTime() && targetTime <= end.getTime();
}

/**
 * Determine whether a single leave record applies to a given weekday.
 *
 * Handles both leave shapes:
 *   - New:    { startDate, endDate }  → checked via isDayInLeaveRange
 *   - Legacy: { day }                 → simple equality
 *
 * Centralising this prevents the bug where features that only checked the
 * old `day` field treated date-range leaves as "not on leave".
 *
 * @param {{ day?: string, startDate?: string, endDate?: string }} leave
 * @param {string} dayName - e.g. 'Monday'
 * @returns {boolean}
 */
export function leaveAppliesToDay(leave, dayName) {
  if (!leave) return false;
  if (leave.startDate && leave.endDate) {
    return isDayInLeaveRange(dayName, leave.startDate, leave.endDate);
  }
  return leave.day === dayName;
}

/**
 * Build a Set of instructor names who are on leave for a given weekday,
 * across both leave shapes. Convenience wrapper around leaveAppliesToDay.
 *
 * @param {Array} leaveList
 * @param {string} dayName
 * @returns {Set<string>}
 */
export function instructorsOnLeaveForDay(leaveList = [], dayName) {
  const set = new Set();
  for (const l of leaveList) {
    if (leaveAppliesToDay(l, dayName)) set.add(l.name);
  }
  return set;
}

/**
 * Get an array of unique weekday names that fall within a given date range.
 * Skips Sundays (index 0).
 * @param {string} startDateStr - YYYY-MM-DD
 * @param {string} endDateStr - YYYY-MM-DD
 * @returns {string[]} Array of day names, e.g., ['Monday', 'Tuesday']
 */
export function getWeekdaysInRange(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return [];
  const start = new Date(startDateStr);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDateStr);
  end.setHours(23, 59, 59, 999);

  const weekdays = new Set();
  const cursor = new Date(start);

  while (cursor <= end) {
    const dayIndex = cursor.getDay();
    const dayName = dayIndex === 0 ? 'Sunday' : DAY_NAMES[dayIndex - 1];
    weekdays.add(dayName);
    cursor.setDate(cursor.getDate() + 1);
    if (weekdays.size === 7) break; // All possible weekdays found
  }

  return Array.from(weekdays);
}

/**
 * Parse a loose date string into a Date object at midnight.
 * Returns null if not a valid calendar date or if it's a lesson code.
 */
export function parseLooseDate(value) {
  const v = String(value || '').trim();
  if (!v || v === '-') return null;

  // If it's a pure lesson code like K1.10, CD1.1, it shouldn't be parsed as a date
  const isLessonCode = /^[A-Z]+\d.*\.\d+$/i.test(v) ||
                       /^(coder|trial|reg|k\d|kf\d|j\d|jf\d|cb\d|cd\d)/i.test(v);
  if (isLessonCode) return null;

  // Filter out general notes that don't look like dates
  const hasDigit = /\d/.test(v);
  const hasMonthWord = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)/i.test(v);
  if (!hasDigit && !hasMonthWord) return null;

  // 1. ISO format YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) {
    const d = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // 2. DMY / DM: e.g. 21/12/2025, 21-12, 21.12.25
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/.exec(v);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    let year = dmy[3] ? parseInt(dmy[3], 10) : new Date().getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  // 3. Try native Date parsing
  // Replace Indonesian month names with English ones for native parser
  let cleanVal = v;
  const idMonths = {
    mei: 'may', agustus: 'august', des: 'dec', desember: 'december',
    okt: 'oct', oktober: 'october', maret: 'march', juli: 'july'
  };
  for (const [id, en] of Object.entries(idMonths)) {
    cleanVal = cleanVal.replace(new RegExp(`\\b${id}\\b`, 'gi'), en);
  }

  // If there is no year explicitly written at the end of the value, append the current year
  const trimmedVal = cleanVal.replace(/[^a-z0-9]+$/i, ''); // remove trailing non-alphanumeric
  const hasYear = /\b(20\d{2}|\d{2})$/.test(trimmedVal);
  if (!hasYear) {
    const currentYear = new Date().getFullYear();
    cleanVal = `${cleanVal} ${currentYear}`;
  }

  const native = new Date(cleanVal);
  if (!isNaN(native.getTime())) {
    native.setHours(0, 0, 0, 0);
    return native;
  }

  return null;
}

/**
 * Get the Monday of the week for a given Date.
 */
export function getMondayOfDate(d) {
  const dateObj = new Date(d);
  dateObj.setHours(0, 0, 0, 0);
  const day = dateObj.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(dateObj);
  monday.setDate(dateObj.getDate() + diff);
  return monday;
}

/**
 * Format a week range label: e.g. "Week of 06 Jul - 12 Jul 2026"
 */
export function formatWeekRange(mondayDate) {
  const mon = new Date(mondayDate);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  const optionsShort = { day: '2-digit', month: 'short' };
  const optionsLong = { day: '2-digit', month: 'short', year: 'numeric' };

  if (mon.getFullYear() === sun.getFullYear()) {
    const startStr = mon.toLocaleDateString('en-US', optionsShort);
    const endStr = sun.toLocaleDateString('en-US', optionsLong);
    return `Week of ${startStr} - ${endStr}`;
  } else {
    const startStr = mon.toLocaleDateString('en-US', optionsLong);
    const endStr = sun.toLocaleDateString('en-US', optionsLong);
    return `Week of ${startStr} - ${endStr}`;
  }
}

