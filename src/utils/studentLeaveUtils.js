/**
 * Utilities for Student Leave (Izin) management.
 * Handles parsing, formatting, and week/date evaluation for student leave records.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format ISO date string "YYYY-MM-DD" into human-friendly "D MMM YYYY" (e.g. "8 Sep 2026").
 */
export function formatDatePretty(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(monthIdx) || Number.isNaN(day) || monthIdx < 0 || monthIdx > 11) {
    return isoDate;
  }
  return `${day} ${MONTHS_SHORT[monthIdx]} ${year}`;
}

/**
 * Format ISO date string "YYYY-MM-DD" into short "D MMM" (e.g. "8 Sep").
 */
export function formatDateShort(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(monthIdx) || Number.isNaN(day) || monthIdx < 0 || monthIdx > 11) {
    return isoDate;
  }
  return `${day} ${MONTHS_SHORT[monthIdx]}`;
}

/**
 * Parses student leave information from a member/class row or remarks string.
 * Supports:
 * - `[Izin: 2026-09-08 to 2026-09-22 | Reason: Vacation]`
 * - `[Izin: 2026-09-08 to 2026-09-22]`
 * - `[Izin: 2026-09-08 | Sick]`
 * - `[Izin: 2026-09-08]`
 * - `Izin: 2026-09-08 to 2026-09-22`
 * - `Izin (2026-09-08 to 2026-09-22)`
 * - `Izin` (Generic / open-ended)
 * - `isIzin` / `notArranged` flags
 */
export function parseStudentLeave(memberOrRemarks) {
  const remarks = typeof memberOrRemarks === 'string'
    ? memberOrRemarks
    : (memberOrRemarks?.remarks || '');
  
  const isExplicitFlag = !!(
    memberOrRemarks &&
    typeof memberOrRemarks === 'object' &&
    (memberOrRemarks.isIzin === true || memberOrRemarks.notArranged === true)
  );

  const cleanRemarks = String(remarks || '').trim();

  // Pattern 1: Date Range with optional reason
  // e.g. [Izin: 2026-09-08 to 2026-09-22 | Family holiday] or Izin: 2026-09-08 - 2026-09-22
  const rangeRegex = /(?:\[\s*)?izin[:\s]+(\d{4}-\d{2}-\d{2})\s*(?:to|–|-|sampai)\s*(\d{4}-\d{2}-\d{2})(?:\s*(?:\||;|,|reason:|-)\s*([^\]\n]+))?(?:\s*\])?/i;
  const rangeMatch = cleanRemarks.match(rangeRegex);
  if (rangeMatch) {
    const startDate = rangeMatch[1];
    const endDate = rangeMatch[2];
    const reason = rangeMatch[3] ? rangeMatch[3].replace(/^reason:\s*/i, '').trim() : null;
    const sameDay = startDate === endDate;
    const displayText = sameDay
      ? formatDatePretty(startDate)
      : `${formatDatePretty(startDate)} – ${formatDatePretty(endDate)}`;
    const shortText = sameDay
      ? formatDateShort(startDate)
      : `${formatDateShort(startDate)} – ${formatDateShort(endDate)}`;

    return {
      isIzin: true,
      mode: sameDay ? 'single' : 'range',
      startDate,
      endDate,
      reason,
      displayText,
      shortText,
      rawTag: rangeMatch[0],
      isGeneric: false,
    };
  }

  // Pattern 2: Single Date with optional reason
  // e.g. [Izin: 2026-09-08 | Sick] or Izin (2026-09-08) or Izin: 2026-09-08
  const singleRegex = /(?:\[\s*)?izin[:\s(]+(\d{4}-\d{2}-\d{2})\)?(?:\s*(?:\||;|,|reason:|-)\s*([^\]\n]+))?(?:\s*\])?/i;
  const singleMatch = cleanRemarks.match(singleRegex);
  if (singleMatch) {
    const startDate = singleMatch[1];
    const reason = singleMatch[2] ? singleMatch[2].replace(/^reason:\s*/i, '').trim() : null;
    return {
      isIzin: true,
      mode: 'single',
      startDate,
      endDate: startDate,
      reason,
      displayText: formatDatePretty(startDate),
      shortText: formatDateShort(startDate),
      rawTag: singleMatch[0],
      isGeneric: false,
    };
  }

  // Pattern 3: Generic Izin without dates (e.g. "[Izin]" or "Izin" or remarks containing "izin" or isExplicitFlag)
  if (isExplicitFlag || /\bizin\b/i.test(cleanRemarks)) {
    // Extract any reason if present like "[Izin: Sick]"
    const genericReasonMatch = cleanRemarks.match(/\[\s*izin[:\s]+([^\]\d][^\]]*)\]/i);
    const reason = genericReasonMatch ? genericReasonMatch[1].trim() : null;
    return {
      isIzin: true,
      mode: 'indefinite',
      startDate: null,
      endDate: null,
      reason,
      displayText: 'All Weeks (Indefinite)',
      shortText: 'Indefinite',
      rawTag: genericReasonMatch ? genericReasonMatch[0] : (cleanRemarks.includes('Izin') ? 'Izin' : ''),
      isGeneric: true,
    };
  }

  return {
    isIzin: false,
    mode: null,
    startDate: null,
    endDate: null,
    reason: null,
    displayText: '',
    shortText: '',
    rawTag: '',
    isGeneric: false,
  };
}

/**
 * Checks if a member is on leave on a specific session date ("YYYY-MM-DD").
 */
export function isMemberOnLeaveOnDate(memberOrRemarks, dateISO) {
  const leave = parseStudentLeave(memberOrRemarks);
  if (!leave.isIzin) return false;
  if (leave.isGeneric || !dateISO) return true;
  if (!leave.startDate) return true;
  const end = leave.endDate || leave.startDate;
  return dateISO >= leave.startDate && dateISO <= end;
}

/**
 * Formats a leave declaration into structured remarks while preserving other notes.
 *
 * @param {Object} leaveData - { mode: 'single'|'range'|'indefinite', startDate, endDate, reason, isIzin }
 * @param {string} existingRemarks - Existing remarks string on the class row
 * @returns {string} Updated remarks string
 */
export function formatStudentLeaveRemark(leaveData, existingRemarks = '') {
  const cleaned = clearStudentLeaveRemark(existingRemarks);
  
  if (!leaveData || !leaveData.isIzin) {
    return cleaned;
  }

  const { mode, startDate, endDate, reason } = leaveData;
  const reasonSuffix = reason && reason.trim() ? ` | Reason: ${reason.trim()}` : '';

  let tag = '';
  if (mode === 'range' && startDate && endDate && startDate !== endDate) {
    tag = `[Izin: ${startDate} to ${endDate}${reasonSuffix}]`;
  } else if ((mode === 'single' || !endDate || startDate === endDate) && startDate) {
    tag = `[Izin: ${startDate}${reasonSuffix}]`;
  } else {
    tag = `[Izin${reasonSuffix}]`;
  }

  return cleaned ? `${cleaned} ${tag}`.trim() : tag;
}

/**
 * Removes any Izin tags from a remarks string while preserving other notes (e.g. "Term 3 - L2", Zoho links).
 */
export function clearStudentLeaveRemark(remarks = '') {
  if (!remarks || typeof remarks !== 'string') return '';
  return remarks
    // Remove bracketed Izin tags e.g. [Izin: 2026-09-08 to 2026-09-22 | Reason: ...]
    .replace(/\[\s*izin[^\]]*\]/gi, '')
    // Remove unbracketed Izin date range expressions
    .replace(/\bizin[:\s]+\d{4}-\d{2}-\d{2}\s*(?:to|–|-|sampai)\s*\d{4}-\d{2}-\d{2}(?:\s*(?:\||;)\s*[^,\n]+)?/gi, '')
    // Remove unbracketed Izin single date expressions
    .replace(/\bizin[:\s(]+\d{4}-\d{2}-\d{2}\)?/gi, '')
    // Remove standalone word "Izin" or "izin"
    .replace(/\bizin\b/gi, '')
    // Clean up multiple spaces and empty separators
    .replace(/\s*\|\s*\|\s*/g, ' | ')
    .replace(/^\s*\|\s*/g, '')
    .replace(/\s*\|\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
