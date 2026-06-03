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
    if (dayIndex !== 0) { // skip Sunday
      weekdays.add(DAY_NAMES[dayIndex - 1]);
    }
    cursor.setDate(cursor.getDate() + 1);
    if (weekdays.size === 6) break; // All possible weekdays found
  }

  return Array.from(weekdays);
}
