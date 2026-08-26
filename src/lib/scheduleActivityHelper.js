/**
 * Utility functions for schedule activity logging and diff parsing.
 *
 * Tracks changes to Teacher, Slot (Time), Days, Program, Branch, Class Type,
 * and Student across schedule additions, edits, moves, and deletions.
 */

const normalizeStr = (val) => (val === null || val === undefined ? '' : String(val).trim());

/**
 * Compare previous and updated schedule records and produce field-level diffs.
 *
 * @param {object} prev Original class state
 * @param {object} next Updated class state
 * @returns {Array<{field: string, before: string, after: string}>}
 */
export function computeScheduleDiff(prev = {}, next = {}) {
  const changes = [];
  if (!prev || !next) return changes;

  const prevTeacher = normalizeStr(prev.teacher) || 'Unassigned';
  const nextTeacher = normalizeStr(next.teacher) || 'Unassigned';
  if (prevTeacher.toLowerCase() !== nextTeacher.toLowerCase()) {
    changes.push({ field: 'Teacher', before: prevTeacher, after: nextTeacher });
  }

  const prevTime = normalizeStr(prev.time);
  const nextTime = normalizeStr(next.time);
  if (prevTime && nextTime && prevTime.toLowerCase() !== nextTime.toLowerCase()) {
    changes.push({ field: 'Slot', before: prevTime, after: nextTime });
  }

  const prevDay = normalizeStr(prev.day);
  const nextDay = normalizeStr(next.day);
  if (prevDay && nextDay && prevDay.toLowerCase() !== nextDay.toLowerCase()) {
    changes.push({ field: 'Day', before: prevDay, after: nextDay });
  }

  const prevProg = normalizeStr(prev.program);
  const nextProg = normalizeStr(next.program);
  if (prevProg && nextProg && prevProg.toLowerCase() !== nextProg.toLowerCase()) {
    changes.push({ field: 'Program', before: prevProg, after: nextProg });
  }

  const prevBranch = normalizeStr(prev.branchName || prev.branch);
  const nextBranch = normalizeStr(next.branchName || next.branch);
  if (prevBranch && nextBranch && prevBranch.toLowerCase() !== nextBranch.toLowerCase()) {
    changes.push({ field: 'Branch', before: prevBranch, after: nextBranch });
  }

  const prevType = normalizeStr(prev.classType) || 'Regular';
  const nextType = normalizeStr(next.classType) || 'Regular';
  if (prevType.toLowerCase() !== nextType.toLowerCase()) {
    changes.push({ field: 'Type', before: prevType, after: nextType });
  }

  const prevStudent = normalizeStr(prev.student);
  const nextStudent = normalizeStr(next.student);
  if (prevStudent && nextStudent && prevStudent.toLowerCase() !== nextStudent.toLowerCase()) {
    changes.push({ field: 'Student', before: prevStudent, after: nextStudent });
  }

  const prevRemarks = normalizeStr(prev.remarks);
  const nextRemarks = normalizeStr(next.remarks);
  if (prevRemarks !== nextRemarks && (prevRemarks || nextRemarks)) {
    changes.push({ field: 'Remarks', before: prevRemarks || 'None', after: nextRemarks || 'None' });
  }

  return changes;
}

/**
 * Format human-readable activity log summary text.
 */
export function formatScheduleActivitySummary(action, options = {}) {
  const {
    student = '',
    program = '',
    day = '',
    time = '',
    teacher = '',
    branchName = '',
    classType = 'Regular',
    changes = [],
    count = 1,
    customSummary = '',
  } = options;

  if (customSummary) return customSummary;

  const branchSuffix = branchName ? ` @ ${branchName}` : '';
  const teacherText = teacher ? ` with ${teacher}` : '';
  const typeText = classType ? ` (${classType})` : '';

  switch (action) {
    case 'edit': {
      if (changes.length > 0) {
        const changeStr = changes.map((c) => `${c.field}: ${c.before} → ${c.after}`).join(', ');
        return `Updated ${student || 'class'}${program ? ` (${program})` : ''} — ${changeStr}${branchSuffix}`;
      }
      return `Updated ${student || 'class'} — ${program || 'General'}${typeText} · ${day} ${time}${teacherText}${branchSuffix}`;
    }

    case 'add': {
      return `Added ${student} — ${program || 'General'}${typeText} · ${day} ${time}${teacherText}${branchSuffix}`;
    }

    case 'delete': {
      const details = [
        program || '',
        day && time ? `${day} ${time}` : (day || time || ''),
        teacher ? `with ${teacher}` : '',
      ].filter(Boolean).join(' · ');

      return `Deleted class for ${student}${details ? ` — ${details}` : ''}${branchSuffix}`;
    }

    case 'bulk': {
      return `Bulk imported ${count} class${count === 1 ? '' : 'es'}${branchSuffix}`;
    }

    default:
      return `${action.toUpperCase()} ${student || 'class'}${branchSuffix}`;
  }
}

/**
 * Extract structured changes (before/after) and metadata from an activity log entry.
 * Compatible with both structured `details` and legacy `summary` strings.
 *
 * @param {object} entry
 * @param {string} [entry.summary]
 * @param {object} [entry.details]
 * @returns {{
 *   hasChanges: boolean,
 *   changes: Array<{field: string, before: string, after: string}>,
 *   title: string,
 *   details: object
 * }}
 */
export function parseActivityChanges(entry = {}) {
  const summary = String(entry.summary || '');
  const details = entry.details || {};

  // 1. If structured changes are present in details, use them
  if (Array.isArray(details.changes) && details.changes.length > 0) {
    let title = summary;
    if (summary.includes(' — ')) {
      title = summary.split(' — ')[0];
    }
    return {
      hasChanges: true,
      changes: details.changes,
      title,
      details,
    };
  }

  // 2. Otherwise, check for arrow transitions "Field: X → Y" or "X -> Y" in summary
  const arrowRegex = /(?:([A-Za-z\s]+):\s*)?([^,:—]+?)\s*(?:→|->)\s*([^,;@]+)/g;
  const parsedChanges = [];
  let match;

  if (summary.includes('→') || summary.includes('->')) {
    while ((match = arrowRegex.exec(summary)) !== null) {
      let field = (match[1] || '').trim();
      const before = (match[2] || '').trim();
      const after = (match[3] || '').trim();

      if (!field) {
        if (before.includes(':') || before.includes('am') || before.includes('pm') || before.includes('.')) {
          field = 'Slot';
        } else {
          field = 'Change';
        }
      }

      // Map common field names to standard labels
      const normField = field.toLowerCase();
      if (normField.includes('time') || normField.includes('slot')) field = 'Slot';
      else if (normField.includes('teacher') || normField.includes('instructor')) field = 'Teacher';
      else if (normField.includes('day')) field = 'Day';
      else if (normField.includes('prog')) field = 'Program';
      else if (normField.includes('branch')) field = 'Branch';

      if (before && after) {
        parsedChanges.push({ field, before, after });
      }
    }
  }

  if (parsedChanges.length > 0) {
    let title = summary;
    if (summary.includes(' — ')) {
      title = summary.split(' — ')[0];
    } else if (summary.includes(': ')) {
      title = summary.split(': ')[0];
    }
    return {
      hasChanges: true,
      changes: parsedChanges,
      title,
      details,
    };
  }

  // 3. Simple non-diff entry
  return {
    hasChanges: false,
    changes: [],
    title: summary,
    details,
  };
}
