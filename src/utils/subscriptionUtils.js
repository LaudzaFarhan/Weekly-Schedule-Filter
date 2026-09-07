/**
 * Subscription Utility Functions
 *
 * Business Rule:
 * Standard subscription = 3 Months (12 meetings total, 1 meeting/week = 7 days per meeting).
 * Predicted End Date = First Meeting Date + (Target Meetings * 7 days) + 14 days (2-week buffer for absences).
 * Overdue: Current Date > Predicted End Date AND Attended Meetings < Target Meetings.
 *
 * Two ways of selling the same thing, so the unit depends on the category:
 * Kinder and Junior are bought by the term (ten meetings each, any number of
 * terms), Coder by the month. Everything downstream still works in meetings —
 * terms are how the number is chosen and described, not a second stored field.
 */

import { LESSONS_PER_LEVEL, meetingsForSubscription } from '../lib/programRules';

export const DEFAULT_TARGET_MEETINGS = 12; // 3-month package
export const BUFFER_WEEKS = 2; // 14 days buffer for missed/sick days

/**
 * Meetings in one Kinder/Junior term.
 *
 * A term is a level (K1..K4, J1..J4) and a level is ten lessons, so this is
 * `LESSONS_PER_LEVEL` rather than a second literal 10 that could drift away
 * from the curriculum rules.
 */
export const MEETINGS_PER_TERM = LESSONS_PER_LEVEL;

/**
 * Which categories sell by term rather than by month.
 *
 * Kinder and Junior progress term by term, ten meetings each, so a parent buys
 * "two more terms" and not "twenty more meetings". Coder has no terms — it is
 * bought as a month-length package and extended with top-ups.
 *
 * @param {string} category
 * @returns {boolean}
 */
export function isTermBasedCategory(category) {
  const cat = String(category || '').trim().toLowerCase();
  return cat.includes('kinder') || cat.includes('junior');
}

/** Meetings a given number of terms buys. */
export function meetingsForTerms(terms) {
  return (Number(terms) || 0) * MEETINGS_PER_TERM;
}

/**
 * Terms a meeting count corresponds to, or `null` when it does not divide
 * evenly — a target of 25 is not "two and a half terms", it is a target that no
 * whole number of terms produced, and saying so is more useful than rounding.
 *
 * @param {number} meetings
 * @returns {number|null}
 */
export function termsFromMeetings(meetings) {
  const count = Number(meetings) || 0;
  if (count <= 0 || count % MEETINGS_PER_TERM !== 0) return null;
  return count / MEETINGS_PER_TERM;
}

/** Term counts offered in the picker before the custom field is needed. */
export const TERM_PACKAGE_COUNTS = [1, 2, 3, 4];

/** How many terms a Kinder/Junior student may be sold in one package. */
export const MAX_TERMS = 12;

/** Plural-safe "1 Term" / "3 Terms". */
function termWord(terms) {
  return `${terms} Term${terms === 1 ? '' : 's'}`;
}

/**
 * The Coder package lengths, in the order a parent is offered them.
 *
 * The meeting count for each comes from `meetingsForSubscription`, so the label
 * and the number can no longer disagree. They did: this list used to hardcode
 * "1 Year Package (36 Meetings)" while the rules said a year is 48, and 36 is
 * actually the nine-month figure. Anyone sold a year was given three months
 * short.
 */
const CODER_PACKAGE_DURATIONS = ['1 Month', '3 Months', '6 Months', '9 Months', '1 Year'];

/** The package a parent is steered towards when nothing else is specified. */
const STANDARD_DURATION = '3 Months';

/**
 * The month-length packages, for categories that are sold that way.
 *
 * Exported rather than written inline in the package `<select>` so the payment
 * ledger and the picker cannot drift: a recorded payment's label is looked up
 * from this same list.
 *
 * The legacy ten stays on the end because `packageLabelFor` reads this list to
 * name an existing payment. Drop an entry and every payment recorded at that
 * size silently degrades to "Top-Up".
 */
export const SUBSCRIPTION_PACKAGES = [
  ...CODER_PACKAGE_DURATIONS.map((duration) => {
    const meetings = meetingsForSubscription(duration, 'Coder');
    const suffix = duration === STANDARD_DURATION ? ' - Standard' : '';
    return {
      meetings,
      duration,
      label: `${duration} Package (${meetings} Meetings${suffix})`,
    };
  }),
  { meetings: 10, label: '10 Meetings (Legacy short package)' },
];

/** The term packages, derived so the ten stays in one place. */
export const TERM_PACKAGES = TERM_PACKAGE_COUNTS.map((terms) => ({
  terms,
  meetings: meetingsForTerms(terms),
  label: `${termWord(terms)} (${meetingsForTerms(terms)} Meetings)`,
}));

/**
 * The packages to offer a student in `category`.
 *
 * @param {string} category  'Kinder' | 'Junior' | 'Coder'
 * @returns {Array<{ meetings: number, label: string, terms?: number }>}
 */
export function packagesForCategory(category) {
  return isTermBasedCategory(category) ? TERM_PACKAGES : SUBSCRIPTION_PACKAGES;
}

/**
 * The preset top-up sizes for a category, in meetings.
 *
 * Kinder and Junior top up by the term, so their presets are whole terms. Coder
 * tops up by the meeting.
 *
 * @param {string} category
 * @returns {number[]}
 */
export function topUpPresetsFor(category) {
  return isTermBasedCategory(category)
    ? [1, 2, 4].map(meetingsForTerms)
    : [4, 8, 12];
}

/**
 * Calculate the sequence of academic terms covered by a package.
 *
 * Each academic year contains 4 terms (Term 1..4).
 * If a package spans beyond Term 4 of a year, it rolls over into Term 1 of the following year.
 *
 * @param {number} startTerm - 1, 2, 3, or 4
 * @param {number} startYear - e.g. 2026
 * @param {number} termCount - number of terms (e.g. 1, 2, 3, 4...)
 * @returns {Array<{ termNumber: number, year: number, label: string, fullLabel: string }>}
 */
export function calculateCoveredTerms(startTerm = 1, startYear = new Date().getFullYear(), termCount = 1) {
  const sTerm = Math.max(1, Math.min(4, parseInt(startTerm, 10) || 1));
  const sYear = parseInt(startYear, 10) || new Date().getFullYear();
  const count = Math.max(0, parseInt(termCount, 10) || 0);

  const covered = [];
  for (let i = 0; i < count; i++) {
    const totalTermIndex = (sTerm - 1) + i;
    const termNumber = (totalTermIndex % 4) + 1;
    const year = sYear + Math.floor(totalTermIndex / 4);
    covered.push({
      termNumber,
      year,
      label: `T${termNumber} ${year}`,
      fullLabel: `Term ${termNumber} (${year})`,
    });
  }
  return covered;
}

/**
 * Format covered terms into a human-friendly string.
 *
 * Examples:
 * - 1 term: "Term 3 (2026)"
 * - 2 terms: "Term 3 & Term 4 (2026)"
 * - 3 terms in same year: "Term 1, Term 2 & Term 3 (2026)"
 * - crossing year: "Term 3 & Term 4 (2026), Term 1 (2027)"
 *
 * @param {Array<{ termNumber: number, year: number }>} coveredTerms
 * @returns {string}
 */
export function formatCoveredTermsSummary(coveredTerms) {
  if (!Array.isArray(coveredTerms) || coveredTerms.length === 0) return '';
  if (coveredTerms.length === 1) {
    return `Term ${coveredTerms[0].termNumber} (${coveredTerms[0].year})`;
  }

  // Group terms by year preserving order
  const byYear = new Map();
  for (const t of coveredTerms) {
    if (!byYear.has(t.year)) byYear.set(t.year, []);
    byYear.get(t.year).push(t.termNumber);
  }

  const parts = [];
  for (const [year, termNums] of byYear.entries()) {
    if (termNums.length === 1) {
      parts.push(`Term ${termNums[0]} (${year})`);
    } else if (termNums.length === 2) {
      parts.push(`Term ${termNums[0]} & Term ${termNums[1]} (${year})`);
    } else {
      const allExceptLast = termNums.slice(0, -1).map((n) => `Term ${n}`).join(', ');
      parts.push(`${allExceptLast} & Term ${termNums[termNums.length - 1]} (${year})`);
    }
  }

  return parts.join(', ');
}

/**
 * Infer the starting term and year for a student subscription.
 *
 * Priority:
 * 1. From existing paid terms (`internal_student_terms`): find latest paid (year, termNumber),
 *    step to next term.
 * 2. From student's level or program text (e.g. "K3" -> Term 3, "J2" -> Term 2).
 * 3. From liveProgress.termHistory length: if 2 terms completed, next is Term 3.
 * 4. Fallback: Term 1, current calendar year (or student's start year).
 *
 * @param {Object} params
 * @param {Object} [params.student] - student row (id, level, startDateStr, etc.)
 * @param {Object} [params.liveProgress] - student's live progress record
 * @param {Array} [params.existingTerms] - rows from internal_student_terms
 * @param {number} [params.defaultYear]
 * @returns {{ termNumber: number, year: number, source: string }}
 */
export function inferStartingTerm({ student = {}, liveProgress = null, existingTerms = [], defaultYear = new Date().getFullYear() } = {}) {
  const currentYear = student?.startDateStr
    ? new Date(student.startDateStr).getFullYear() || defaultYear
    : defaultYear;

  // 1. Check existingTerms (from internal_student_terms)
  if (Array.isArray(existingTerms) && existingTerms.length > 0) {
    const paidTerms = existingTerms
      .filter((t) => t.paid === true && Number.isInteger(t.termNumber) && Number.isInteger(t.year))
      .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.termNumber - b.termNumber));

    if (paidTerms.length > 0) {
      const latest = paidTerms[paidTerms.length - 1];
      const nextTermNumber = (latest.termNumber % 4) + 1;
      const nextYear = latest.termNumber === 4 ? latest.year + 1 : latest.year;
      return {
        termNumber: nextTermNumber,
        year: nextYear,
        source: `Next term after paid Term ${latest.termNumber} (${latest.year})`,
      };
    }
  }

  // 2. Check liveProgress.termHistory
  if (liveProgress && Array.isArray(liveProgress.termHistory) && liveProgress.termHistory.length > 0) {
    const count = liveProgress.termHistory.length;
    const termNum = (count % 4) + 1;
    const yearOffset = Math.floor(count / 4);
    return {
      termNumber: termNum,
      year: currentYear + yearOffset,
      source: `Continuation after ${count} completed term${count === 1 ? '' : 's'} in history`,
    };
  }

  // 3. Check student level / program code
  const levelText = `${student?.level || ''} ${liveProgress?.programCode || ''} ${liveProgress?.program || ''}`;
  const termMatch = levelText.match(/Term\s*([1-4])/i) || levelText.match(/\bT([1-4])\b/i) || levelText.match(/\b[A-Za-z]{1,2}([1-4])\b/);
  if (termMatch && termMatch[1]) {
    const termNum = parseInt(termMatch[1], 10);
    if (termNum >= 1 && termNum <= 4) {
      return {
        termNumber: termNum,
        year: currentYear,
        source: `Inferred from student level "${student?.level || liveProgress?.programCode}"`,
      };
    }
  }

  // 4. Default fallback
  return {
    termNumber: 1,
    year: currentYear,
    source: 'Default starting term',
  };
}

/**
 * What to call a payment of `meetings` meetings for a student in `category`.
 *
 * A payment that matches a catalogue package is named after it; anything else is
 * described as a top-up, which is what an off-catalogue number is in practice.
 *
 * @param {number} meetings
 * @param {string} [category]
 * @param {string} [coveredSummary] optional term coverage string e.g. "Term 3 & Term 4 2026"
 * @returns {string}
 */
export function packageLabelFor(meetings, category, coveredSummary) {
  const count = Number(meetings) || 0;
  if (isTermBasedCategory(category)) {
    const terms = termsFromMeetings(count);
    // A whole number of terms is named as terms; a leftover count is not forced
    // into a term it does not fill.
    if (terms) {
      if (coveredSummary) {
        const cleanSummary = String(coveredSummary).replace(/[()]/g, '').trim();
        return `${termWord(terms)} (${cleanSummary}) — ${count} Meetings`;
      }
      return `${termWord(terms)} (${count} Meetings)`;
    }
    return `Top-Up (+${count} Meetings)`;
  }
  const known = SUBSCRIPTION_PACKAGES.find((p) => p.meetings === count);
  return known ? known.label : `Top-Up (+${count} Meetings)`;
}

/**
 * Today as `YYYY-MM-DD` in the browser's own time zone.
 *
 * Local rather than UTC on purpose: a payment entered on a Jakarta evening
 * (UTC+7) would otherwise be filed under the previous day.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function todayISO(now = new Date()) {
  return formatDateISO(now);
}

/**
 * Total meetings a student has paid for, across every recorded payment.
 *
 * @param {Array<{ meetings: number }>} payments
 * @returns {number}
 */
export function totalMeetingsPaid(payments) {
  return (payments || []).reduce((sum, p) => sum + (Number(p?.meetings) || 0), 0);
}

/**
 * Is this a link that is safe to render and follow?
 *
 * `http:` and `https:` only. The invoice link is turned into an anchor, so a
 * `javascript:` or `data:` value would be executable content rather than an
 * address. The API enforces the same rule — this exists so the form can say no
 * before a round trip, not instead of the server check.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    const { protocol } = new URL(text);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

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
