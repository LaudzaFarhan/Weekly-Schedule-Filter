/**
 * Subscription Utility Functions
 *
 * Business Rule:
 * Standard subscription = 3 Months (12 meetings total, 1 meeting/week = 7 days per meeting).
 * Predicted End Date = First Meeting Date + (Target Meetings * 7 days) + 14 days (2-week buffer for absences).
 * Overdue: Current Date > Predicted End Date AND Attended Meetings < Target Meetings.
 */

export const DEFAULT_TARGET_MEETINGS = 12; // 3-month package
export const BUFFER_WEEKS = 2; // 14 days buffer for missed/sick days

/**
 * Calculate predicted end date for a student subscription.
 * @param {string|Date} startDateStr - The date of the 1st meeting (YYYY-MM-DD)
 * @param {number} targetMeetings - Total meetings in package (default 12)
 * @param {number} bufferWeeks - Allowance buffer in weeks (default 2)
 * @returns {Date|null}
 */
export function calculatePredictedEndDate(startDateStr, targetMeetings = DEFAULT_TARGET_MEETINGS, bufferWeeks = BUFFER_WEEKS) {
  if (!startDateStr) return null;
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return null;

  const totalDays = (targetMeetings * 7) + (bufferWeeks * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + totalDays);
  return end;
}

/**
 * Format a Date object to YYYY-MM-DD
 */
export function formatDateISO(date) {
  if (!date || isNaN(new Date(date).getTime())) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a Date object to human readable string e.g. "Jan 15, 2026"
 */
export function formatDateFriendly(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Calculate subscription status: Active, Ending Soon, Overdue, or Completed
 * @param {Object} params
 * @param {string|Date} params.startDateStr - First meeting date
 * @param {number} params.targetMeetings - Package meetings count (default 12)
 * @param {number} params.attendedCount - Meetings attended so far
 * @param {Date} [params.currentDate] - Current date reference
 * @returns {{ status: string, isOverdue: boolean, daysRemaining: number, predictedEndDate: Date|null }}
 */
export function calculateSubscriptionStatus({
  startDateStr,
  targetMeetings = DEFAULT_TARGET_MEETINGS,
  attendedCount = 0,
  currentDate = new Date(),
}) {
  const attended = Math.max(0, Number(attendedCount) || 0);
  const target = Math.max(1, Number(targetMeetings) || DEFAULT_TARGET_MEETINGS);

  if (attended >= target) {
    return {
      status: 'Completed',
      isOverdue: false,
      daysRemaining: 0,
      predictedEndDate: calculatePredictedEndDate(startDateStr, target),
    };
  }

  if (!startDateStr) {
    return {
      status: 'Active',
      isOverdue: false,
      daysRemaining: 0,
      predictedEndDate: null,
    };
  }

  const predictedEnd = calculatePredictedEndDate(startDateStr, target);
  if (!predictedEnd) {
    return {
      status: 'Active',
      isOverdue: false,
      daysRemaining: 0,
      predictedEndDate: null,
    };
  }

  const now = new Date(currentDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = new Date(predictedEnd.getFullYear(), predictedEnd.getMonth(), predictedEnd.getDate());

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysDiff = Math.ceil((endDate - today) / msPerDay);

  if (daysDiff < 0) {
    return {
      status: 'Overdue',
      isOverdue: true,
      daysRemaining: daysDiff,
      predictedEndDate: predictedEnd,
    };
  }

  const remainingMeetings = target - attended;
  if (daysDiff <= 14 || remainingMeetings <= 2) {
    return {
      status: 'Ending Soon',
      isOverdue: false,
      daysRemaining: daysDiff,
      predictedEndDate: predictedEnd,
    };
  }

  return {
    status: 'Active',
    isOverdue: false,
    daysRemaining: daysDiff,
    predictedEndDate: predictedEnd,
  };
}

/**
 * Extract total attended count and first meeting date from live progress record
 */
export function parseProgressDetails(liveProgressRecord) {
  if (!liveProgressRecord || !liveProgressRecord.attendance) {
    return { attendedCount: 0, firstMeetingDate: null };
  }

  const entries = Object.entries(liveProgressRecord.attendance)
    .filter(([_, entry]) => !!entry)
    .map(([lessonNum, entry]) => ({
      lesson: Number(lessonNum),
      date: entry.date ? new Date(entry.date) : null,
      dateStr: entry.date || null,
    }));

  const attendedCount = entries.length;

  const validDates = entries
    .filter((e) => e.date && !isNaN(e.date.getTime()))
    .sort((a, b) => a.date - b.date);

  const firstMeetingDate = validDates.length > 0 ? validDates[0].dateStr : null;

  return { attendedCount, firstMeetingDate };
}
