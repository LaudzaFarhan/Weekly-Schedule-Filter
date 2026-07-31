/**
 * Parser for the school's class-roster spreadsheets.
 *
 * The sheets are laid out for people, not machines:
 *
 *     A        B                  C      D           E             F
 *  1  KINDER  (banner, merged across the width)
 *  2  NO      PROGRAM            TERM   DAYS        TIME          INSTRUCTOR
 *  3  1       Kinder Foundation  KF2    1. Monday   1.00-2.30pm   Supandi
 *
 * Three things follow from that and drive the design here:
 *
 * - The header row is not row 1. A banner names the category above it, so the
 *   header row has to be found rather than assumed, and the banner is a useful
 *   fallback for the category.
 * - Columns are addressed by header name, never by position. The visible columns
 *   stop at INSTRUCTOR but real sheets carry more to the right, and their order
 *   varies between branches.
 * - Days read "1. Monday" and times read "1.00-2.30pm", with one meridiem for
 *   the pair. Both need unpicking.
 *
 * Everything here is pure so it can be tested without a browser or a database.
 */

import { DAY_NAMES } from '../utils/constants';
import { parseProgram, CATEGORIES } from './programRules';

/** Header spellings accepted for each field. Compared case- and space-insensitively. */
const HEADER_ALIASES = {
  no: ['no', 'no.', 'number', '#'],
  program: ['program', 'programme', 'programm', 'level name', 'class'],
  term: ['term', 'code', 'program code', 'level', 'module'],
  lesson: ['lesson', 'lesson no', 'lesson number', 'meeting'],
  day: ['days', 'day'],
  time: ['time', 'times', 'schedule', 'hour'],
  instructor: ['instructor', 'teacher', 'trainer', 'tutor'],
  student: ['student', 'student name', 'students', 'name', 'nama', 'nama siswa'],
  branch: ['branch', 'branch name', 'location', 'cabang'],
  parent: ['parent', 'parent name', 'guardian', 'orang tua'],
  contact: ['contact', 'phone', 'phone number', 'whatsapp', 'wa', 'hp', 'no hp'],
  status: ['status'],
  remarks: ['remarks', 'remark', 'notes', 'note', 'keterangan'],
};

const canon = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Which field, if any, a header cell names. */
function fieldForHeader(cell) {
  const c = canon(cell).replace(/[:*]+$/, '');
  if (!c) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(c)) return field;
  }
  return null;
}

/**
 * "1. Monday" -> "Monday". The numeric prefix orders the sheet and carries no
 * meaning, and some sheets abbreviate, so a prefix match is accepted too.
 */
export function parseDayCell(value) {
  const raw = String(value ?? '').replace(/^\s*\d+\s*[.)-]?\s*/, '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return DAY_NAMES.find((d) => d.toLowerCase() === lower)
    || DAY_NAMES.find((d) => d.toLowerCase().startsWith(lower.slice(0, 3)))
    || null;
}

/** One side of a time range, in minutes. Returns { min, hadMeridiem }. */
function parseClockPart(part) {
  const raw = String(part ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const m = raw.match(/^(\d{1,2})(?:[.:](\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3] ? m[3][0] : null; // 'a' | 'p' | null
  if (hour > 23 || mins > 59) return null;

  if (mer) {
    if (hour === 12) hour = mer === 'a' ? 0 : 12;
    else if (mer === 'p') hour += 12;
  }
  return { min: hour * 60 + mins, hadMeridiem: !!mer, rawHour: parseInt(m[1], 10) };
}

/**
 * "1.00-2.30pm" -> { startMin: 780, endMin: 870 }.
 *
 * The sheets write one meridiem for the pair, so a side without its own borrows
 * the other's. That alone is not enough: "11.00-1.00pm" would make the start
 * 11 PM, which is after the end. When borrowing produces a range that does not
 * move forwards, the borrowed half is flipped instead — 11 AM to 1 PM.
 */
export function parseTimeRange(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parts = raw.split(/\s*(?:-|–|—|to|s\/d|sampai)\s*/i).filter(Boolean);
  if (parts.length !== 2) return null;

  const a = parseClockPart(parts[0]);
  const b = parseClockPart(parts[1]);
  if (!a || !b) return null;

  let startMin = a.min;
  let endMin = b.min;

  if (!a.hadMeridiem && b.hadMeridiem) {
    // Borrow the end's half of the day, then correct if that runs backwards.
    const borrowed = b.min >= 12 * 60
      ? (a.rawHour === 12 ? 12 * 60 : a.rawHour * 60 + (a.min % 60) + 12 * 60)
      : (a.rawHour === 12 ? 0 : a.rawHour * 60 + (a.min % 60));
    startMin = borrowed;
    if (startMin >= endMin) startMin = borrowed - 12 * 60;
  } else if (a.hadMeridiem && !b.hadMeridiem) {
    const borrowed = a.min >= 12 * 60
      ? (b.rawHour === 12 ? 12 * 60 : b.rawHour * 60 + (b.min % 60) + 12 * 60)
      : (b.rawHour === 12 ? 0 : b.rawHour * 60 + (b.min % 60));
    endMin = borrowed;
    if (endMin <= startMin) endMin = borrowed + 12 * 60;
  } else if (!a.hadMeridiem && !b.hadMeridiem) {
    // No meridiem anywhere. Classes run in the afternoon, so a start before 8
    // is read as PM; that is what "1.00-2.30" means on these sheets.
    if (a.min < 8 * 60) { startMin = a.min + 12 * 60; endMin = b.min + 12 * 60; }
    if (endMin <= startMin) endMin += 12 * 60;
  }

  if (startMin == null || endMin == null || endMin <= startMin) return null;
  return { startMin, endMin };
}

/** 780 -> "1.00 pm", the format class times are stored in. */
export function clockShortLabel(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'pm' : 'am';
  let hr = h24 % 12;
  if (hr === 0) hr = 12;
  return `${hr}.${String(m).padStart(2, '0')} ${ampm}`;
}

/** The stored time label for a range, matching what the schedule writes. */
export const timeLabelFor = (startMin, endMin) =>
  `${clockShortLabel(startMin)} - ${clockShortLabel(endMin)}`;

/**
 * Combine TERM and LESSON into a stored program value.
 * Kinder and Junior carry a lesson number; Coder levels are stored whole.
 */
export function buildProgramValue(term, lesson) {
  const code = String(term ?? '').trim();
  if (!code) return '';
  if (/^coder/i.test(code)) return code;
  const n = parseInt(String(lesson ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? `${code}.${n}` : code;
}

/** The category a banner or sheet name announces, if any. */
function categoryFromText(text) {
  const c = canon(text);
  if (!c) return null;
  return CATEGORIES.find((cat) => c.includes(cat.toLowerCase())) || null;
}

/**
 * Locate the header row in a sheet given as an array of arrays.
 *
 * Chosen by which candidate row names the most known fields, rather than the
 * first row that names any: a banner reading "KINDER PROGRAM" would otherwise
 * be mistaken for the header row.
 */
export function findHeaderRow(grid, limit = 12) {
  let best = { index: -1, score: 0, map: {} };
  const upTo = Math.min(grid.length, limit);
  for (let i = 0; i < upTo; i += 1) {
    const map = {};
    let score = 0;
    (grid[i] || []).forEach((cell, col) => {
      const field = fieldForHeader(cell);
      if (field && map[field] === undefined) { map[field] = col; score += 1; }
    });
    // Needs more than one recognised header, and at least one that actually
    // identifies a row — otherwise a stray "No" label would win.
    const useful = map.term !== undefined || map.student !== undefined ||
      map.day !== undefined || map.time !== undefined;
    if (score > best.score && score >= 2 && useful) best = { index: i, score, map };
  }
  return best.index === -1 ? null : best;
}

/**
 * Parse one sheet.
 *
 * @param {Array<Array>} grid rows of cells, as from sheet_to_json({header:1})
 * @param {object} opts { sheetName, defaultBranch }
 * @returns {{ rows: Array, errors: Array, headers: string[], category: string|null }}
 */
export function parseRosterGrid(grid, { sheetName = '', defaultBranch = '' } = {}) {
  const rows = [];
  const errors = [];

  const header = findHeaderRow(grid);
  if (!header) {
    return {
      rows,
      errors: [{ line: sheetName || 'sheet', msg: 'No header row found. Expected a row naming TERM, DAYS, TIME and INSTRUCTOR.' }],
      headers: [],
      category: null,
    };
  }

  const headers = (grid[header.index] || []).map((c) => String(c ?? '').trim()).filter(Boolean);

  // The banner sits above the headers; fall back to the sheet's own name.
  let bannerCategory = null;
  for (let i = 0; i < header.index && !bannerCategory; i += 1) {
    for (const cell of grid[i] || []) {
      bannerCategory = categoryFromText(cell);
      if (bannerCategory) break;
    }
  }
  const sheetCategory = bannerCategory || categoryFromText(sheetName);

  const col = (field) => header.map[field];
  const cellAt = (row, field) => {
    const idx = col(field);
    return idx === undefined ? '' : String(row[idx] ?? '').trim();
  };

  for (let i = header.index + 1; i < grid.length; i += 1) {
    const row = grid[i] || [];
    // Blank spacer rows and repeated banners are common mid-sheet.
    const hasContent = row.some((c) => String(c ?? '').trim() !== '');
    if (!hasContent) continue;

    const where = `${sheetName || 'sheet'} row ${i + 1}`;
    const term = cellAt(row, 'term');
    const dayRaw = cellAt(row, 'day');
    const timeRaw = cellAt(row, 'time');
    const instructor = cellAt(row, 'instructor');
    const student = cellAt(row, 'student');
    const programText = cellAt(row, 'program');

    // A row repeating the banner, or a sub-heading, has none of the real fields.
    if (!term && !dayRaw && !timeRaw && !instructor && !student) continue;

    const parsed = parseProgram(term);
    const category = parsed.category || sheetCategory;

    const day = parseDayCell(dayRaw);
    const range = parseTimeRange(timeRaw);
    const branch = cellAt(row, 'branch') || defaultBranch;

    const missing = [];
    if (!student) missing.push('Student');
    if (!term) missing.push('Term');
    if (!instructor) missing.push('Instructor');
    if (!branch) missing.push('Branch');
    if (missing.length) {
      errors.push({ line: where, msg: `Missing ${missing.join(', ')}` });
      continue;
    }
    if (!day) { errors.push({ line: where, msg: `Unreadable day "${dayRaw}"` }); continue; }
    if (!range) { errors.push({ line: where, msg: `Unreadable time "${timeRaw}"` }); continue; }
    if (!category) {
      errors.push({ line: where, msg: `Cannot tell the category from term "${term}"` });
      continue;
    }

    const program = buildProgramValue(term, cellAt(row, 'lesson'));

    // PROGRAM is decoration; TERM is the code that decides the family. Where the
    // two disagree the row still imports, but the mismatch is worth surfacing —
    // real sheets contain rows labelled "Kinder Foundation" against term K2.
    const labelCategory = categoryFromText(programText);
    const familyMismatch = programText && parsed.family &&
      canon(programText) !== canon(parsed.family) &&
      (!labelCategory || labelCategory === category);

    rows.push({
      line: where,
      student,
      program,
      term,
      category,
      day,
      time: timeLabelFor(range.startMin, range.endMin),
      startMin: range.startMin,
      endMin: range.endMin,
      teacher: instructor,
      branchName: branch,
      level: parsed.family || category,
      parentName: cellAt(row, 'parent'),
      contact: cellAt(row, 'contact'),
      status: cellAt(row, 'status') || 'Active',
      remarks: cellAt(row, 'remarks'),
      warning: familyMismatch
        ? `Sheet says "${programText}" but term ${term} is ${parsed.family}`
        : null,
    });
  }

  return { rows, errors, headers, category: sheetCategory };
}

/**
 * Parse a whole workbook. Every sheet is attempted, since branches keep one tab
 * per category and name them inconsistently.
 */
export function parseRosterWorkbook(XLSX, arrayBuffer, { defaultBranch = '' } = {}) {
  let wb;
  try {
    wb = XLSX.read(arrayBuffer, { type: 'array' });
  } catch {
    return { rows: [], errors: [{ line: 0, msg: 'Could not read that file. Use .xlsx, .xls or .csv.' }], headers: [] };
  }

  const rows = [];
  const errors = [];
  const headers = new Set();
  let parsedAny = false;

  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', blankrows: false });
    if (!grid.length) continue;
    const res = parseRosterGrid(grid, { sheetName, defaultBranch });
    // A sheet with no header row is probably not a roster at all, so its "no
    // header" complaint is only worth reporting if no sheet parsed.
    if (res.headers.length === 0 && res.rows.length === 0) continue;
    parsedAny = true;
    res.headers.forEach((h) => headers.add(h));
    rows.push(...res.rows);
    errors.push(...res.errors);
  }

  if (!parsedAny) {
    errors.push({
      line: 0,
      msg: 'No roster sheet found. Expected a row naming TERM, DAYS, TIME and INSTRUCTOR, with a STUDENT column.',
    });
  }

  return { rows, errors, headers: [...headers] };
}
