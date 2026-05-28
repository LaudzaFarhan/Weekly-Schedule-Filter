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
