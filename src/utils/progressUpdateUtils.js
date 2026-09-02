import { parseProgram, CATEGORY_LEVELS } from '../lib/programRules';
import { studentProgramCategory } from '../lib/studentFilter';

export const PROGRESS_UPDATE_STATUSES = {
  NEED_UPDATE: 'Need update progress',
  UPDATE_OFFER: 'Update Offer',
  UPDATE_SCHEDULED: 'Update Scheduled',
  UPDATE_RESCHEDULE: 'Update Reschedule',
  UPDATE_DONE: 'Update Done',
  WAIT_PAYMENT: 'Wait Payment',
  COMPLETED: 'Completed',
};

export const PROGRESS_UPDATE_BADGES = {
  'Need update progress': {
    label: 'Need update progress',
    shortLabel: 'Need Update',
    description: 'Attendance reached 7 lessons. Progress update notification.',
    bg: '#fef3c7',
    color: '#b45309',
    borderColor: '#f59e0b',
  },
  'Update Offer': {
    label: 'Update Offer',
    shortLabel: 'Update Offer',
    description: 'SPA already contact parent to choose schedule.',
    bg: '#eff6ff',
    color: '#1d4ed8',
    borderColor: '#3b82f6',
  },
  'Update Scheduled': {
    label: 'Update Scheduled',
    shortLabel: 'Scheduled',
    description: 'Parent agreed schedule offer. Instructor informed.',
    bg: '#f3e8ff',
    color: '#6d28d9',
    borderColor: '#8b5cf6',
  },
  'Update Reschedule': {
    label: 'Update Reschedule',
    shortLabel: 'Reschedule',
    description: 'Parent cannot attend scheduled time. Needs rescheduling.',
    bg: '#fff1f2',
    color: '#be123c',
    borderColor: '#f43f5e',
  },
  'Update Done': {
    label: 'Update Done',
    shortLabel: 'Update Done',
    description: 'Instructor updated progress. SPA to send invoice to parent.',
    bg: '#ecfdf5',
    color: '#047857',
    borderColor: '#10b981',
    nextAction: 'Send invoice / Confirm continuation',
  },
  'Wait Payment': {
    label: 'Wait Payment',
    shortLabel: 'Wait Payment',
    description: 'SPA waiting for parent to pay next term subscription.',
    bg: '#fff7ed',
    color: '#c2410c',
    borderColor: '#f97316',
    nextAction: 'Confirm continuation once payment received',
  },
  'Completed': {
    label: 'Completed',
    shortLabel: 'Completed',
    description: 'Progress update process completed.',
    bg: '#f1f5f9',
    color: '#475569',
    borderColor: '#cbd5e1',
  },
};

/**
 * Determine progress update status for a student.
 * 
 * Auto-trigger rules:
 * - Kinder & Junior: Attendance count >= 7
 * - Coder (12 meetings total): Attendance count >= 9 (meeting 9)
 * 
 * @param {object} studentOrMember student or roster member record
 * @param {object} [liveProgressRecord] optional live progress record from /api/new/live-progress
 * @returns {string|null} status string or null if none
 */
export function getProgressUpdateStatus(studentOrMember, liveProgressRecord = null) {
  if (!studentOrMember) return null;

  // Explicit status override takes priority
  const explicitStatus =
    studentOrMember.progressUpdateStatus ||
    studentOrMember.progress_update_status ||
    liveProgressRecord?.progressUpdateStatus ||
    liveProgressRecord?.progress_update_status;

  if (explicitStatus && explicitStatus !== 'auto') {
    if (explicitStatus === 'Completed' || explicitStatus === 'None' || explicitStatus === 'Done') {
      return null;
    }
    return explicitStatus;
  }

  // Program category & attendance count
  const rawProgram = studentOrMember.program || studentOrMember.level || '';
  const parsed = parseProgram(rawProgram);
  const category = parsed.category || studentProgramCategory(studentOrMember) || 'Kinder';

  let attendanceCount = 0;
  if (liveProgressRecord?.attendance) {
    attendanceCount = Object.keys(liveProgressRecord.attendance).length;
  } else if (studentOrMember.attendanceCount != null) {
    attendanceCount = Number(studentOrMember.attendanceCount);
  } else if (studentOrMember.attendance != null && typeof studentOrMember.attendance === 'object') {
    attendanceCount = Object.keys(studentOrMember.attendance).length;
  } else if (parsed.lesson != null) {
    attendanceCount = Number(parsed.lesson);
  } else {
    const match = String(rawProgram).match(/\.(\d+)$|(\d+)$/);
    if (match) {
      attendanceCount = Number(match[1] || match[2]);
    }
  }

  const threshold = category === 'Coder' ? 9 : 7;
  if (attendanceCount >= threshold) {
    return PROGRESS_UPDATE_STATUSES.NEED_UPDATE;
  }

  return null;
}

/**
 * Suggest next program code (e.g. K1.10 -> K2, J1.10 -> J2, Coder Basic -> Coder Intermediate).
 * Target program represents the term of the program name (e.g. K1, K2, J1, J2, Coder Basic).
 */
export function suggestNextProgramCode(currentCode, category = 'Kinder') {
  if (!currentCode || typeof currentCode !== 'string') return '';
  const parsed = parseProgram(currentCode);
  const baseCode = parsed.code || currentCode.trim();
  const cat = parsed.category || category || 'Kinder';

  const levels = CATEGORY_LEVELS[cat] || [];
  const idx = levels.findIndex((lvl) => lvl.toLowerCase() === baseCode.toLowerCase());

  if (idx !== -1 && idx < levels.length - 1) {
    return levels[idx + 1];
  }

  return baseCode;
}

/**
 * Construct an archived term history record snapshot.
 */
export function buildTermHistoryEntry({
  termName = '',
  termNumber = 1,
  program = '',
  category = 'Kinder',
  startDate = null,
  completedDate = null,
  attendedCount = 0,
  totalMeetings = 10,
  attendance = {},
  paymentType = 'Upfront Paid',
  spaNote = '',
  confirmedBy = 'SPA Staff',
}) {
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return {
    id: `term_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    termName: termName || `Term ${termNumber}`,
    termNumber: Number(termNumber) || 1,
    program: String(program || '').trim(),
    category: category || 'Kinder',
    startDate: startDate || null,
    completedDate: completedDate || todayISO,
    attendedCount: Number(attendedCount) || 0,
    totalMeetings: Number(totalMeetings) || 10,
    attendance: attendance ? JSON.parse(JSON.stringify(attendance)) : {},
    paymentType: paymentType || 'Upfront Paid',
    spaNote: String(spaNote || '').trim(),
    confirmedBy: String(confirmedBy || 'SPA Staff').trim(),
    confirmedAt: now.toISOString(),
  };
}
