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
 * Detect whether completing this level constitutes graduating from a module.
 * - Kinder: K4 (Kinder T4) graduates to Junior (Junior Core J1 or Junior Foundation JF1)
 * - Junior: J4 (Junior T4) graduates to Coder (Coder Basic)
 * - Coder: Coder Advance
 */
export function isModuleGraduationLevel(currentCode, category = 'Kinder') {
  if (!currentCode) return false;
  const parsed = parseProgram(currentCode);
  const code = (parsed.code || currentCode).trim().toUpperCase();
  const cat = (parsed.category || category || '').toLowerCase();

  if (cat.includes('kinder') && (code === 'K4' || code.startsWith('K4.'))) {
    return true;
  }
  if (cat.includes('junior') && (code === 'J4' || code.startsWith('J4.'))) {
    return true;
  }
  if (cat.includes('coder') && code === 'CODER ADVANCE') {
    return true;
  }
  return false;
}

/**
 * Return graduation metadata including target category and options.
 */
export function getModuleGraduationInfo(currentCode, category = 'Kinder') {
  const isGrad = isModuleGraduationLevel(currentCode, category);
  const parsed = parseProgram(currentCode);
  const cat = (parsed.category || category || 'Kinder');

  if (cat.toLowerCase().includes('kinder') && isGrad) {
    return {
      isGraduation: true,
      currentCategory: 'Kinder',
      graduatedModule: 'Kinder Core (K4 / T4)',
      nextCategory: 'Junior',
      defaultProgram: 'J1',
      options: [
        { code: 'J1', label: 'Junior Core (J1)', category: 'Junior' },
        { code: 'JF1', label: 'Junior Foundation (JF1)', category: 'Junior' },
        { code: 'JF2', label: 'Junior Foundation (JF2)', category: 'Junior' },
        { code: 'J2', label: 'Junior Core (J2)', category: 'Junior' },
      ],
      notice: '🎓 Student completed Kinder T4 (K4). Ready to graduate to Junior Program (Junior Core or Junior Foundation).',
    };
  }

  if (cat.toLowerCase().includes('junior') && isGrad) {
    return {
      isGraduation: true,
      currentCategory: 'Junior',
      graduatedModule: 'Junior Core (J4 / T4)',
      nextCategory: 'Coder',
      defaultProgram: 'Coder Basic',
      options: [
        { code: 'Coder Basic', label: 'Coder Basic', category: 'Coder' },
        { code: 'Coder Intermediate', label: 'Coder Intermediate', category: 'Coder' },
      ],
      notice: '🎓 Student completed Junior T4 (J4). Ready to graduate to Coder Program (Coder Basic).',
    };
  }

  return {
    isGraduation: false,
    currentCategory: cat,
    graduatedModule: null,
    nextCategory: cat,
    defaultProgram: suggestNextProgramCode(currentCode, category),
    options: (CATEGORY_LEVELS[cat] || []).map((lvl) => ({ code: lvl, label: lvl, category: cat })),
    notice: null,
  };
}

/**
 * Suggest next program code (e.g. K1.10 -> K2, K4 -> J1, J1.10 -> J2, J4 -> Coder Basic, Coder Basic -> Coder Intermediate).
 * Target program represents the term of the program name (e.g. K1, K2, J1, J2, Coder Basic).
 */
export function suggestNextProgramCode(currentCode, category = 'Kinder') {
  if (!currentCode || typeof currentCode !== 'string') return '';
  const parsed = parseProgram(currentCode);
  const baseCode = (parsed.code || currentCode).trim();
  const cat = parsed.category || category || 'Kinder';

  // Check graduation milestone first
  if (cat.toLowerCase().includes('kinder') && baseCode.toUpperCase() === 'K4') {
    return 'J1'; // Default graduation to Junior Core
  }
  if (cat.toLowerCase().includes('junior') && baseCode.toUpperCase() === 'J4') {
    return 'Coder Basic'; // Default graduation to Coder
  }

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
  graduationStatus = 'Regular', // 'Regular' | 'Graduated' | 'Skipped'
  graduationNote = '',
  nextCategory = null,
  nextProgram = '',
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
    graduationStatus: graduationStatus || 'Regular',
    graduationNote: graduationNote || '',
    nextCategory: nextCategory || null,
    nextProgram: nextProgram || '',
  };
}
