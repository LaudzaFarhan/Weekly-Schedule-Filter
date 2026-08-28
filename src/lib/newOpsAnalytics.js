/**
 * Shared derivation helpers for the New Operations read-only endpoints
 * (/api/new/workload and /api/new/trial-availability).
 *
 * These mirror the rules the UI applies so an API consumer gets the same
 * numbers as the Workload and Trial Availability pages:
 *  - Kinder programs run 90 minutes, everything else 120.
 *  - Kinder slots hold 4 students, Junior/Coder hold 6.
 *  - An instructor can only teach a category their level covers.
 */

/** Is this program a Kinder program? (KF1/KF2, K1..K4, or the word "Kinder".) */
export function isKinderProgram(program) {
  const p = String(program || '').trim();
  return /^kf\d/i.test(p) || /^k\d/i.test(p) || /kinder/i.test(p);
}

/** Class length in minutes: Kinder 90, everything else 120. */
export function programDurationMin(program) {
  return isKinderProgram(program) ? 90 : 120;
}

/** Max students in a slot: Kinder 4, Junior/Coder 6. */
export function maxStudentsForProgram(program) {
  return isKinderProgram(program) ? 4 : 6;
}

/**
 * Classify a program or level string into Kinder | Junior | Coder | null.
 *
 * The bare stage names are Coder levels recorded before "Coder" was prefixed —
 * "Basic 1", "Advance 2". Without them a legacy Coder class classified as null
 * and so matched no category, which made it invisible to anything asking "which
 * classes could a Coder student join?". `normaliseCoderLevel` already maps these,
 * so this keeps the two in step.
 */
export function categorize(str) {
  const s = String(str || '').toLowerCase();
  if (s.includes('kinder')) return 'Kinder';
  if (s.includes('junior')) return 'Junior';
  if (s.includes('coder')) return 'Coder';
  if (/^kf|^k\d/.test(s)) return 'Kinder';
  if (/^jf|^j\d/.test(s)) return 'Junior';
  if (/^(basic|intermediate|advance)/.test(s)) return 'Coder';
  return null;
}

/** Can an instructor level string cover a category? */
export function levelCovers(level, category) {
  const l = String(level || '').toLowerCase();
  if (!category) return true;
  if (category === 'Kinder') return l.includes('kinder');
  if (category === 'Junior') return l.includes('junior');
  if (category === 'Coder') return l.includes('coder');
  return true;
}

/** "HH:MM" (24h) -> minutes from midnight. */
export function hhmmToMin(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((n) => parseInt(n, 10));
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
}

/** minutes -> "HH:MM" (24h). */
export function minToHHMM(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * Parse a stored slot label like "1.00 pm - 3.00 pm" or "13:00 - 15:00" into
 * { start, end } minutes. Handles the common case where only the end carries
 * the am/pm marker.
 */
export function parseSlotLabel(label) {
  const cleaned = String(label || '').replace(/\s+/g, ' ').trim();
  const dash = cleaned.search(/[-–—]/);
  if (dash === -1) return null;

  const parseOne = (part, fallbackMeridiem) => {
    const s = part.trim().toLowerCase();
    const m = s.match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const mer = m[3] || fallbackMeridiem;
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    if (!mer && h >= 1 && h <= 7) h += 12; // bare 1-7 reads as afternoon
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };

  const endStr = cleaned.slice(dash + 1);
  const endMer = (endStr.match(/am|pm/i) || [''])[0].toLowerCase() || null;
  const end = parseOne(endStr, null);
  let start = parseOne(cleaned.slice(0, dash), endMer);

  if (start == null || end == null) return null;
  // Morning-into-afternoon, e.g. "11.00 - 12.00 pm".
  if (start >= end && endMer === 'pm') {
    const flipped = parseOne(cleaned.slice(0, dash), 'am');
    if (flipped != null && flipped < end) start = flipped;
  }
  if (end <= start) return null;
  return { start, end };
}

/** Do two [start, end) minute ranges overlap? */
export function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

/**
 * The standard one-hour trial windows, 1:00pm to 6:30pm on the half hour.
 * Used when a branch has no Class Operation plan for a day, so availability can
 * still be reported. Mirrors the fixed list the Trial Availability page shows.
 */
export function standardTrialWindows() {
  const out = [];
  for (let start = 13 * 60; start + 60 <= 18 * 60 + 30; start += 30) {
    out.push({ start, end: start + 60 });
  }
  return out;
}

/** Hourly windows of `duration` minutes that fit inside [open, close). */
export function hourlyWindows(openMin, closeMin, duration) {
  const out = [];
  for (let start = openMin; start + duration <= closeMin; start += 60) {
    out.push({ start, end: start + duration });
  }
  return out;
}

/**
 * The student names held in one `internal_classes.student` field.
 *
 * Usually one name per row, but a row can carry a comma-separated list. Every
 * other reader of this column splits it; the seat maths here must too, or a row
 * reading "Ann, Bob, Cara" counts as a single student and the slot looks emptier
 * than it is.
 */
export function splitStudents(field) {
  return String(field || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * Group classes into teaching slots keyed by day + time + teacher + branch.
 * A slot is one lesson an instructor runs, however many students are in it.
 */
export function groupIntoSlots(classes) {
  const slots = new Map();
  for (const c of classes || []) {
    const key = `${c.day}||${c.time}||${c.teacher}||${c.branchName}`;
    if (!slots.has(key)) {
      slots.set(key, {
        day: c.day,
        time: c.time,
        teacher: c.teacher,
        branchName: c.branchName,
        program: c.program,
        students: [],
        classIds: []
      });
    }
    const slot = slots.get(key);
    // One row can name several students, so the field is split rather than
    // pushed whole — pushing it whole under-counted a shared row as one seat.
    for (const name of splitStudents(c.student)) slot.students.push(name);
    slot.classIds.push(c.id);
    // Remarks flag a student on leave ("izin"). A slot where every student is
    // on leave doesn't count towards workload.
    if (!/izin|leave/i.test(String(c.remarks || ''))) slot.hasAttending = true;
  }
  return [...slots.values()];
}
