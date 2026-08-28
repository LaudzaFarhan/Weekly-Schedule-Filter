'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { 
  subscribeToInternalClasses, 
  createInternalClass, 
  updateInternalClass, 
  deleteInternalClass,
  bulkDeleteAllClasses
} from '../services/internalScheduleService';
import { subscribeToInternalStudents } from '../services/internalStudentService';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { subscribeToLiveProgress } from '../services/newLiveProgressService';
import { slotTypeMeta } from '../lib/slotTypes';
import ScheduleGridPanel from '../components/operations/ScheduleGridPanel';
import { useNewOperationals } from '../hooks/useNewOperationals';
import { useScheduleRules } from '../hooks/useScheduleRules';
import { canCombine, maxStudentsFor, parseProgram, CODER_LEVELS, normaliseCoderLevel } from '../lib/programRules';
import {
  availabilityFor, groupClasses, classWindow, ATTENDANCE, isDatedKind, isExpired, isoOf,
  nextDateForDay, levelCovers,
} from '../lib/instructorAvailability';
import { subscribeToActivity, logActivity, deleteActivity, displayUser } from '../services/newActivityService';
import { computeScheduleDiff, formatScheduleActivitySummary, parseActivityChanges } from '../lib/scheduleActivityHelper';
import { useAuth } from '../contexts/AuthContext';
import { doTimeSlotsOverlap, formatNormalizedTimeSlot } from '../utils/timeUtils';
import {
  normalizeStudentName, buildPlacesByStudent, findUnallocatedStudents,
} from '../lib/studentAllocation';
import { DAY_NAMES, SCHEDULE_PAGE_SIZE, DEFAULT_BRANCH_LIST, isSameBranch } from '../utils/constants';
import Pagination from '../components/ui/Pagination';
import { Plus, Pencil, Trash2, Search, X, Calendar, CalendarPlus, MapPin, Repeat, User, Users, UserX, BookOpen, Clock, AlertTriangle, Upload, History, Trash, FileDown, CheckCircle2, ChevronDown, Check, Lock } from 'lucide-react';
import * as XLSX from 'xlsx';



/** Parse bulk-import text into class rows. Accepts comma OR tab separated:
 *  Day, Time, Program, Student, Teacher, Branch, [ClassType]  (one per line). */
function parseBulkSchedule(text) {
  const rows = [];
  const errors = [];
  const lines = String(text || '').split('\n');
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    // header line (starts with "day")
    if (/^day\b/i.test(line) && /time/i.test(line)) return;
    const parts = line.split(line.includes('\t') ? '\t' : ',').map((p) => p.trim());
    const [day, time, program, student, teacher, branchName, classType] = parts;
    const lineNo = idx + 1;
    const dayMatch = DAY_NAMES.find((d) => d.toLowerCase() === String(day || '').toLowerCase());
    if (!dayMatch) { errors.push({ line: lineNo, msg: `Invalid/missing day: "${day || ''}"` }); return; }
    if (!time || !student) {
      errors.push({ line: lineNo, msg: 'Missing required field (need Day, Time, Student)' });
      return;
    }
    const ct = /trial/i.test(classType || '') ? 'Trial' : 'Regular';
    const normTime = formatNormalizedTimeSlot(time);
    rows.push({
      day: dayMatch,
      time: normTime,
      program: program || 'General',
      student,
      teacher: teacher || 'TBD',
      branchName: branchName || 'Bekasi',
      classType: ct,
      remarks: '',
    });
  });
  return { rows, errors };
}

/** Parse a time string ("1:00 pm", "13.00", "1pm") to minutes-from-midnight. */
function parseTimeStringToMin(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3];
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (!mer && h >= 1 && h <= 7) h += 12; // bare 1–7 assumed afternoon
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Excel cells: numeric time is a day-fraction; strings go through the parser. */
function excelStartToMin(value) {
  if (value === '' || value == null) return null;
  if (typeof value === 'number') {
    if (value < 1) return Math.round((value % 1) * 24 * 60); // fraction of a day
    if (value <= 24) return Math.round(value * 60);          // bare hour
    return null;
  }
  return parseTimeStringToMin(value);
}

/** Build the final program value from a tab category + program + lesson. */
function buildImportProgram(category, program, lesson) {
  const p = String(program || '').trim();
  if (category === 'coder') {
    return /^coder/i.test(p) ? p : `Coder ${p}`;
  }
  const ln = String(lesson || '').trim() || '1';
  return `${p.toUpperCase()}.${ln}`;
}

/**
 * Read an uploaded workbook. Sheets named Kinder / Junior / Coder are parsed
 * into class rows; other sheets are ignored. Returns { rows, errors }.
 */
function parseScheduleWorkbook(arrayBuffer) {
  const rows = [];
  const errors = [];
  let wb;
  try {
    wb = XLSX.read(arrayBuffer, { type: 'array' });
  } catch {
    return { rows, errors: [{ line: 0, msg: 'Could not read the file. Use the .xlsx template.' }] };
  }

  wb.SheetNames.forEach((sheetName) => {
    const lower = sheetName.toLowerCase();
    const category = ['kinder', 'junior', 'coder'].find((c) => lower.includes(c));
    if (!category) return; // ignore unrelated sheets

    const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    json.forEach((r, i) => {
      const get = (names) => {
        for (const n of names) {
          const key = Object.keys(r).find((k) => k.trim().toLowerCase() === n);
          if (key !== undefined) return r[key];
        }
        return '';
      };
      const day = String(get(['day']) || '').trim();
      const startRaw = get(['start time', 'start', 'time']);
      const program = String(get(['program', 'level', 'module']) || '').trim();
      const lesson = get(['lesson', 'lesson number', 'lesson no']);
      const student = String(get(['student', 'student name', 'students']) || '').trim();
      const teacher = String(get(['teacher', 'instructor']) || '').trim();
      const branch = String(get(['branch', 'branch name']) || '').trim();
      const classTypeRaw = String(get(['class type', 'type']) || '').trim();

      const where = `${sheetName} row ${i + 2}`;
      const dayMatch = DAY_NAMES.find((d) => d.toLowerCase() === day.toLowerCase());
      if (!dayMatch) { errors.push({ line: where, msg: `Invalid/missing day "${day}"` }); return; }
      if (!program || !student || !teacher || !branch) {
        errors.push({ line: where, msg: 'Missing Program / Student / Teacher / Branch' });
        return;
      }
      const startMin = excelStartToMin(startRaw);
      if (startMin == null) { errors.push({ line: where, msg: `Unreadable start time "${startRaw}"` }); return; }

      const finalProgram = buildImportProgram(category, program, lesson);
      const time = buildTimeSlot(`${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`, finalProgram);
      const classType = /trial/i.test(classTypeRaw) ? 'Trial' : 'Regular';

      rows.push({ day: dayMatch, time, program: finalProgram, student, teacher, branchName: branch, classType, remarks: '' });
    });
  });

  return { rows, errors };
}

/** Generate & download an .xlsx template with Kinder / Junior / Coder tabs. */
function downloadImportTemplate() {
  const wb = XLSX.utils.book_new();
  const kinder = [{ Day: 'Monday', 'Start Time': '1:00 PM', Program: 'KF1', Lesson: 2, Student: 'Mia', Teacher: 'Christina', Branch: 'Gading Serpong', 'Class Type': 'Regular' }];
  const junior = [{ Day: 'Tuesday', 'Start Time': '4:00 PM', Program: 'J2', Lesson: 5, Student: 'Budi', Teacher: 'Angel', Branch: 'Puri Indah', 'Class Type': 'Regular' }];
  const coder = [{ Day: 'Wednesday', 'Start Time': '1:00 PM', Program: 'Coder Advance', Student: 'Dave Kingsley', Teacher: 'Christian', Branch: 'Gading Serpong', 'Class Type': 'Trial' }];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kinder), 'Kinder');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(junior), 'Junior');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coder), 'Coder');
  XLSX.writeFile(wb, 'schedule-import-template.xlsx');
}


// Program catalogue. Kinder & Junior programs each have 10 lessons; Coder has
// no lesson number. Codes: KF1/KF2 (Kinder Foundation), K1-K4 (Kinder Core),
// JF1/JF2 (Junior Foundation), J1-J4 (Junior Core), Coder.
const PROGRAM_GROUPS = [
  { label: 'Kinder Foundation', codes: ['KF1', 'KF2'] },
  { label: 'Kinder Core (Term 1–4)', codes: ['K1', 'K2', 'K3', 'K4'] },
  { label: 'Junior Foundation', codes: ['JF1', 'JF2'] },
  { label: 'Junior Core (Term 1–4)', codes: ['J1', 'J2', 'J3', 'J4'] },
  { label: 'Coder', codes: CODER_LEVELS },
];
const LESSON_COUNT = 10;
// Kinder & Junior codes carry a lesson number; Coder programs do not.
const codeHasLessons = (code) => !!code && !/^coder/i.test(code);

/** Is this program a Kinder program? (Kinder Foundation KF*, Kinder Core K*.) */
const isKinderProgram = (program) => {
  const p = String(program || '').trim();
  // Kinder codes start with K (KF1, KF2, K1..K4) or the literal word "Kinder".
  return /^k/i.test(p);
};

/**
 * Program duration rule: every program runs 2 hours, except Kinder which runs
 * 1.5 hours. Returns minutes.
 */
const programDurationMin = (program) => (isKinderProgram(program) ? 90 : 120);



/** Classify a level/program string into Kinder | Junior | Coder | null. */
const categorizeLevel = (str) => {
  const s = String(str || '').toLowerCase();
  if (s.includes('coder') || /basic|intermediate|advance|python|web|app|scratch|roblox/.test(s)) return 'Coder';
  if (s.includes('kinder') || /^kf|^k\d/.test(s)) return 'Kinder';
  if (s.includes('junior') || /^jf|^j\d/.test(s)) return 'Junior';
  return null;
};

/**
 * The program code a student's recorded level points at, so allocating them
 * starts from what they are actually enrolled in rather than a blank slate.
 *
 * Levels read like "Junior Foundation", "Kinder Core" or "Coder Basic".
 */
const defaultCodeForLevel = (level) => {
  const s = String(level || '').trim();
  if (!s) return '';
  // Coder levels are stored verbatim as the program code. Folded first, so a
  // student still recorded as "Coder Advance 1" or "Basic 1" resolves to "Coder Basic/Advance"
  // rather than failing to match and leaving the program field empty.
  if (/^coder/i.test(s) || /basic|intermediate|advance|python|web|app|scratch|roblox/i.test(s)) {
    const folded = normaliseCoderLevel(s);
    const exact = PROGRAM_GROUPS.find((g) => g.label === 'Coder')
      ?.codes.find((c) => c.toLowerCase() === folded.toLowerCase());
    return exact || 'Coder Basic';
  }
  const parsed = parseProgram(s);
  if (parsed.code) {
    const exact = PROGRAM_GROUPS.flatMap((g) => g.codes).find(
      (c) => c.toLowerCase() === parsed.code.toLowerCase()
    );
    if (exact) return exact;
  }
  const lower = s.toLowerCase();

  // Extract explicit term or level digits: "Term 3", "T3", "Junior 3", "Kinder 2", "Core 3", etc.
  const termMatch = lower.match(/term\s*([1-4])/i) || lower.match(/\bt([1-4])\b/i) || lower.match(/(?:core|foundation)?\s*([1-4])\b/i);
  const termNum = termMatch ? termMatch[1] : null;

  const foundation = lower.includes('foundation') || lower.includes('kf') || lower.includes('jf');

  if (lower.includes('kinder') || lower.startsWith('k')) {
    if (foundation) return termNum === '2' ? 'KF2' : 'KF1';
    if (termNum && ['1', '2', '3', '4'].includes(termNum)) return `K${termNum}`;
    return 'K1';
  }

  if (lower.includes('junior') || lower.startsWith('j')) {
    if (foundation) return termNum === '2' ? 'JF2' : 'JF1';
    if (lower.includes('intermediate')) return 'J2';
    if (lower.includes('advance')) return 'J3';
    if (lower.includes('master')) return 'J4';
    if (termNum && ['1', '2', '3', '4'].includes(termNum)) return `J${termNum}`;
    return 'J1';
  }
  return '';
};

/** Extract or derive the default term number for a student's level or program code */
const defaultTermForLevel = (level, programCode) => {
  const s = String(level || '').trim();
  const m = s.match(/Term\s*([1-4])/i) || s.match(/\bT([1-4])\b/i);
  if (m) return `Term ${m[1]}`;
  const codeStr = String(programCode || '').trim().toUpperCase();
  const numMatch = codeStr.match(/^[A-Z]+([1-4])$/);
  if (numMatch) {
    const num = Number(numMatch[1]);
    if (num >= 1 && num <= 4) return `Term ${num}`;
  }
  return 'Term 1';
};

/** Standard Program Category Display Options */
const PROGRAM_CATEGORY_OPTIONS = [
  { label: 'Kinder Core', value: 'Kinder Core', desc: 'K1–K4' },
  { label: 'Kinder Foundation', value: 'Kinder Foundation', desc: 'KF1–KF2' },
  { label: 'Junior Foundation', value: 'Junior Foundation', desc: 'JF1–JF2' },
  { label: 'Junior Core', value: 'Junior Core', desc: 'J1–J4' },
  { label: 'Coder', value: 'Coder', desc: 'Basic, Intermediate, Advance' },
];

/** Resolve friendly Category Name from raw level or code */
const resolveProgramCategoryName = (levelOrCode) => {
  const s = String(levelOrCode || '').trim().toLowerCase();
  if (!s) return 'Junior Core';
  if (/coder|basic|intermediate|advance|python|web|app|scratch|roblox/i.test(s)) return 'Coder';
  if (s.includes('foundation') || s.startsWith('kf') || s.startsWith('jf')) {
    if (s.includes('kinder') || s.startsWith('kf')) return 'Kinder Foundation';
    return 'Junior Foundation';
  }
  if (s.includes('kinder') || s.startsWith('k')) return 'Kinder Core';
  if (s.includes('junior') || s.startsWith('j')) return 'Junior Core';
  return 'Junior Core';
};

/** Derive specific code from Program Category and Term (e.g. Junior Core + Term 3 -> J3) */
const deriveCodeFromCategoryAndTerm = (categoryName, termNo, rawLevel) => {
  const cat = String(categoryName || '').trim();
  const termNum = String(termNo || '').match(/\d+/)?.[0] || '1';

  if (/coder/i.test(cat)) {
    return defaultCodeForLevel(rawLevel) || 'Coder Basic';
  }
  if (cat === 'Kinder Foundation') {
    return termNum === '2' ? 'KF2' : 'KF1';
  }
  if (cat === 'Kinder Core') {
    return `K${termNum}`;
  }
  if (cat === 'Junior Foundation') {
    return termNum === '2' ? 'JF2' : 'JF1';
  }
  if (cat === 'Junior Core') {
    return `J${termNum}`;
  }
  return 'J1';
};

/** Can a New Ops instructor (level string) teach a given category? */
const instructorHandles = (instructor, category) => {
  const lvl = String(instructor?.level || '').toLowerCase();
  if (!category) return true;
  if (category === 'Kinder') return lvl.includes('kinder');
  if (category === 'Junior') return lvl.includes('junior');
  if (category === 'Coder') return lvl.includes('coder');
  return true;
};

/**
 * The students panel shows five rows and scrolls for the rest, so the card keeps
 * a predictable size however many students there are — and Recommended Days,
 * which stretches to match it, does too.
 *
 * Rows are given an explicit height rather than left to their content: that is
 * what makes "exactly five visible" true regardless of font rendering, and it
 * lets the container height be arithmetic rather than a guess. Every line inside
 * a row is therefore clipped to one line.
 */
const VISIBLE_STUDENT_ROWS = 5;
/** The two scopes the students panel can show. */
const STUDENT_SCOPES = [
  { value: 'unallocated', label: 'Unallocated' },
  { value: 'all', label: 'All Students' },
];

/**
 * The scope switch, as a listbox rather than a `<select>`.
 *
 * A native `<select>` renders its options through the operating system, which no
 * stylesheet can reach — so an opening animation is impossible without owning the
 * menu. That is the whole reason this component exists; everything else about it
 * is the cost of replacing a native control responsibly:
 *
 *   - `role="listbox"` / `role="option"` with `aria-selected`, so it announces as
 *     the control it replaced.
 *   - Arrow keys, Home/End, Enter/Space to choose, Escape to dismiss, and focus
 *     returning to the button on close — all of which a `<select>` gave for free.
 *   - Closes on outside pointerdown and on blur leaving the component.
 *
 * The animation itself lives in `globals.css` (`.scope-menu`), including a
 * `prefers-reduced-motion` branch.
 */
function ScopeSwitch({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  const selectedIndex = Math.max(0, STUDENT_SCOPES.findIndex((s) => s.value === value));
  const current = STUDENT_SCOPES[selectedIndex];

  // Opening highlights the current value, so Enter without moving is a no-op
  // rather than a silent change to the first item.
  const openMenu = () => { setActiveIndex(selectedIndex); setOpen(true); };
  const closeMenu = ({ refocus = false } = {}) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (index) => {
    const next = STUDENT_SCOPES[index];
    if (next && next.value !== value) onChange?.(next.value);
    closeMenu({ refocus: true });
  };

  // Dismiss on a press anywhere else. `pointerdown` rather than `click` so the
  // menu is gone before the click lands on whatever is underneath.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onKeyDown = (event) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); closeMenu({ refocus: true }); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(STUDENT_SCOPES.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (event.key === 'Home') {
      event.preventDefault(); setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault(); setActiveIndex(STUDENT_SCOPES.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); choose(activeIndex);
    }
  };

  return (
    <span ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Which students to list"
        title="Switch between unallocated students and everyone"
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onKeyDown}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
          fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)',
          background: 'transparent',
          border: `1px solid ${open ? 'var(--border-color)' : 'transparent'}`,
          borderRadius: '7px', padding: '0.1rem 0.35rem', cursor: 'pointer',
          font: 'inherit',
        }}
      >
        {current.label}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`scope-caret ${open ? 'scope-caret-open' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Which students to list"
          aria-activedescendant={`scope-option-${STUDENT_SCOPES[activeIndex]?.value}`}
          className="scope-menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30,
            margin: 0, padding: '0.25rem', listStyle: 'none', minWidth: '11rem',
            // `--panel-bg` is the repo's opaque surface colour. An explicit
            // #ffffff fallback as well, because a floating menu MUST be solid:
            // an undefined variable resolves to nothing and the text underneath
            // reads straight through it.
            background: 'var(--panel-bg, #ffffff)', border: '1px solid var(--border-color)',
            borderRadius: '9px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          {STUDENT_SCOPES.map((scope, index) => {
            const isSelected = scope.value === value;
            const isActive = index === activeIndex;
            return (
              <li
                key={scope.value}
                id={`scope-option-${scope.value}`}
                role="option"
                aria-selected={isSelected}
                className="scope-menu-item"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: '0.5rem', padding: '0.4rem 0.55rem', borderRadius: '6px',
                  fontSize: '0.85rem', fontWeight: isSelected ? 700 : 500,
                  color: isSelected ? 'var(--primary-blue)' : 'var(--text-main)',
                  background: isActive ? 'var(--bg-color)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                {scope.label}
                {isSelected && <Check size={13} aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
}

const STUDENT_ROW_GAP = 5; // px, kept in px so the height below is exact
const STUDENT_ROW_H = 48; // name + level/branch
const STUDENT_ROW_H_WIDE = 62; // ...plus the regular place, in All Students mode

/** Height of exactly `VISIBLE_STUDENT_ROWS` rows, including the gaps between. */
const studentListHeight = (rowH) =>
  VISIBLE_STUDENT_ROWS * rowH + (VISIBLE_STUDENT_ROWS - 1) * STUDENT_ROW_GAP;

/**
 * Space the students panel spends above its list: the search input plus its
 * bottom margin.
 *
 * The Unallocated and Recommended Days cards share a stretch grid row, so the
 * taller card sets the height of both. The students card is already bounded —
 * its list is a fixed five rows — so the row stays put as long as the
 * Recommended card's body is bounded to the same budget. Capping the *lists*
 * inside it is not enough: that card carries a context row and a day/hours row
 * above its list, and an expanded slot adds an instructor picker inline, none
 * of which a cap on the list itself can contain.
 */
const STUDENT_SEARCH_BLOCK_H = 46;

/** The pixel budget a panel body gets before its inner list has to scroll. */
const panelBodyHeight = (rowH) => studentListHeight(rowH) + STUDENT_SEARCH_BLOCK_H;

/** One colour per attendance kind, used wherever a kind is labelled. */
const KIND_TINT = {
  Regular: '#5f3dc4',
  Replacement: '#7c3aed',
  Additional: '#0891b2',
  Trial: '#ea580c',
};

/**
 * Which weekday a "YYYY-MM-DD" date falls on, so a session date can be checked
 * against the day the class actually runs. Parsed field by field because
 * `new Date("2026-08-03")` is read as UTC and can shift a day either side.
 */
const dayNameOfISO = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
};

/** Parse "HH:MM" (24h) to minutes-from-midnight. */
const parseHHMMToMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
};

/** Minutes-from-midnight to "HH:MM" (24h), for the modal's time input. */
const minToHHMM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** Parse a stored program value ("JF1.5", "Coder", "K2", "Basic 1") into code + lesson. */
const parseProgramValue = (p) => {
  const val = String(p || '').trim();
  if (!val) return { code: '', lesson: '1' };
  // Coder programs store their full level/stage as code (e.g. "Coder Advance", "Basic 1"). No lesson numbers.
  if (/coder|basic|intermediate|advance|python|web|app|scratch|roblox/i.test(val)) return { code: val, lesson: null };
  const m = val.match(/^([A-Za-z]{1,3}\d+)(?:[.\s]+(\d+))?$/);
  if (m) return { code: m[1].toUpperCase(), lesson: m[2] || '1' };
  return { code: '', lesson: '1' };
};

/** Extract term number ("Term 1", "Term 2", ...) from program or remarks text. */
const extractTermFromProgram = (p, r) => {
  const text = `${String(p || '')} ${String(r || '')}`;
  const match = text.match(/Term\s*([1-4])/i) || text.match(/T([1-4])/i);
  return match ? `Term ${match[1]}` : 'Term 1';
};

/** Helper to get next uncompleted lesson number (1-10) from attendance record map */
const getNextUndoneLessonFromAttendance = (attendanceMap, maxL = 10) => {
  if (!attendanceMap) return '1';
  for (let i = 1; i <= maxL; i++) {
    if (!attendanceMap[i]) return String(i);
  }
  return String(maxL);
};

/** Format program display badge string (e.g. "KF1.1", "KF2.2", "J1.3", "Basic 1") with Live Progress sync */
const formatProgramBadge = (program, term, remarks, studentName, liveProgressList = []) => {
  const progStr = String(program || '').trim();
  if (!progStr && !term) return '';

  // Coder programs (Basic 1, Coder Basic, Intermediate, Advance, etc.)
  if (/coder|basic|intermediate|advance|python|web|app|scratch|roblox/i.test(progStr || term)) {
    return progStr || term;
  }

  // 1. Look up student live progress record to see if they completed attendance / have arranged lesson
  let lesson = null;
  if (studentName && Array.isArray(liveProgressList) && liveProgressList.length > 0) {
    const sName = String(studentName).trim().toLowerCase();
    const progRecord = liveProgressList.find((p) => String(p.studentName || '').trim().toLowerCase() === sName);
    if (progRecord) {
      if (progRecord.arrangedLesson) {
        lesson = String(progRecord.arrangedLesson).replace(/^L/i, '');
      } else if (progRecord.attendance) {
        lesson = getNextUndoneLessonFromAttendance(progRecord.attendance, 10);
      }
    }
  }

  // 2. If no live progress match, extract lesson from program string if dotted: "KF1.2" -> 2
  if (!lesson) {
    const dottedMatch = progStr.match(/\.(\d+)$/);
    if (dottedMatch) {
      lesson = dottedMatch[1];
    } else if (remarks) {
      const remMatch = String(remarks).match(/\bL(?:esson)?\s*(\d+)\b/i);
      if (remMatch) lesson = remMatch[1];
    }
  }

  if (!lesson) lesson = '1';

  // Extract or derive code:
  // 1. Check if progStr itself is a code like "KF1", "KF2", "K1", "JF1", "J3"
  const codeMatch = progStr.match(/^([A-Za-z]{1,3}\d+)/i);
  if (codeMatch && /^(kf|jf|k|j)\d+$/i.test(codeMatch[1])) {
    return `${codeMatch[1].toUpperCase()}.${lesson}`;
  }

  // 2. Check term string e.g. "KF2", "K1", "JF1", "J3"
  const termStr = String(term || '').trim();
  const termCodeMatch = termStr.match(/^([A-Za-z]{1,3}\d+)/i);
  if (termCodeMatch && /^(kf|jf|k|j)\d+$/i.test(termCodeMatch[1])) {
    return `${termCodeMatch[1].toUpperCase()}.${lesson}`;
  }

  // 3. Derive from category and term number
  const cat = resolveProgramCategoryName(progStr);
  const termNo = termStr.match(/\d+/)?.[0] || '1';
  if (cat === 'Kinder Foundation') return `KF${termNo === '2' ? '2' : '1'}.${lesson}`;
  if (cat === 'Kinder Core') return `K${termNo}.${lesson}`;
  if (cat === 'Junior Foundation') return `JF${termNo === '2' ? '2' : '1'}.${lesson}`;
  if (cat === 'Junior Core') return `J${termNo}.${lesson}`;

  return progStr ? `${progStr}.${lesson}` : `J1.${lesson}`;
};

/** Format minutes-since-midnight as "h.mm am/pm" (e.g. 13:00 -> "1.00 pm"). */
const formatClock = (mins) => {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'pm' : 'am';
  let hr = h24 % 12;
  if (hr === 0) hr = 12;
  return `${hr}.${String(m).padStart(2, '0')} ${ampm}`;
};

/**
 * Build the "start - end pm" slot string from an HH:MM start and a program,
 * applying the duration rule. Returns '' when no start time.
 */
const buildTimeSlot = (startHHMM, program) => {
  if (!startHHMM) return '';
  const [hh, mm] = startHHMM.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return '';
  const start = hh * 60 + mm;
  const end = start + programDurationMin(program);
  return `${formatClock(start)} - ${formatClock(end)}`;
};

export default function NewSchedulePage({ onNavigate }) {
  const { enabledBranches, branches } = useSchedule();
  // Branch open days / hours / slot plan come from PostgreSQL, not the Sheets config.
  const { openDaysFor, hoursFor, slotsFor } = useNewOperationals();
  // Configurable rules for which programs may share one slot.
  const { rules } = useScheduleRules();
  // Who is making the change — recorded on every activity entry.
  const { user } = useAuth();
  const { showToast } = useToast();

  // State
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showUnallocated, setShowUnallocated] = useState(true);
  // Which list the students panel shows: just the unallocated, or everyone
  // across every branch so an extra or replacement session can be booked for a
  // student who already has a class.
  const [studentScope, setStudentScope] = useState('unallocated');
  // Search inside the Unallocated panel, separate from the main table search.
  const [unallocSearch, setUnallocSearch] = useState('');
  const [unallocBranchFilter, setUnallocBranchFilter] = useState('all');
  // A time chosen in the recommendation panel, awaiting the instructor pick.
  const [timePick, setTimePick] = useState(null);
  const [startTime, setStartTime] = useState(''); // HH:MM for the class start
  // The exact stored label of a class being joined, held so the auto-derived
  // slot cannot overwrite it. Cleared the moment the start time is edited by
  // hand, which means the user is no longer joining that class.
  const [joinTime, setJoinTime] = useState(null);
  // Date being typed into the session-dates list, before it is added.
  const [sessionDateDraft, setSessionDateDraft] = useState('');
  const [programCode, setProgramCode] = useState('');
  const [termNo, setTermNo] = useState('Term 1');
  const [lessonNo, setLessonNo] = useState('1');
  const [allocTerm, setAllocTerm] = useState('Term 1');
  const [allocLesson, setAllocLesson] = useState('1');
  // The program list is normally limited to the student's own category. This
  // opens it up, for the rare case of a deliberate change.
  const [programUnlocked, setProgramUnlocked] = useState(false);
  const [allocChooser, setAllocChooser] = useState(null); // student pending class-type choice
  const [dayReco, setDayReco] = useState(null); // { student, classType, term, lesson } — drives the Recommended Days panel

  // Bulk import + activity history
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkRows, setBulkRows] = useState([]);        // parsed from uploaded file
  const [bulkFileErrors, setBulkFileErrors] = useState([]);
  const [bulkFileName, setBulkFileName] = useState('');
  const [history, setHistory] = useState([]);
  
  const [search, setSearch] = useState('');
  const [filterDay, setFilterDay] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterInstructor, setFilterInstructor] = useState('all');
  const [filterProgram, setFilterProgram] = useState('all');
  const [filterTime, setFilterTime] = useState('all');
  const [filterClassType, setFilterClassType] = useState('all');
  const [page, setPage] = useState(1);


  // Modal/Form State
  const [showModal, setShowModal] = useState(false);
  const [editingClass, setEditingClass] = useState(null);
  
  const [form, setForm] = useState({
    day: 'Monday',
    time: '',
    program: '',
    teacher: '',
    student: '',
    branchName: '',
    classType: 'Regular',
    remarks: ''
  });

  const [formErrors, setFormErrors] = useState({});

  // Subscribe to real-time updates from Firestore
  useEffect(() => {
    const unsubscribe = subscribeToInternalClasses(
      (data) => {
        setClasses(data);
        setLoadError(null);
        setLoading(false);
      },
      (err) => {
        setLoadError(err?.message || 'Unable to load schedule from the database.');
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Subscribe to the New Operations students list so we can flag which of them
  // haven't been allocated to a class yet.
  useEffect(() => {
    const unsubscribe = subscribeToInternalStudents((data) => setStudents(data));
    return () => unsubscribe();
  }, []);

  const [liveProgress, setLiveProgress] = useState([]);
  const [allocCode, setAllocCode] = useState('');
  const [allocCategory, setAllocCategory] = useState('Junior Core');

  useEffect(() => {
    const unsubscribe = subscribeToLiveProgress((data) => setLiveProgress(data || []));
    return () => unsubscribe();
  }, []);

  const progRecord = useMemo(() => {
    if (!allocChooser || !liveProgress.length) return null;
    const nameKey = String(allocChooser.name || '').trim().toLowerCase();
    return liveProgress.find((p) => String(p.studentName || '').trim().toLowerCase() === nameKey) || null;
  }, [allocChooser, liveProgress]);

  const completedLessons = useMemo(() => {
    if (!progRecord?.attendance) return new Set();
    const set = new Set();
    Object.entries(progRecord.attendance).forEach(([k, v]) => {
      if (v) set.add(Number(k));
    });
    return set;
  }, [progRecord]);

  const firstUndoneLesson = useMemo(() => {
    for (let i = 1; i <= 10; i++) {
      if (!completedLessons.has(i)) return String(i);
    }
    return '1';
  }, [completedLessons]);

  const handleOpenAllocChooser = (st) => {
    // Look up if student already has a regular schedule
    const nameKey = String(st.name || '').trim().toLowerCase();
    const regularClass = st.regulars?.[0] || (placesByStudent.get(normalizeStudentName(st.name)) || []).find((c) => (c.classType || 'Regular') === ATTENDANCE.REGULAR);

    const studentCategory = resolveProgramCategoryName(st.level);
    let initialCode = '';
    let initialTerm = 'Term 1';
    let initialLesson = '1';
    let initialCategory = studentCategory;

    if (regularClass) {
      const parsed = parseProgramValue(regularClass.program);
      const regCategory = resolveProgramCategoryName(regularClass.program);
      initialCategory = (studentCategory === 'Coder' || regCategory === 'Coder') ? 'Coder' : (regCategory || studentCategory);
      initialTerm = regularClass.term || extractTermFromProgram(regularClass.program, regularClass.remarks) || defaultTermForLevel(st.level, parsed.code);
      initialCode = parsed.code || deriveCodeFromCategoryAndTerm(initialCategory, initialTerm, st.level);
      initialLesson = parsed.lesson || '1';
    } else {
      initialCategory = studentCategory;
      initialTerm = defaultTermForLevel(st.level, '');
      initialCode = deriveCodeFromCategoryAndTerm(initialCategory, initialTerm, st.level);
    }

    const record = (liveProgress || []).find((p) => String(p.studentName || '').trim().toLowerCase() === nameKey);
    const set = new Set();
    if (record?.attendance) {
      Object.entries(record.attendance).forEach(([k, v]) => {
        if (v) set.add(Number(k));
      });
    }
    let undone = initialLesson || '1';
    for (let i = 1; i <= 10; i++) {
      if (!set.has(i)) { undone = String(i); break; }
    }

    setAllocChooser({ ...st, regularClass: regularClass || st.regulars?.[0] || null });
    setAllocCategory(initialCategory);
    setAllocCode(initialCode);
    setAllocTerm(initialTerm);
    setAllocLesson(undone);
  };

  // Subscribe to the New Operations instructors list — the instructor dropdown
  // must use New Operations data, not the old schedule's teachers.
  useEffect(() => {
    const unsubscribe = subscribeToInternalInstructors((data) => setInstructors(data));
    return () => unsubscribe();
  }, []);

  // Derive the program value ("JF1.5", "Coder", ...) from the code + lesson + term.
  useEffect(() => {
    if (!programCode) return;
    const val = codeHasLessons(programCode) ? `${programCode}.${lessonNo}` : programCode;
    setForm((prev) => {
      if (prev.program === val && prev.term === termNo) return prev;
      return { ...prev, program: val, term: termNo };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programCode, lessonNo, termNo]);

  // Auto-derive the time slot from the chosen start time + program duration
  // rule (Kinder = 1.5h, everything else = 2h). Only runs once a start time is
  // picked, so editing an existing class keeps its saved slot untouched.
  useEffect(() => {
    // Joining an existing class: that class's own label is authoritative and
    // must survive character for character, since the label is what groups the
    // rows. Rebuilding it here could produce a near-identical string and quietly
    // create a second class alongside the one being joined.
    if (joinTime) return;
    if (!startTime) return;
    const slot = buildTimeSlot(startTime, form.program);
    setForm((prev) => (prev.time === slot ? prev : { ...prev, time: slot }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, form.program, joinTime]);

  const sortedTeachers = [...new Set((instructors || []).map(i => i.name))].filter(Boolean).sort();
  const branchList = useMemo(() => {
    const list = [...new Set([...(enabledBranches || []).map(b => b.name), ...(branches || []).map(b => b.name)])].filter(b => b && b !== 'Default Branch');
    return list.length ? list : DEFAULT_BRANCH_LIST.map(b => b.name);
  }, [enabledBranches, branches]);

  // Instructors available for a given branch: those whose New Ops profile lists
  // that branch (or "All Branches"). Used by the Add/Edit modal so the teacher
  // options are scoped to the branch selected in the form.
  const instructorsForBranch = (branchName) => {
    const list = (instructors || [])
      .filter((i) => {
        if (!branchName) return true;
        const brs = Array.isArray(i.branches) ? i.branches : [];
        return brs.some((b) => b === 'All Branches' || isSameBranch(b, branchName));
      })
      .map((i) => i.name);
    return [...new Set(list)].filter(Boolean).sort();
  };
  const modalInstructors = instructorsForBranch(form.branchName);

  // Days a given branch is open, from the Operationals config. Falls back to all
  // days when no branch is selected or the branch has no saved working days.
  const branchOpenDays = (branchName) => {
    if (!branchName) return DAY_NAMES;
    const days = openDaysFor(branchName);
    // No rules configured for this branch yet — don't block the user.
    return days.length ? days : DAY_NAMES;
  };
  const modalDays = branchOpenDays(form.branchName);

  // Distinct programs & times present in the schedule, for the filter dropdowns.
  const programOptions = useMemo(
    () => [...new Set(classes.map((c) => c.program).filter(Boolean))].sort(),
    [classes]
  );
  const timeOptions = useMemo(
    () => [...new Set(classes.map((c) => c.time).filter(Boolean))].sort(),
    [classes]
  );

  // Students booked per slot (day + time + teacher + branch), so the table can
  // show occupancy against the per-program maximum (Kinder 4, Junior/Coder 6).
  const slotOccupancy = useMemo(() => {
    const map = new Map();
    classes.forEach((c) => {
      const key = `${c.day}||${c.time}||${c.teacher}||${c.branchName}`;
      const cnt = String(c.student || '').split(',').map((s) => s.trim()).filter(Boolean).length || 1;
      map.set(key, (map.get(key) || 0) + cnt);
    });
    return map;
  }, [classes]);

  // Instructor options for the toolbar, scoped to the selected branch.
  const toolbarInstructors = useMemo(() => {
    if (filterBranch === 'all') return sortedTeachers;
    const names = (instructors || [])
      .filter((i) => (i.branches || []).some((b) => b === 'All Branches' || isSameBranch(b, filterBranch)))
      .map((i) => i.name);
    return [...new Set(names)].filter(Boolean).sort();
  }, [instructors, filterBranch, sortedTeachers]);

  /**
   * Today, as "YYYY-MM-DD", for deciding which dated places are spent. Declared
   * above the filters because they read it during their first render.
   */
  const todayISO = useMemo(() => isoOf(new Date()), []);

  // Filters & Search
  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return classes.filter((c) => {
      if (filterDay !== 'all' && c.day !== filterDay) return false;
      if (filterBranch !== 'all' && !isSameBranch(c.branchName, filterBranch)) return false;
      if (filterInstructor !== 'all' && c.teacher !== filterInstructor) return false;
      if (filterProgram !== 'all' && c.program !== filterProgram) return false;
      if (filterTime !== 'all' && c.time !== filterTime) return false;
      const type = c.classType || 'Regular';
      // "expired" is not a stored type — it selects dated places that are spent,
      // which is the list worth reviewing before clearing any out.
      if (filterClassType === 'expired') {
        if (!isExpired(c, todayISO)) return false;
      } else if (filterClassType !== 'all' && type !== filterClassType) return false;
      if (s) {
        const match =
          (c.teacher && c.teacher.toLowerCase().includes(s)) ||
          (c.student && c.student.toLowerCase().includes(s)) ||
          (c.program && c.program.toLowerCase().includes(s)) ||
          (c.remarks && c.remarks.toLowerCase().includes(s)) ||
          (type.toLowerCase().includes(s));
        if (!match) return false;
      }
      return true;
    });
  }, [classes, search, filterDay, filterBranch, filterInstructor, filterProgram, filterTime, filterClassType, todayISO]);

  // Sort classes by day order and then time
  const dayOrder = {
    'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6, 'Sunday': 7
  };

  const sortedFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const orderA = dayOrder[a.day] || 99;
      const orderB = dayOrder[b.day] || 99;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.time || '').localeCompare(String(b.time || ''));
    });
  }, [filtered]);

  const totalPages = Math.ceil(sortedFiltered.length / SCHEDULE_PAGE_SIZE);
  const paged = sortedFiltered.slice((page - 1) * SCHEDULE_PAGE_SIZE, page * SCHEDULE_PAGE_SIZE);

  /**
   * Every class row each student holds, keyed by normalised name.
   *
   * A spent replacement or extra session is left out: it is over, so it neither
   * holds a seat nor makes the student count as allocated. That is what "removed
   * from the schedule once the date has passed" means in practice.
   *
   * The rules live in `lib/studentAllocation` so the home KPI and the
   * notification bell count the same students as this panel. In particular a
   * class whose teacher is not in the instructor registry still allocates its
   * students — see that module for why.
   */
  const placesByStudent = useMemo(
    () => buildPlacesByStudent(classes, todayISO),
    [classes, todayISO]
  );

  // Students that exist in the Students list but aren't allocated to any class.
  // A class's `student` field may hold several comma-separated names.
  const unallocatedStudents = useMemo(
    () => findUnallocatedStudents(students, placesByStudent),
    [students, placesByStudent]
  );

  /**
   * Everyone, across every branch, annotated with what they already hold. This
   * is the list used to book a replacement or an extra session, so it has to
   * show the regular place those bookings relate to.
   */
  const allStudentsAnnotated = useMemo(
    () => students.map((st) => {
      const places = placesByStudent.get(normalizeStudentName(st.name)) || [];
      const regulars = places.filter((c) => (c.classType || 'Regular') === ATTENDANCE.REGULAR);
      const extras = places.filter((c) => (c.classType || 'Regular') !== ATTENDANCE.REGULAR);
      return { ...st, places, regularCount: regulars.length, extraCount: extras.length, regulars, extras };
    }),
    [students, placesByStudent]
  );

  /**
   * The enrolled level of whoever is named in the form, looked up in the
   * Students list. Drives which programs the form offers: a Junior student
   * should not be quietly assignable to a Kinder program.
   *
   * Returns null when the name matches nobody, or when several students with
   * different categories are named — in both cases there is nothing to lock to.
   */
  const formStudentLevel = useMemo(() => {
    const names = String(form.student || '')
      .split(',')
      .map((part) => normalizeStudentName(part))
      .filter(Boolean);
    if (names.length === 0) return null;

    const matched = names
      .map((key) => students.find((st) => normalizeStudentName(st.name) === key))
      .filter(Boolean);
    if (matched.length === 0) return null;

    const categories = new Set(matched.map((st) => categorizeLevel(st.level)).filter(Boolean));
    if (categories.size !== 1) return null;

    const primary = matched[0];
    const key = normalizeStudentName(primary.name);
    const existingPlaces = placesByStudent.get(key) || [];
    const regularClass = existingPlaces.find((c) => (c.classType || 'Regular') === ATTENDANCE.REGULAR);

    return {
      category: [...categories][0],
      level: primary.level || '',
      name: primary.name,
      several: matched.length > 1,
      regularClass,
    };
  }, [form.student, students, placesByStudent]);

  const isStudentLocked = Boolean(formStudentLevel && (formStudentLevel.level || formStudentLevel.category));

  // Automatically lock and populate Program Code and Term when a student is selected
  useEffect(() => {
    if (formStudentLevel) {
      if (formStudentLevel.regularClass) {
        const parsed = parseProgramValue(formStudentLevel.regularClass.program);
        const code = parsed.code || defaultCodeForLevel(formStudentLevel.level);
        if (code) setProgramCode(code);
        const term = formStudentLevel.regularClass.term || extractTermFromProgram(formStudentLevel.regularClass.program, formStudentLevel.regularClass.remarks) || defaultTermForLevel(formStudentLevel.level, code);
        if (term) setTermNo(term);
        if (parsed.lesson) setLessonNo(parsed.lesson);
      } else if (formStudentLevel.level) {
        const code = defaultCodeForLevel(formStudentLevel.level);
        if (code) {
          setProgramCode(code);
        }
        const term = defaultTermForLevel(formStudentLevel.level, code);
        if (term) {
          setTermNo(term);
        }
      }
    }
  }, [formStudentLevel]);

  /**
   * Program groups the dropdown offers. Locked to the student's category.
   * The currently selected code is always kept so an existing class never loses its own program.
   */
  const programGroups = useMemo(() => {
    if (!formStudentLevel) return PROGRAM_GROUPS;
    const wanted = formStudentLevel.category;
    const filtered = PROGRAM_GROUPS.filter((g) => categorizeLevel(g.codes[0]) === wanted);
    if (filtered.length === 0) return PROGRAM_GROUPS;
    // Keep the current selection visible even if it sits outside the category.
    if (programCode && !filtered.some((g) => g.codes.includes(programCode))) {
      const home = PROGRAM_GROUPS.find((g) => g.codes.includes(programCode));
      if (home) return [...filtered, home];
    }
    return filtered;
  }, [formStudentLevel, programCode]);

  /** True when the chosen program does not match the student's own category. */
  const programMismatch = useMemo(() => {
    if (!formStudentLevel || !programCode) return null;
    const chosen = categorizeLevel(programCode);
    if (!chosen || chosen === formStudentLevel.category) return null;
    return { chosen, expected: formStudentLevel.category };
  }, [formStudentLevel, programCode]);

  /** The list the panel is currently scoped to, before searching. */
  const scopedStudents = studentScope === 'all' ? allStudentsAnnotated : unallocatedStudents;

  /**
   * Height the Recommended Days body is bounded to, matching the budget the
   * students card spends on its search block plus its five fixed rows.
   *
   * Rows are taller in All Students mode, so this tracks the mode rather than
   * being a fixed number — otherwise the two cards would drift apart whenever
   * the scope changed.
   */
  const recoBodyMaxHeight = panelBodyHeight(
    studentScope === 'all' ? STUDENT_ROW_H_WIDE : STUDENT_ROW_H
  );

  /**
   * The panel's list after its own search. Matches on name, level and branch,
   * so "puri" or "kinder" narrow the list as usefully as a name.
   */
  const visibleUnallocated = useMemo(() => {
    const q = unallocSearch.trim().toLowerCase();
    const bFilter = unallocBranchFilter.trim().toLowerCase();

    return scopedStudents.filter((st) => {
      if (bFilter !== 'all') {
        const stBranch = String(st.branchName || '').trim().toLowerCase();
        if (stBranch !== bFilter) return false;
      }
      if (q) {
        const hit = [st.name, st.level, st.branchName]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [scopedStudents, unallocSearch, unallocBranchFilter]);

  const openAddModal = () => {
    setEditingClass(null);
    setStartTime('');
    setProgramCode('');
    setTermNo('Term 1');
    setLessonNo('1');
    setProgramUnlocked(false);
    setJoinTime(null);
    setSessionDateDraft('');
    const addBranch = branchList[0] || '';
    setForm({
      day: branchOpenDays(addBranch)[0] || 'Monday',
      time: '',
      program: '',
      term: 'Term 1',
      teacher: '',
      student: '',
      branchName: addBranch,
      classType: 'Regular',
      sessionDates: [],
      remarks: ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  // Open the Add modal prefilled to allocate a specific unallocated student,
  // with the class type chosen in the pre-step.
  /**
   * @param {string} [presetTime] exact stored time label to reuse. Joining an
   *   existing class has to reproduce its label character for character, since
   *   that is what groups the rows into one class.
   */
  const openAllocateModal = (student, classType, presetDay, presetStart, presetTeacher, presetTime, joinProgram, presetTerm, presetLesson, presetCodeParam) => {
    setEditingClass(null);
    setStartTime(presetStart || '');
    const regClass = student?.regulars?.[0] || (placesByStudent.get(normalizeStudentName(student?.name)) || []).find((c) => (c.classType || 'Regular') === ATTENDANCE.REGULAR);
    const regParsed = regClass ? parseProgramValue(regClass.program) : null;
    const presetCode = presetCodeParam || dayReco?.programCode || regParsed?.code || defaultCodeForLevel(student?.level) || 'JF1';
    const joined = joinProgram ? parseProgramValue(joinProgram) : null;
    const initialLesson = presetLesson || dayReco?.lesson || (joined && presetCode && joined.code === presetCode ? joined.lesson : null) || regParsed?.lesson || '1';
    const initialTerm = presetTerm || dayReco?.term || regClass?.term || (regClass ? extractTermFromProgram(regClass.program, regClass.remarks) : null) || defaultTermForLevel(student?.level, presetCode);
    setProgramCode(presetCode);
    setLessonNo(initialLesson);
    setTermNo(initialTerm);
    setProgramUnlocked(false);
    setJoinTime(presetTime || null);
    setSessionDateDraft('');
    const allocBranch = student.branchName || branchList[0] || '';
    const openDays = branchOpenDays(allocBranch);
    const day = (presetDay && openDays.includes(presetDay)) ? presetDay : (openDays[0] || 'Monday');
    const seedDate = nextDateForDay(day);
    setForm({
      day,
      time: presetTime || (presetStart ? buildTimeSlot(presetStart, '') : ''),
      program: presetCode ? (codeHasLessons(presetCode) ? `${presetCode}.${initialLesson}` : presetCode) : '',
      term: initialTerm,
      teacher: presetTeacher || '',
      student: student.name || '',
      branchName: allocBranch,
      classType: classType || 'Regular',
      sessionDates: (isDatedKind(classType) && seedDate) ? [seedDate] : [],
      remarks: `${initialTerm} - L${initialLesson}`
    });
    setFormErrors({});
    setAllocChooser(null);
    setDayReco(null);
    setShowModal(true);
  };

  // After the class-type is chosen, surface the Recommended Days panel beside
  // the Unallocated list instead of opening the full modal immediately.
  const startDayReco = (student, classType, term = 'Term 1', lesson = '1', programCode = '') => {
    setDayReco({ student, classType, term, lesson, programCode, day: null });
    setAllocChooser(null);
    setTimePick(null);
  };

  /**
   * Classes the pending student could simply be added to, keyed by day.
   *
   * Filling a class that already has students is nearly always the better move:
   * the instructor is already committed to that window and the seat costs
   * nothing extra, whereas opening a fresh slot spends a whole new window of an
   * instructor's day on one student. So these are what the panel leads with.
   *
   * A group qualifies when it is at the student's branch, its programs may share
   * a slot with the student's own program under the configured rules, and a seat
   * is still free.
   */
  const joinTargetsByDay = useMemo(() => {
    const byDay = new Map();
    if (!dayReco || !dayReco.student) return byDay;
    const student = dayReco.student;
    const branch = student.branchName || '';
    // The program the student would be enrolled on — the same one the allocate
    // modal prefills, so the compatibility test matches what will be saved.
    const candidate = dayReco.programCode || defaultCodeForLevel(student.level) || student.level || '';
    if (!candidate) return byDay;

    const nameKey = String(student.name || '').trim().toLowerCase();

    for (const g of groupClasses(classes)) {
      if (branch && g.branchName !== branch) continue;
      if (!g.programs.length || g.startMin == null) continue;
      // Already in this class — there is nothing to join.
      if (g.students.some((s) => String(s || '').trim().toLowerCase() === nameKey)) continue;

      const verdict = canCombine(g.programs, candidate, rules);
      if (!verdict.ok) continue;

      // Only regulars hold a permanent seat; replacements and trials are guests
      // for a single week, so they must not make a class look full forever.
      const capacity = maxStudentsFor(g.programs[0], rules);
      const regulars = g.members.filter((m) => m.classType === ATTENDANCE.REGULAR).length;
      const guests = g.members.length - regulars;
      const seatsLeft = capacity - regulars;
      if (seatsLeft <= 0) continue;

      // Collect member details with their programs and lessons for comparison
      const memberDetails = (g.members || []).map((m) => {
        const pVal = parseProgramValue(m.program);
        const tVal = m.term || extractTermFromProgram(m.program, m.remarks);
        return {
          student: m.student,
          program: m.program,
          code: pVal.code || m.program,
          lesson: pVal.lesson || '1',
          term: tVal,
        };
      });

      const list = byDay.get(g.day) || [];
      list.push({
        key: g.key,
        day: g.day,
        time: g.time,
        startMin: g.startMin,
        endMin: g.endMin,
        teacher: g.teacher,
        students: g.students,
        members: memberDetails,
        programs: [...new Set(g.programs)],
        regulars,
        guests,
        capacity,
        seatsLeft,
        severity: verdict.severity,
        reason: verdict.reason,
      });
      byDay.set(g.day, list);
    }

    // Fullest first: a class one seat short of complete is the most valuable to
    // fill, and a clean combination outranks one that only just passes.
    for (const list of byDay.values()) {
      list.sort((a, b) => (a.severity === b.severity ? b.regulars - a.regulars
        : (a.severity === 'ok' ? -1 : 1)));
    }
    return byDay;
  }, [dayReco, classes, rules]);

  // Days recommended for the pending student. Days holding a class they can
  // join come first, fullest class first; days with nothing to join fall back to
  // the old least-busy-first ordering so a new class lands on a quiet day.
  const recoDays = useMemo(() => {
    if (!dayReco || !dayReco.student) return [];
    const branch = dayReco.student.branchName || '';
    const openDays = branch ? openDaysFor(branch) : DAY_NAMES;
    const days = openDays.length ? openDays : DAY_NAMES;
    return days
      .map((day) => {
        const joins = joinTargetsByDay.get(day) || [];
        return {
          day,
          count: classes.filter((c) => c.day === day && (!branch || c.branchName === branch)).length,
          joins,
          joinCount: joins.length,
          // How full the best class on this day already is — the tie-breaker.
          bestSeated: joins.reduce((max, j) => Math.max(max, j.regulars), 0),
        };
      })
      .sort((a, b) => {
        if ((a.joinCount > 0) !== (b.joinCount > 0)) return a.joinCount > 0 ? -1 : 1;
        if (a.joinCount > 0) {
          if (b.bestSeated !== a.bestSeated) return b.bestSeated - a.bestSeated;
          return b.joinCount - a.joinCount;
        }
        return a.count - b.count;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayReco, classes, openDaysFor, joinTargetsByDay]);

  // Candidate time slots for the chosen day, each annotated with whether a
  // capable instructor is free and — when not — why. Built from the branch's
  // operating hours (falling back to 9–6) and the student's program duration.
  const recoTimes = useMemo(() => {
    if (!dayReco || !dayReco.day) return { slots: [], hours: null, category: null };
    const student = dayReco.student;
    const branch = student.branchName || '';
    const day = dayReco.day;
    const hours = hoursFor(branch, day);

    const category = categorizeLevel(student.level);
    const duration = category === 'Kinder' ? 90 : 120;

    // Instructors physically at this branch that can teach the category.
    const capable = (instructors || []).filter((i) => {
      const brs = Array.isArray(i.branches) ? i.branches : [];
      const atBranch = !branch || brs.includes(branch) || brs.includes('All Branches');
      return atBranch && instructorHandles(i, category);
    });

    // Every existing class, as groups. Not filtered by branch — an instructor
    // teaching at another branch is not free here, which this panel used to miss.
    const groups = groupClasses(classes);

    /**
     * Availability verdict for a bookable window, from the shared engine so a
     * recommended time can never be one the save step would then reject.
     */
    const verdict = (label) => {
      if (capable.length === 0) {
        return { available: false, reason: category ? `No ${category} instructor at this branch` : 'No instructor at this branch', freeCount: 0 };
      }
      const win = classWindow(label);
      if (!win) return { available: false, reason: 'Could not read this time', freeCount: 0 };

      const verdicts = capable.map((i) => ({
        name: i.name,
        v: availabilityFor(i, {
          branchName: branch,
          day,
          startMin: win.start,
          endMin: win.end,
          category,
          classGroups: groups,
          leaves: [],
          date: null,
          blocks: [],
          hours: null,
          requireBranch: false,
        }),
      }));

      const free = verdicts.filter((x) => x.v.free);
      if (free.length === 0) {
        // Say what is actually in the way rather than a generic "all busy".
        const reasons = [...new Set(verdicts.map((x) => x.v.reason))];
        return {
          available: false,
          reason: reasons.length === 1 ? reasons[0] : `No instructor free — ${reasons.slice(0, 2).join('; ')}`,
          freeCount: 0,
        };
      }
      return { available: true, reason: `${free.length} instructor${free.length === 1 ? '' : 's'} free`, freeCount: free.length };
    };

    // Every 30 minutes across the operating hours. The Class Operation plan is
    // used to *describe* a window, never to restrict which windows exist: an
    // instructor with nothing booked at a time is available at that time, plan
    // or no plan. Previously only planned slots were offered, so a branch whose
    // plan held just a break showed no times at all.
    const openMin = hours ? parseHHMMToMin(hours.start) : 9 * 60;
    const closeMin = hours ? parseHHMMToMin(hours.end) : 18 * 60;
    const step = 30;

    const plan = Array.isArray(slotsFor(branch, day)) ? slotsFor(branch, day) : [];
    // Branch-wide blocked time. A break has no instructor; training and
    // meetings may name one, in which case they only block that person.
    const branchBlocks = plan.filter((s) => !slotTypeMeta(s.type).bookable && !s.instructor);

    const slots = [];
    if (openMin != null && closeMin != null) {
      for (let start = openMin; start + duration <= closeMin; start += step) {
        const end = start + duration;
        const label = `${formatClock(start)} - ${formatClock(end)}`;

        // What the plan says about this window, for context only.
        const planned = plan.find((s) => {
          const sMin = parseHHMMToMin(s.start);
          const eMin = parseHHMMToMin(s.end);
          return sMin != null && eMin != null && start < eMin && sMin < end;
        });
        const meta = planned ? slotTypeMeta(planned.type) : null;

        const free = capable.filter((i) => availabilityFor(i, {
          branchName: branch,
          day,
          startMin: start,
          endMin: end,
          category,
          classGroups: groups,
          leaves: [],
          date: null,
          // Personal training/meetings block only their own instructor.
          blocks: [
            ...branchBlocks,
            ...plan.filter((s) => !slotTypeMeta(s.type).bookable && s.instructor === i.name),
          ],
          hours: null,
          plannedSlots: plan.filter((s) => slotTypeMeta(s.type).bookable && s.instructor === i.name),
          requireBranch: false,
        }).free);

        let reason;
        if (capable.length === 0) {
          reason = category ? `No ${category} instructor at this branch` : 'No instructor at this branch';
        } else if (free.length === 0) {
          const blocked = branchBlocks.find((s) => {
            const sMin = parseHHMMToMin(s.start);
            const eMin = parseHHMMToMin(s.end);
            return sMin != null && eMin != null && start < eMin && sMin < end;
          });
          reason = blocked
            ? `${blocked.label || slotTypeMeta(blocked.type).label} ${blocked.start}–${blocked.end}`
            : 'Every capable instructor is busy';
        } else {
          reason = `${free.length} instructor${free.length === 1 ? '' : 's'} free`;
        }

        slots.push({
          startMin: start,
          start: minToHHMM(start),
          label,
          available: free.length > 0,
          freeCount: free.length,
          freeNames: free.map((i) => i.name),
          reason,
          // Only tag windows the plan actually earmarked for a class.
          planned: !!planned && meta?.bookable,
          typeKey: planned?.type || null,
          typeLabel: meta?.bookable ? meta.label : null,
          color: meta?.color || null,
          join: null,
        });
      }
    }

    // Times that already hold a class this student can join. These are attached
    // to the matching generated window where one exists — a window can be both
    // "join Risa's class" and "open a new one with someone else" — and added as
    // their own entry when the class does not sit on a 30-minute boundary.
    const joins = joinTargetsByDay.get(day) || [];
    for (const j of joins) {
      const existing = slots.find((s) => s.startMin === j.startMin);
      if (existing) {
        existing.join = j;
        existing.available = true;
        continue;
      }
      slots.push({
        startMin: j.startMin,
        start: minToHHMM(j.startMin),
        label: j.time,
        // The instructor is already teaching this window, so there is nothing
        // left to check — the only question was whether a seat was free.
        available: true,
        freeCount: 0,
        freeNames: [],
        reason: 'Existing class',
        planned: false,
        typeKey: null,
        typeLabel: null,
        color: null,
        join: j,
      });
    }

    // Joinable windows lead, fullest class first; everything else stays in
    // chronological order so the day still reads like a day.
    slots.sort((a, b) => {
      if (!!a.join !== !!b.join) return a.join ? -1 : 1;
      if (a.join && b.join && b.join.regulars !== a.join.regulars) {
        return b.join.regulars - a.join.regulars;
      }
      return a.startMin - b.startMin;
    });

    return {
      slots, hours, category, duration,
      capableCount: capable.length,
      hasPlan: plan.length > 0,
      joinCount: joins.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayReco, classes, instructors, hoursFor, slotsFor, joinTargetsByDay]);

  const openEditModal = (c) => {
    setEditingClass(c);
    setStartTime('');
    const parsed = parseProgramValue(c.program);
    const initialTerm = c.term || extractTermFromProgram(c.program, c.remarks);
    const initialLesson = c.lesson || parsed.lesson || '1';
    setProgramCode(parsed.code);
    setLessonNo(initialLesson);
    setTermNo(initialTerm);
    setProgramUnlocked(false);
    setJoinTime(null);
    setSessionDateDraft('');
    setForm({
      day: c.day || 'Monday',
      time: c.time || '',
      program: c.program || '',
      term: initialTerm,
      teacher: c.teacher || '',
      student: c.student || '',
      branchName: c.branchName || '',
      classType: c.classType || 'Regular',
      sessionDates: Array.isArray(c.sessionDates) ? c.sessionDates : [],
      remarks: c.remarks || ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  /**
   * Programs already taught in the slot this form targets, excluding the class
   * being edited so it isn't compared against itself.
   */
  const slotPrograms = useMemo(() => {
    if (!form.day || !form.time || !form.teacher || !form.branchName) return [];
    return classes
      .filter((c) =>
        c.day === form.day &&
        c.time === form.time &&
        c.teacher === form.teacher &&
        c.branchName === form.branchName &&
        (!editingClass || c.id !== editingClass.id)
      )
      .map((c) => c.program)
      .filter(Boolean);
  }, [classes, form.day, form.time, form.teacher, form.branchName, editingClass]);

  // Live verdict from the configurable Schedule Rules.
  const ruleCheck = useMemo(() => {
    if (!form.program || slotPrograms.length === 0) return null;
    return canCombine(slotPrograms, form.program, rules);
  }, [slotPrograms, form.program, rules]);

  /**
   * Classes that count against the form's instructor, as actual class groups.
   *
   * The slot the form is legitimately filling is excluded: adding a second
   * student to the same branch + day + time + instructor is joining a class,
   * not double-booking one. The Schedule Rules govern whether the programs may
   * share it. The row being edited is excluded so it can't clash with itself.
   */
  const conflictGroups = useMemo(() => {
    const rows = editingClass ? classes.filter((c) => c.id !== editingClass.id) : classes;
    return groupClasses(rows).filter((g) => !(
      g.teacher === form.teacher &&
      g.day === form.day &&
      g.time === form.time &&
      g.branchName === form.branchName
    ));
  }, [classes, editingClass, form.teacher, form.day, form.time, form.branchName]);

  /**
   * Availability of every instructor in the dropdown for the window the form
   * currently targets. Branch assignment is not re-checked here because the
   * dropdown is already scoped to the branch, and re-checking would block
   * edits to older rows whose instructor has since moved branch.
   */
  const teacherStatus = useMemo(() => {
    const out = new Map();
    const win = form.time ? classWindow(form.time) : null;
    if (!win || !form.day) return out;
    const category = parseProgram(form.program).category;

    for (const name of modalInstructors) {
      const inst = (instructors || []).find((i) => i.name === name);
      if (!inst) continue;
      out.set(name, availabilityFor(inst, {
        branchName: form.branchName,
        day: form.day,
        startMin: win.start,
        endMin: win.end,
        category,
        classGroups: conflictGroups,
        leaves: [],
        date: null,
        blocks: [],
        hours: null,
        requireBranch: false,
      }));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalInstructors, instructors, form.time, form.day, form.branchName, form.program, conflictGroups]);

  /** The blocking verdict for the instructor actually selected, if any. */
  const teacherConflict = useMemo(() => {
    if (!form.teacher) return null;
    const v = teacherStatus.get(form.teacher);
    return v && !v.free ? v : null;
  }, [teacherStatus, form.teacher]);

  /**
   * Who is qualified for the program in the form, independent of day and time.
   *
   * `teacherStatus` also checks this, but it returns an empty map until a day AND
   * a time are chosen, because everything else it reports is about a specific
   * window. Qualification is not: it is a fact about the instructor and the
   * programme. Deriving it separately is what stops an unqualified instructor
   * being picked — and saved — before a time has been entered.
   */
  const teacherQualification = useMemo(() => {
    const category = parseProgram(form.program).category;
    const out = new Map();
    for (const name of modalInstructors) {
      const inst = (instructors || []).find((i) => i.name === name);
      out.set(name, {
        category,
        level: inst?.level || '',
        // No category (a program that names none) means nothing to check.
        qualified: !category || levelCovers(inst?.level, category),
      });
    }
    return out;
  }, [modalInstructors, instructors, form.program]);

  /**
   * The instructors offered, split by whether they can teach this programme.
   *
   * Unqualified names are shown but disabled rather than removed. Removing them
   * would look like the instructor had vanished from the branch, and it would
   * silently drop the stored value when editing an older class whose teacher has
   * since changed level — so the currently selected name stays selectable
   * whatever its level.
   */
  const modalInstructorGroups = useMemo(() => {
    const qualified = [];
    const unqualified = [];
    for (const name of modalInstructors) {
      const q = teacherQualification.get(name);
      if (!q || q.qualified || name === form.teacher) qualified.push(name);
      else unqualified.push(name);
    }
    return { qualified, unqualified };
  }, [modalInstructors, teacherQualification, form.teacher]);

  const validateForm = () => {
    const errors = {};
    if (!form.time.trim()) errors.time = 'Time slot is required';
    if (!form.program.trim()) errors.program = 'Program/Lesson detail is required';
    if (!form.teacher) errors.teacher = 'Instructor is required';
    // Qualification first, and not via `teacherConflict`: that one is silent
    // until a day and a time are set, so a mismatched instructor used to save
    // cleanly whenever the time had not been filled in yet.
    else if (!(teacherQualification.get(form.teacher)?.qualified ?? true)) {
      const q = teacherQualification.get(form.teacher);
      errors.teacher = `${form.teacher} is ${q.level || 'unclassified'} — cannot teach ${q.category}`;
    }
    // Never let a save double-book an instructor. This check did not exist.
    else if (teacherConflict) errors.teacher = teacherConflict.reason;
    if (!form.student.trim()) errors.student = 'Student name is required';
    if (!form.branchName) errors.branchName = 'Branch is required';

    // A dated place with no dates would be indistinguishable from a weekly one
    // and would never expire, so it is not a valid save.
    if (isDatedKind(form.classType) && (form.sessionDates || []).length === 0) {
      errors.sessionDates = `A ${String(form.classType).toLowerCase()} needs at least one date`;
    }

    // Slot-combination rules. A 'warn' verdict is advisory and still saves.
    if (ruleCheck && !ruleCheck.ok) errors.program = ruleCheck.reason;

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Activity log lives in PostgreSQL so it records who made each change and is
  // shared across devices, rather than sitting in this browser's storage.
  useEffect(() => {
    const unsub = subscribeToActivity(
      (data) => setHistory(data || []),
      () => { /* the panel simply stays empty if the log is unreachable */ },
      { source: 'schedule', limit: 30 }
    );
    return () => unsub();
  }, []);

  const addHistory = async (entry) => {
    const created = await logActivity({ ...entry, source: 'schedule', userEmail: user?.email || null });
    // Show it immediately rather than waiting for the next poll.
    if (created) setHistory((prev) => [created, ...prev].slice(0, 30));
  };

  const clearHistory = async () => {
    if (!window.confirm('Clear the schedule activity log for everyone?')) return;
    try {
      await deleteActivity({ source: 'schedule' });
      setHistory([]);
    } catch (err) {
      showToast({ title: 'Could not clear activity', message: err.message, variant: 'error' });
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (editingClass) {
        const changes = computeScheduleDiff(editingClass, form);
        const summary = formatScheduleActivitySummary('edit', {
          student: form.student,
          program: form.program,
          branchName: form.branchName,
          day: form.day,
          time: form.time,
          teacher: form.teacher,
          classType: form.classType,
          changes,
        });

        await updateInternalClass(editingClass.id, form);
        showToast({ title: 'Class updated successfully', variant: 'success' });
        addHistory({
          action: 'edit',
          count: 1,
          summary,
          details: {
            student: form.student,
            program: form.program,
            branchName: form.branchName,
            previous: {
              teacher: editingClass.teacher || 'Unassigned',
              time: editingClass.time,
              day: editingClass.day,
              program: editingClass.program,
              branchName: editingClass.branchName,
              classType: editingClass.classType || 'Regular',
            },
            after: {
              teacher: form.teacher || 'Unassigned',
              time: form.time,
              day: form.day,
              program: form.program,
              branchName: form.branchName,
              classType: form.classType || 'Regular',
            },
            changes,
          },
        });
      } else {
        const summary = formatScheduleActivitySummary('add', {
          student: form.student,
          program: form.program,
          day: form.day,
          time: form.time,
          teacher: form.teacher,
          branchName: form.branchName,
          classType: form.classType,
        });

        await createInternalClass(form);
        showToast({ title: 'Class added successfully', variant: 'success' });
        addHistory({
          action: 'add',
          count: 1,
          summary,
          details: {
            student: form.student,
            program: form.program,
            day: form.day,
            time: form.time,
            teacher: form.teacher || 'Unassigned',
            branchName: form.branchName,
            classType: form.classType || 'Regular',
          },
        });
      }
      setShowModal(false);
    } catch (err) {
      console.error('Error saving class:', err);
      showToast({ title: 'Failed to save class', variant: 'error' });
    }
  };

  const handleClearAllClasses = async () => {
    const classCount = classes.length;
    if (classCount === 0) {
      showToast({ title: 'No schedule classes to clear', variant: 'warning' });
      return;
    }
    if (!window.confirm(`Are you sure you want to remove ALL ${classCount} schedule entries from Internal Operations?\n\nThis action cannot be undone.`)) {
      return;
    }
    try {
      const res = await bulkDeleteAllClasses();
      setClasses([]);
      await logActivity({
        action: 'delete',
        summary: `Cleared all ${res.count || classCount} internal schedule classes`,
        source: 'schedule',
        userEmail: user?.email || null,
        details: {
          count: res.count || classCount,
        },
      });
      showToast({
        title: `Successfully cleared ${res.count || classCount} schedule entries!`,
        variant: 'success',
      });
    } catch (err) {
      console.error('Error clearing internal schedule classes:', err);
      showToast({
        title: 'Failed to clear schedule classes',
        message: err?.message || 'Please retry.',
        variant: 'error',
      });
    }
  };

  // Read an uploaded workbook into preview rows.
  const handleBulkFile = async (file) => {
    if (!file) return;
    setBulkResult(null);
    try {
      const buf = await file.arrayBuffer();
      const { rows, errors } = parseScheduleWorkbook(buf);
      setBulkRows(rows);
      setBulkFileErrors(errors);
      setBulkFileName(file.name);
    } catch (err) {
      setBulkRows([]);
      setBulkFileErrors([{ line: 0, msg: err.message || 'Failed to read file' }]);
      setBulkFileName(file.name);
    }
  };

  // Bulk import: create every valid row (from file if uploaded, else the
  // pasted text), then log one history entry.
  const handleBulkImport = async () => {
    const fromFile = bulkRows.length > 0;
    const { rows, errors } = fromFile
      ? { rows: bulkRows, errors: bulkFileErrors }
      : parseBulkSchedule(bulkText);
    if (rows.length === 0) {
      setBulkResult({ ok: 0, failed: 0, errors, done: true });
      return;
    }
    setBulkImporting(true);
    let ok = 0;
    const failed = [];
    for (const row of rows) {
      try {
        await createInternalClass(row);
        ok += 1;
      } catch (err) {
        failed.push({ row, msg: err.message || 'failed' });
      }
    }
    setBulkImporting(false);
    setBulkResult({ ok, failed: failed.length, errors, done: true });
    if (ok > 0) {
      const branches = [...new Set(rows.map((r) => r.branchName))];
      addHistory({
        action: 'bulk',
        count: ok,
        summary: `Bulk imported ${ok} class${ok === 1 ? '' : 'es'}${branches.length ? ` @ ${branches.join(', ')}` : ''}`,
        details: {
          count: ok,
          branches,
        },
      });
      showToast({ title: `Imported ${ok} class${ok === 1 ? '' : 'es'}`, variant: failed.length ? 'warning' : 'success' });
    } else {
      showToast({ title: 'Nothing imported', message: 'Check the format and required fields.', variant: 'error' });
    }
  };

  const handleDelete = async (classId, studentName) => {
    if (!window.confirm(`Delete the class for student "${studentName}"?`)) return;
    const targetClass = classes.find((c) => c.id === classId);
    try {
      await deleteInternalClass(classId);
      showToast({ title: 'Class deleted successfully', variant: 'success' });
      const summary = formatScheduleActivitySummary('delete', {
        student: studentName,
        program: targetClass?.program,
        day: targetClass?.day,
        time: targetClass?.time,
        teacher: targetClass?.teacher,
        branchName: targetClass?.branchName,
        classType: targetClass?.classType,
      });
      addHistory({
        action: 'delete',
        count: 1,
        summary,
        details: {
          student: studentName,
          program: targetClass?.program,
          day: targetClass?.day,
          time: targetClass?.time,
          teacher: targetClass?.teacher,
          branchName: targetClass?.branchName,
        },
      });
      // Reset page if it becomes empty
      if (paged.length === 1 && page > 1) {
        setPage(page - 1);
      }
    } catch (err) {
      console.error('Error deleting class:', err);
      showToast({ title: 'Failed to delete class', variant: 'error' });
    }
  };

  return (
    <section className="dashboard-view active">
      {/* Top row: the student list beside the recommendations, matched in
          height because the two are read together — you pick on the left and
          the answer appears on the right. `stretch` is what keeps them equal;
          the panels themselves are columns so their bodies take up the slack. */}
      {/* Both children are toggled together, so the row collapses to nothing
          when the panel is hidden — hence the conditional margin. */}
      {/*
        Both columns stretch to the taller one, so whichever card grows sets the
        row height for both. The students list is already capped in pixels; the
        Recommended Days lists are capped to the same value so neither column can
        pull the other out of shape.
      */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem',
        alignItems: 'stretch', marginBottom: showUnallocated ? '1.5rem' : 0,
      }}>

        {/* Unallocated Students sidebar */}
        {showUnallocated && (
          <div data-tour="student-scope" className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.15rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {studentScope === 'all' ? <Users size={16} /> : <UserX size={16} />}
                {/* The title is the scope switch, so the panel can serve both
                    "who still needs a class" and "book an extra for anyone". */}
                <ScopeSwitch
                  value={studentScope}
                  onChange={(next) => { setStudentScope(next); setUnallocSearch(''); }}
                />
                <span style={{
                  fontSize: '0.72rem', fontWeight: 700,
                  color: studentScope === 'all'
                    ? 'var(--text-secondary)'
                    : (unallocatedStudents.length > 0 ? 'var(--danger)' : 'var(--success, #10b981)'),
                  background: studentScope === 'all'
                    ? 'var(--bg-color)'
                    : (unallocatedStudents.length > 0 ? 'var(--danger-bg, rgba(239,68,68,0.12))' : 'rgba(16,185,129,0.12)'),
                  padding: '0.05rem 0.45rem', borderRadius: '99px',
                }}>
                  {scopedStudents.length}
                </span>
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {studentScope === 'all'
                  ? 'Everyone, across all branches. Click to book a replacement or an extra session.'
                  : 'Students not yet assigned to a class. Click to allocate.'}
              </span>
            </div>

            <div style={{ padding: '0.85rem 1rem', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {students.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                  No students in the list yet. Add them under Students.
                </p>
              ) : scopedStudents.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--success, #10b981)', margin: 0, fontWeight: 500 }}>
                  All students are allocated. 🎉
                </p>
              ) : (
                <>
                  {/* Search within the panel. Only worth showing once the list
                      is long enough that scanning it is the slower option. */}
                  {scopedStudents.length > 3 && (
                    <div style={{ marginBottom: '0.55rem' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                          <Search
                            size={14}
                            aria-hidden="true"
                            style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
                          />
                          <input
                            type="search"
                            value={unallocSearch}
                            onChange={(e) => setUnallocSearch(e.target.value)}
                            placeholder="Search name, level or branch"
                            aria-label={studentScope === 'all' ? 'Search all students' : 'Search unallocated students'}
                            className="modal-input-field field-compact"
                            style={{ width: '100%', paddingLeft: '1.9rem', paddingRight: unallocSearch ? '1.9rem' : undefined }}
                          />
                          {unallocSearch && (
                            <button
                              type="button"
                              onClick={() => setUnallocSearch('')}
                              aria-label="Clear search"
                              title="Clear search"
                              style={{
                                position: 'absolute', right: '0.45rem', top: '50%', transform: 'translateY(-50%)',
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                color: 'var(--text-muted)', padding: '0.15rem', lineHeight: 0,
                              }}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>

                        <select
                          value={unallocBranchFilter}
                          onChange={(e) => setUnallocBranchFilter(e.target.value)}
                          className="modal-select-field field-compact"
                          style={{ width: '135px', fontSize: '0.78rem' }}
                          aria-label="Filter unallocated students by branch"
                        >
                          <option value="all">All Branches</option>
                          {branchList.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </div>
                      {(unallocSearch || unallocBranchFilter !== 'all') && (
                        <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                          {visibleUnallocated.length} of {scopedStudents.length} shown
                        </span>
                      )}
                    </div>
                  )}

                  {visibleUnallocated.length === 0 ? (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                      No {studentScope === 'all' ? 'student' : 'unallocated student'} matches &ldquo;{unallocSearch}&rdquo;.
                    </p>
                  ) : (
                // Five rows tall at most, scrolling beyond that. A shorter list
                // shrinks rather than leaving dead space.
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  gap: `${STUDENT_ROW_GAP}px`,
                  maxHeight: studentListHeight(studentScope === 'all' ? STUDENT_ROW_H_WIDE : STUDENT_ROW_H),
                  overflowY: 'auto',
                }}>
                  {visibleUnallocated.map((st) => {
                    // In All Students mode the regular place is the thing a
                    // replacement or extra session is measured against, so it
                    // has to be on the row.
                    const showPlaces = studentScope === 'all';
                    const home = showPlaces ? (st.regulars || [])[0] : null;
                    return (
                    <button
                      key={st.id}
                      onClick={() => handleOpenAllocChooser(st)}
                      title={showPlaces
                        ? `Book a replacement or extra session for ${st.name}`
                        : `Allocate ${st.name} to a class`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', textAlign: 'left',
                        // Fixed so five rows is exactly five rows. Every line
                        // inside is clipped to one line to hold that promise.
                        height: showPlaces ? STUDENT_ROW_H_WIDE : STUDENT_ROW_H,
                        flexShrink: 0, boxSizing: 'border-box', overflow: 'hidden',
                        padding: '0 0.6rem', borderRadius: '8px', cursor: 'pointer',
                        border: '1px solid var(--border-color)', background: 'var(--bg-color)',
                      }}
                    >
                      <User size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                      <span style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {st.name}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[st.level, st.branchName].filter(Boolean).join(' · ') || '—'}
                        </span>
                        {showPlaces && (
                          <span style={{ display: 'block', fontSize: '0.66rem', color: home ? 'var(--text-secondary)' : 'var(--danger)', marginTop: '0.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {home
                              ? `${home.day} ${home.time} · ${home.teacher}`
                              : 'No regular class yet'}
                            {st.extraCount > 0 && ` · ${st.extraCount} dated session${st.extraCount === 1 ? '' : 's'}`}
                          </span>
                        )}
                      </span>
                      {showPlaces && st.regularCount > 1 && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>
                          {st.regularCount}×
                        </span>
                      )}
                    </button>
                    );
                  })}
                </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}


        {/* Recommended Days — beside Unallocated. Appears after a student's
            class type is chosen; clicking a day opens the allocate popup. */}
        {showUnallocated && (
          <div className="panel new-ops-anim" style={{ margin: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.15rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Calendar size={16} /> Recommended Days
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {!dayReco
                  ? 'Pick a student from Unallocated, choose a class type, then select a day.'
                  : !dayReco.day
                    ? `${dayReco.student.name} · ${dayReco.classType} Class — classes with a free seat come first`
                    : `${dayReco.student.name} · ${dayReco.day} — pick a time`}
              </span>
            </div>

            {/*
              Bounded here rather than on the lists inside. This is the only
              element that sees every branch — day list, time list, the
              no-instructor warning and an expanded slot's instructor picker —
              so capping it is what stops any of them stretching the grid row
              and dragging the students card with it. Whichever list is showing
              takes the space left over and scrolls.
            */}
            <div style={{
              padding: '0.85rem 1rem', flex: 1,
              display: 'flex', flexDirection: 'column',
              minHeight: 0, maxHeight: recoBodyMaxHeight,
            }}>
              {!dayReco ? (
                /* The empty state grows to fill the panel, so the two columns
                   stay the same height before a student is picked. */
                <div style={{
                  flex: 1,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '0.5rem', padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)',
                  border: '1px dashed var(--border-color)', borderRadius: '10px',
                }}>
                  <Calendar size={22} style={{ opacity: 0.5 }} />
                  <span style={{ fontSize: '0.8rem' }}>
                    {studentScope === 'all'
                      ? 'No student selected. Click a student to book a replacement or an extra session.'
                      : 'No student selected. Click an unallocated student to see recommended days for their branch.'}
                  </span>
                </div>
              ) : (
                <>
                  {/* Context row: class type + student meta + cancel */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: '99px',
                      color: dayReco.classType === 'Trial' ? '#ea580c' : 'var(--primary-blue, #4f46e5)',
                      background: dayReco.classType === 'Trial' ? 'rgba(249,115,22,0.12)' : 'var(--primary-blue-light, rgba(79,70,229,0.1))',
                    }}>
                      {dayReco.classType} Class
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {[dayReco.student.level, dayReco.student.branchName].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <button
                      onClick={() => setDayReco(null)}
                      style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                    >
                      <X size={13} /> Cancel
                    </button>
                  </div>

                  {!dayReco.day ? (
                    /* Step 1 — day picker. Takes the space the bounded body has
                       left and scrolls inside it, so it needs no cap of its
                       own: `minHeight: 0` is what lets a flex child shrink
                       below its content and actually scroll. */
                    <div style={{
                      display: 'flex', flexDirection: 'column', gap: '0.4rem',
                      flex: 1, minHeight: 0,
                      overflowY: 'auto',
                    }}>
                      {/* Say which rule the list is following, so an ordering
                          that is not chronological does not look arbitrary. */}
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>
                        {recoDays.some((rd) => rd.joinCount > 0)
                          ? 'Ordered by classes this student can be added to, fullest first.'
                          : `No existing class has a free seat for ${dayReco.student.level || 'this student'} — ordered by quietest day.`}
                      </span>
                      {recoDays.map((rd, i) => (
                        <button
                          key={rd.day}
                          onClick={() => setDayReco((prev) => ({ ...prev, day: rd.day }))}
                          title={rd.joinCount
                            ? `${rd.day}: ${rd.joinCount} class${rd.joinCount === 1 ? '' : 'es'} with a free seat for ${dayReco.student.name}`
                            : `See times for ${rd.day}`}
                          className="new-ops-anim"
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%', textAlign: 'left',
                            padding: '0.6rem 0.75rem', borderRadius: '10px', cursor: 'pointer',
                            border: `1px solid ${rd.joinCount ? 'rgba(16,185,129,0.55)' : (i === 0 ? 'var(--primary-blue, #4f46e5)' : 'var(--border-color)')}`,
                            background: rd.joinCount
                              ? 'rgba(16,185,129,0.07)'
                              : (i === 0 ? 'var(--primary-blue-light, rgba(79,70,229,0.08))' : 'var(--bg-color)'),
                          }}
                        >
                          <Calendar size={15} style={{ flexShrink: 0, color: rd.joinCount ? 'var(--success, #10b981)' : (i === 0 ? 'var(--primary-blue, #4f46e5)' : 'var(--text-muted)') }} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
                              {rd.day}
                            </span>
                            {/* Say which class can be filled, not just that one
                                can — the time is the thing being chosen next. */}
                            {rd.joinCount > 0 && (
                              <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--success, #10b981)' }}>
                                {rd.joins[0].time} · {rd.joins[0].teacher} has{' '}
                                {rd.joins[0].regulars}/{rd.joins[0].capacity} seated
                                {rd.joinCount > 1 ? ` · +${rd.joinCount - 1} more` : ''}
                              </span>
                            )}
                          </span>
                          {rd.joinCount > 0 ? (
                            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--success, #10b981)', background: 'rgba(16,185,129,0.14)', padding: '0.1rem 0.4rem', borderRadius: '5px', flexShrink: 0 }}>
                              CAN JOIN
                            </span>
                          ) : i === 0 && (
                            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--primary-blue, #4f46e5)', background: 'rgba(79,70,229,0.12)', padding: '0.1rem 0.4rem', borderRadius: '5px', flexShrink: 0 }}>
                              QUIETEST
                            </span>
                          )}
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                            {rd.count} class{rd.count === 1 ? '' : 'es'}
                          </span>
                        </button>
                      ))}
                      {recoDays.length === 0 && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                          No open days configured for this branch. Set them under Operationals.
                        </p>
                      )}
                    </div>
                  ) : (
                    /* Step 2 — time picker for the chosen day */
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.6rem' }}>
                        <button
                          onClick={() => { setTimePick(null); setDayReco((prev) => ({ ...prev, day: null })); }}
                          style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.25rem 0.6rem', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          ← Days
                        </button>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                          {recoTimes.hours
                            ? `Open ${recoTimes.hours.start}–${recoTimes.hours.end}`
                            : 'Hours not set (9–6 assumed)'}
                          {recoTimes.category ? ` · ${recoTimes.category} ${recoTimes.duration}m` : ''}
                        </span>
                      </div>

                      {/* No point listing a dozen windows that all fail for the
                          same reason — say it once. */}
                      {recoTimes.capableCount === 0 && recoTimes.joinCount === 0 ? (
                        <div style={{
                          display: 'flex', gap: '0.5rem', padding: '0.7rem 0.85rem', borderRadius: '10px',
                          background: 'var(--danger-bg, rgba(239,68,68,0.08))', border: '1px solid rgba(239,68,68,0.3)',
                        }}>
                          <AlertTriangle size={15} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '0.1rem' }} />
                          <span style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>
                            No instructor at {dayReco.student.branchName || 'this branch'} can teach{' '}
                            {recoTimes.category || 'this program'}. Assign a capable instructor to the branch
                            under Instructors, or set the time manually.
                          </span>
                        </div>
                      ) : (
                      /* Scrolls within the bounded body, like the day list. This
                         is the list that showed the problem: picking a slot
                         expands an instructor picker inline, so the content
                         grows after render and has to be absorbed here rather
                         than pushing the card taller. */
                      <div style={{
                        display: 'flex', flexDirection: 'column', gap: '0.4rem',
                        flex: 1, minHeight: 0,
                        overflowY: 'auto',
                      }}>
                        {recoTimes.slots.map((sl) => {
                          const picked = timePick === sl.start;
                          const j = sl.join;
                          return (
                          <div key={sl.start}>
                            <button
                              onClick={() => sl.available && setTimePick(picked ? null : sl.start)}
                              disabled={!sl.available}
                              title={j
                                ? `${j.teacher} already teaches ${j.regulars} student${j.regulars === 1 ? '' : 's'} at ${j.time} — ${j.seatsLeft} seat${j.seatsLeft === 1 ? '' : 's'} left`
                                : (sl.available ? `${sl.freeCount} instructor(s) free at ${sl.label}` : sl.reason)}
                              className="new-ops-anim"
                              aria-expanded={picked}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%', textAlign: 'left',
                                padding: '0.55rem 0.75rem',
                                borderRadius: picked ? '10px 10px 0 0' : '10px',
                                cursor: sl.available ? 'pointer' : 'not-allowed',
                                opacity: sl.available ? 1 : 0.7,
                                border: `1px solid ${j ? 'rgba(16,185,129,0.75)' : (sl.available ? 'rgba(16,185,129,0.5)' : 'var(--border-color)')}`,
                                borderLeft: j ? '3px solid var(--success, #10b981)' : undefined,
                                background: j ? 'rgba(16,185,129,0.12)' : (sl.available ? 'rgba(16,185,129,0.06)' : 'var(--bg-color)'),
                              }}
                            >
                              {j
                                ? <Users size={15} style={{ flexShrink: 0, color: 'var(--success, #10b981)' }} />
                                : <Clock size={15} style={{ flexShrink: 0, color: sl.available ? 'var(--success, #10b981)' : 'var(--text-muted)' }} />}
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', flexWrap: 'wrap' }}>
                                  {j ? j.time : sl.label}
                                  {j && (
                                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#047857', background: 'rgba(16,185,129,0.2)', padding: '0.05rem 0.35rem', borderRadius: '5px', whiteSpace: 'nowrap' }}>
                                      FILL THIS CLASS
                                    </span>
                                  )}
                                  {!j && sl.planned && sl.typeLabel && (
                                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: sl.color, background: `${sl.color}1f`, padding: '0.05rem 0.35rem', borderRadius: '5px', whiteSpace: 'nowrap' }}>
                                      {sl.typeLabel}
                                    </span>
                                  )}
                                </span>
                                {/* Who is already in it, so the choice is made on
                                    the actual class rather than a bare time. */}
                                {j ? (
                                  <>
                                    <span style={{ display: 'block', fontSize: '0.68rem', color: '#047857' }}>
                                      {j.teacher} · {j.programs.join(', ')} · {j.regulars}/{j.capacity} seated
                                      {j.guests > 0 ? ` (+${j.guests} guest${j.guests === 1 ? '' : 's'})` : ''}
                                    </span>
                                    {/* Student Lesson Comparison */}
                                    {j.members && j.members.length > 0 ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.35rem' }}>
                                        <div style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                          Student Lessons in Slot:
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                          {j.members.map((m, mi) => (
                                            <span
                                              key={mi}
                                              style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                fontSize: '0.68rem', padding: '0.12rem 0.45rem', borderRadius: '5px',
                                                background: 'rgba(0,0,0,0.04)', border: '1px solid var(--border-color)',
                                                color: 'var(--text-main)',
                                              }}
                                            >
                                              <span style={{ fontWeight: 600 }}>{m.student}</span>
                                              <span style={{ color: '#7c3aed', fontWeight: 700 }}>({m.code} · L{m.lesson})</span>
                                            </span>
                                          ))}
                                          {dayReco?.student && (
                                            <span
                                              style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                fontSize: '0.68rem', padding: '0.12rem 0.45rem', borderRadius: '5px',
                                                background: 'rgba(79, 70, 229, 0.1)', border: '1px dashed #4f46e5',
                                                color: '#4338ca', fontWeight: 700,
                                              }}
                                            >
                                              + {dayReco.student.name} ({dayReco.programCode || 'J1'} · L{dayReco.lesson || '1'})
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ) : (
                                      <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {j.students.join(', ')}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span style={{ display: 'block', fontSize: '0.68rem', color: sl.available ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)' }}>
                                    {sl.available ? `✓ ${sl.reason}` : `✕ ${sl.reason}`}
                                  </span>
                                )}
                              </span>
                              {sl.available && (
                                <span style={{ fontSize: '0.68rem', fontWeight: j ? 700 : 400, color: j ? '#047857' : 'var(--text-muted)', flexShrink: 0 }}>
                                  {picked ? 'pick below' : (j ? `${j.seatsLeft} seat${j.seatsLeft === 1 ? '' : 's'} left` : 'choose')}
                                </span>
                              )}
                            </button>

                            {/* Which of the free instructors should take it. */}
                            {picked && (
                              <div
                                className="new-ops-anim"
                                style={{
                                  border: '1px solid rgba(16,185,129,0.5)', borderTop: 'none',
                                  borderRadius: '0 0 10px 10px', padding: '0.5rem 0.6rem',
                                  background: 'var(--panel-bg)',
                                  display: 'flex', flexDirection: 'column', gap: '0.3rem',
                                }}
                              >
                                {/* Joining the class that is already running is
                                    the recommended action, so it comes first and
                                    skips the instructor question entirely. */}
                                {j && (
                                  <>
                                    <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.03em', color: '#047857' }}>
                                      JOIN THE EXISTING CLASS
                                    </span>
                                    <button
                                      onClick={() => openAllocateModal(dayReco.student, dayReco.classType, dayReco.day, sl.start, j.teacher, j.time, j.programs[0], dayReco.term, dayReco.lesson, dayReco.programCode)}
                                      title={`Add ${dayReco.student.name} to ${j.teacher}'s ${j.time} class`}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', textAlign: 'left',
                                        padding: '0.45rem 0.6rem', borderRadius: '8px', cursor: 'pointer',
                                        border: '1px solid rgba(16,185,129,0.6)', background: 'rgba(16,185,129,0.1)',
                                      }}
                                    >
                                      <Users size={14} style={{ flexShrink: 0, color: 'var(--success, #10b981)' }} />
                                      <span style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                                          {j.teacher}
                                        </span>
                                        <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                                          {j.regulars} seated · {j.seatsLeft} free · {j.programs.join(', ')}
                                        </span>
                                      </span>
                                      <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#047857', flexShrink: 0 }}>
                                        Join →
                                      </span>
                                    </button>
                                    {j.severity === 'warn' && (
                                      <span style={{ fontSize: '0.66rem', color: 'var(--warning, #f59e0b)' }}>
                                        {j.reason}
                                      </span>
                                    )}
                                  </>
                                )}
                                {sl.freeNames.length > 0 && (
                                  <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.03em', color: 'var(--text-muted)', marginTop: j ? '0.35rem' : 0 }}>
                                    {j ? 'OR START A SEPARATE CLASS' : 'AVAILABLE INSTRUCTOR'}
                                  </span>
                                )}
                                {sl.freeNames.map((name) => {
                                  const inst = (instructors || []).find((i) => i.name === name);
                                  return (
                                    <button
                                      key={name}
                                      onClick={() => openAllocateModal(dayReco.student, dayReco.classType, dayReco.day, sl.start, name, null, null, dayReco.term, dayReco.lesson, dayReco.programCode)}
                                      title={`Allocate ${dayReco.student.name} to ${name} at ${sl.label}`}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', textAlign: 'left',
                                        padding: '0.45rem 0.6rem', borderRadius: '8px', cursor: 'pointer',
                                        border: '1px solid var(--border-color)', background: 'var(--bg-color)',
                                      }}
                                    >
                                      <User size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                                      <span style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                                          {name}
                                        </span>
                                        <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                                          {inst?.level || 'Level not set'}
                                        </span>
                                      </span>
                                      <span style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--primary-blue, #4f46e5)', flexShrink: 0 }}>
                                        Allocate →
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          );
                        })}
                        {recoTimes.slots.length === 0 && (
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                            No window long enough for a {recoTimes.duration}m class on this day.
                            Widen the operating hours under Operationals.
                          </p>
                        )}
                        {recoTimes.slots.length > 0 && recoTimes.slots.every((s) => !s.available) && (
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
                            Every window is taken on {dayReco.day}. Try another day, or set the time manually.
                          </p>
                        )}
                      </div>
                      )}

                      {/* Manual time entry — bypass recommendations */}
                      <button
                        onClick={() => openAllocateModal(dayReco.student, dayReco.classType, dayReco.day)}
                        className="new-ops-anim"
                        style={{
                          marginTop: '0.7rem', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          gap: '0.4rem', padding: '0.55rem 0.75rem', borderRadius: '10px', cursor: 'pointer',
                          border: '1px dashed var(--primary-blue, #4f46e5)', background: 'transparent',
                          color: 'var(--primary-blue, #4f46e5)', fontSize: '0.8rem', fontWeight: 600,
                        }}
                      >
                        <Pencil size={14} /> Set time manually
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>


      {/* Schedule Activity — its own full-width row. The entries are short,
          so they tile horizontally rather than forming a narrow column that
          wastes the width. */}
      <div className="panel" style={{ margin: '0 0 1.5rem' }}>
          <div className="panel-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <History size={16} /> Schedule Activity
              <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-muted)' }}>({history.length})</span>
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {onNavigate && (
                <button
                  onClick={() => onNavigate('activity')}
                  className="btn"
                  style={{ fontSize: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.3rem 0.7rem', color: 'var(--primary-blue, #4f46e5)', background: 'transparent' }}
                >
                  View all
                </button>
              )}
              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.3rem 0.7rem', color: 'var(--text-secondary)', background: 'transparent' }}
                >
                  <Trash size={13} /> Clear
                </button>
              )}
            </div>
          </div>
          <div style={{ padding: '0.5rem 1rem 1rem' }}>
            {history.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0' }}>
                No activity yet. Adding, editing, importing, or deleting classes will be logged here.
              </p>
            ) : (
              // Entries tile across the width instead of stacking, so the full
              // row is used and recent activity is visible without scrolling.
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                gap: '0.5rem', maxHeight: '210px', overflowY: 'auto',
              }}>
                {history.map((h, i) => {
                  const meta = {
                    add: { color: '#059669', bg: 'rgba(5,150,105,0.12)', label: 'ADD' },
                    bulk: { color: '#4f46e5', bg: 'rgba(79,70,229,0.12)', label: 'BULK' },
                    edit: { color: '#d97706', bg: 'rgba(217,119,6,0.12)', label: 'EDIT' },
                    delete: { color: '#dc2626', bg: 'rgba(220,38,38,0.12)', label: 'DELETE' },
                  }[h.action] || { color: 'var(--text-muted)', bg: 'var(--bg-color)', label: (h.action || '').toUpperCase() };
                  const when = new Date(h.createdAt || h.at);
                  const parsed = parseActivityChanges(h);

                  return (
                    <div
                      key={h.id ?? i}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: '0.35rem',
                        padding: '0.55rem 0.75rem', borderRadius: '8px',
                        background: 'var(--bg-color)', border: '1px solid var(--border-color)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                          <span style={{ fontSize: '0.62rem', fontWeight: 700, color: meta.color, background: meta.bg, padding: '0.1rem 0.4rem', borderRadius: '5px', flexShrink: 0 }}>
                            {meta.label}
                          </span>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {parsed.title}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                          {isNaN(when.getTime()) ? '' : when.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      {/* Before / After Diff Badges */}
                      {parsed.hasChanges ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.1rem' }}>
                          {parsed.changes.map((c, ci) => (
                            <span
                              key={ci}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                fontSize: '0.72rem', padding: '0.15rem 0.45rem', borderRadius: '6px',
                                background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)',
                                color: 'var(--text-main)',
                              }}
                            >
                              <strong style={{ color: '#d97706', fontWeight: 600 }}>{c.field}:</strong>
                              <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{c.before}</span>
                              <span style={{ color: '#d97706', fontWeight: 700 }}>→</span>
                              <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{c.after}</span>
                            </span>
                          ))}
                        </div>
                      ) : !parsed.title.includes(h.summary) && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          {h.summary}
                        </div>
                      )}

                      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                        by {displayUser(h.userEmail)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      {/* Availability-first planning grid, above the full class table.
          `onNavigate` is threaded down so a student in a class card can open
          their report card. */}
      <ScheduleGridPanel onNavigate={onNavigate} />

      <div data-tour="schedule-grid" className="panel full-schedule-panel">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Internal Operations Schedule</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Manage and view active classes directly inside the application.
            </p>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button
              onClick={() => { setBulkText(''); setBulkResult(null); setBulkRows([]); setBulkFileErrors([]); setBulkFileName(''); setShowBulk(true); }}
              className="btn"
              title="Import multiple classes at once"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 0.9rem', fontSize: '0.82rem',
                border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)',
              }}
            >
              <Upload size={15} /> Bulk Import
            </button>
            <button
              onClick={() => setShowUnallocated((v) => !v)}
              className="btn"
              title="Toggle the unallocated students panel"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 0.9rem', fontSize: '0.82rem',
                border: '1px solid var(--border-color)',
                background: showUnallocated ? 'var(--primary-blue-light)' : 'transparent',
                color: showUnallocated ? 'var(--primary-blue)' : 'var(--text-secondary)',
              }}
            >
              <UserX size={15} /> Unallocated
              {unallocatedStudents.length > 0 && (
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-bg, rgba(239,68,68,0.12))', padding: '0.02rem 0.4rem', borderRadius: '99px' }}>
                  {unallocatedStudents.length}
                </span>
              )}
            </button>
            <button
              onClick={handleClearAllClasses}
              className="btn"
              title="Remove all schedule data in Internal Operations"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 0.9rem', fontSize: '0.82rem',
                border: '1px solid var(--danger, #ef4444)', background: 'rgba(239, 68, 68, 0.08)', color: 'var(--danger, #ef4444)',
                cursor: classes.length === 0 ? 'not-allowed' : 'pointer',
                opacity: classes.length === 0 ? 0.6 : 1,
              }}
              disabled={classes.length === 0}
            >
              <Trash2 size={15} /> Clear All Data
            </button>
            <button 
              data-tour="add-class-btn"
              onClick={openAddModal} 
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
            >
              <Plus size={16} /> Add Class
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', background: 'var(--bg-color)' }}>
          <div className="input-group" style={{ margin: 0, flex: '1 1 200px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Search</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search student, teacher, class..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ paddingLeft: '2rem', width: '100%' }}
              />
            </div>
          </div>
          
          <div data-tour="branch-filter" className="input-group" style={{ margin: 0, width: '150px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Branch</label>
            <select
              value={filterBranch}
              onChange={(e) => {
                const nextBranch = e.target.value;
                setFilterBranch(nextBranch);
                setPage(1);
                // Reset instructor if it no longer belongs to the new branch.
                if (filterInstructor !== 'all' && nextBranch !== 'all') {
                  const valid = (instructors || []).some((i) => i.name === filterInstructor && (i.branches || []).includes(nextBranch));
                  if (!valid) setFilterInstructor('all');
                }
              }}
              style={{ width: '100%' }}
            >
              <option value="all">All Branches</option>
              {branchList.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '160px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Instructor</label>
            <select
              value={filterInstructor}
              onChange={(e) => { setFilterInstructor(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">{filterBranch === 'all' ? 'All Instructors' : `All @ ${filterBranch}`}</option>
              {toolbarInstructors.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '150px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Program</label>
            <select
              value={filterProgram}
              onChange={(e) => { setFilterProgram(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Programs</option>
              {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '150px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Time</label>
            <select
              value={filterTime}
              onChange={(e) => { setFilterTime(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Times</option>
              {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '140px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Class Type</label>
            <select
              value={filterClassType}
              onChange={(e) => { setFilterClassType(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Types</option>
              <option value={ATTENDANCE.REGULAR}>Regular Class</option>
              <option value={ATTENDANCE.REPLACEMENT}>Replacement</option>
              <option value={ATTENDANCE.ADDITIONAL}>Additional Session</option>
              <option value={ATTENDANCE.TRIAL}>Trial Class</option>
              <option value="expired">Past dated sessions</option>
            </select>
          </div>
        </div>

        {/* Day Tabs */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <button
            onClick={() => { setFilterDay('all'); setPage(1); }}
            style={{
              padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
              border: filterDay === 'all' ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
              background: filterDay === 'all' ? 'var(--primary-blue-light)' : 'transparent',
              fontWeight: filterDay === 'all' ? 600 : 400,
              color: filterDay === 'all' ? 'var(--primary-blue)' : 'var(--text-secondary)',
              transition: 'all 0.2s'
            }}
          >
            All Days
          </button>
          {DAY_NAMES.map(day => (
            <button
              key={day}
              onClick={() => { setFilterDay(day); setPage(1); }}
              style={{
                padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
                border: filterDay === day ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                background: filterDay === day ? 'var(--primary-blue-light)' : 'transparent',
                fontWeight: filterDay === day ? 600 : 400,
                color: filterDay === day ? 'var(--primary-blue)' : 'var(--text-secondary)',
                transition: 'all 0.2s'
              }}
            >
              {day}
            </button>
          ))}
        </div>

        {/* Main Table */}
        <div className="panel-body table-wrapper" style={{ position: 'relative' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
              <div className="loading-spinner" style={{ marginBottom: '1rem' }} />
              <p>Fetching schedule from the database...</p>
            </div>
          ) : loadError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3.5rem 1.5rem', color: 'var(--text-muted)', textAlign: 'center', gap: '0.4rem' }}>
              <AlertTriangle size={32} style={{ color: 'var(--danger)', marginBottom: '0.25rem' }} />
              <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>Couldn&apos;t load the schedule</div>
              <div style={{ fontSize: '0.82rem', maxWidth: '460px' }}>{loadError}</div>
              <div style={{ fontSize: '0.75rem', marginTop: '0.35rem' }}>
                Locally this usually means <code>DATABASE_URL</code> isn&apos;t set in <code>.env.local</code>. It retries automatically.
              </div>
            </div>
          ) : (
            <table id="schedule-table">
              <thead>
                <tr>
                  <th style={{ width: '120px' }}>Day</th>
                  <th style={{ width: '140px' }}>Time</th>
                  <th style={{ width: '150px' }}>Program / Lesson</th>
                  <th style={{ width: '120px' }}>Class Type</th>
                  <th>Student Name</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>Capacity</th>
                  <th style={{ width: '180px' }}>Instructor</th>
                  <th style={{ width: '140px' }}>Branch</th>
                  <th>Remarks</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {classes.length === 0 ? (
                  <tr>
                    <td colSpan="10" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <AlertTriangle size={32} style={{ color: 'var(--warning)', marginBottom: '0.5rem' }} />
                      <div style={{ fontWeight: 600 }}>No Classes Configured</div>
                      <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>Click "Add Class" to populate your website schedule.</div>
                    </td>
                  </tr>
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan="10" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <div style={{ fontWeight: 600 }}>No results match your filters.</div>
                    </td>
                  </tr>
                ) : (
                  paged.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
                          {c.day}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Clock size={13} style={{ color: 'var(--text-muted)' }} />
                          {c.time}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ 
                            background: c.program.toLowerCase().includes('trial') ? 'var(--primary-orange-light)' : 'var(--primary-blue-light)',
                            color: c.program.toLowerCase().includes('trial') ? 'var(--primary-orange)' : 'var(--primary-blue)',
                            padding: '0.2rem 0.55rem',
                            borderRadius: '6px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem'
                          }}>
                            <BookOpen size={12} />
                            {formatProgramBadge(c.program, c.term, c.remarks, c.student, liveProgress)}
                          </span>
                        </div>
                      </td>
                      <td>
                        {(() => {
                          const kind = c.classType || 'Regular';
                          const tint = KIND_TINT[kind] || KIND_TINT.Regular;
                          const dated = isDatedKind(kind);
                          const spent = isExpired(c, todayISO);
                          return (
                            <>
                              <span style={{
                                background: `${tint}14`,
                                border: `1px solid ${tint}33`,
                                color: tint,
                                padding: '0.15rem 0.5rem',
                                borderRadius: '6px',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                opacity: spent ? 0.55 : 1,
                              }}>
                                {kind}
                              </span>
                              {/* A dated place is only real on its dates, so the
                                  dates belong next to the label. */}
                              {dated && (
                                <span style={{ display: 'block', fontSize: '0.66rem', color: spent ? 'var(--text-muted)' : 'var(--text-secondary)', marginTop: '0.2rem' }}>
                                  {spent
                                    ? 'Past — off the schedule'
                                    : (c.sessionDates || []).length
                                      ? (c.sessionDates || []).join(', ')
                                      : 'No date set'}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <User size={13} style={{ color: 'var(--text-muted)' }} />
                          {c.student}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {(() => {
                          const used = slotOccupancy.get(`${c.day}||${c.time}||${c.teacher}||${c.branchName}`) || 0;
                          const max = maxStudentsFor(c.program, rules);
                          const full = used >= max;
                          const over = used > max;
                          const color = over ? '#dc2626' : full ? '#d97706' : '#059669';
                          const bg = over ? 'rgba(220,38,38,0.12)' : full ? 'rgba(217,119,6,0.12)' : 'rgba(5,150,105,0.12)';
                          return (
                            <span
                              title={over ? `Over capacity (max ${max})` : full ? 'Slot full' : `${max - used} seat${max - used === 1 ? '' : 's'} left`}
                              style={{ fontSize: '0.75rem', fontWeight: 700, color, background: bg, padding: '0.15rem 0.5rem', borderRadius: '99px', whiteSpace: 'nowrap' }}
                            >
                              {used} / {max}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ fontWeight: 500 }}>{c.teacher}</td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                          <MapPin size={13} style={{ color: 'var(--text-muted)' }} />
                          {c.branchName}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{c.remarks || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                          <button 
                            onClick={() => openEditModal(c)}
                            title="Edit Class"
                            style={{
                              background: 'transparent', border: '1px solid var(--border-color)', cursor: 'pointer',
                              padding: '0.3rem', borderRadius: '6px', color: 'var(--text-secondary)', display: 'flex'
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button 
                            onClick={() => handleDelete(c.id, c.student)}
                            title="Delete Class"
                            style={{
                              background: 'transparent', border: '1px solid var(--danger-border)', cursor: 'pointer',
                              padding: '0.3rem', borderRadius: '6px', color: 'var(--danger)', display: 'flex'
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
          {!loading && totalPages > 1 && (
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      </div>

      {/* Bulk Import modal */}
      {showBulk && (
        <div
          onClick={() => setShowBulk(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--panel-bg)', width: '100%', maxWidth: '620px', maxHeight: '90vh', borderRadius: '16px', boxShadow: '0 12px 32px rgba(0,0,0,0.18)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Upload size={17} /> Bulk Import Classes</h2>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>One class per line · comma or tab separated.</span>
              </div>
              <button onClick={() => setShowBulk(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={18} /></button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.95rem' }}>
              {/* Guide */}
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.7rem 0.85rem', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--text-main)' }}>How to format the file (.xlsx)</strong>
                <div style={{ marginTop: '0.35rem' }}>
                  Use three tabs named <code>Kinder</code>, <code>Junior</code>, and <code>Coder</code>. Columns per tab:
                </div>
                <ul style={{ margin: '0.35rem 0 0.35rem 1rem', padding: 0 }}>
                  <li><strong>Kinder</strong> / <strong>Junior</strong>: Day · Start Time · Program (<code>KF1, KF2, K1–K4</code> / <code>JF1, JF2, J1–J4</code>) · Lesson (1–10) · Student · Teacher · Branch · Class Type</li>
                  <li><strong>Coder</strong>: Day · Start Time · Program (<code>Coder Basic</code>, <code>Coder Advance</code>, …) · Student · Teacher · Branch · Class Type</li>
                </ul>
                <div>End time is auto-calculated (Kinder 1.5h, others 2h). Class Type is optional (defaults to Regular). Start Time accepts <code>1:00 PM</code>, <code>13:00</code>, etc.</div>
                <button
                  type="button"
                  onClick={downloadImportTemplate}
                  style={{ marginTop: '0.55rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', fontWeight: 600, color: 'var(--primary-blue, #4f46e5)', background: 'transparent', border: '1px solid var(--primary-blue, #4f46e5)', borderRadius: '8px', padding: '0.35rem 0.75rem', cursor: 'pointer' }}
                >
                  <FileDown size={14} /> Download .xlsx template
                </button>
              </div>

              {/* File upload */}
              <div>
                <label className="modal-form-label">Upload file</label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => handleBulkFile(e.target.files?.[0])}
                  style={{ width: '100%', fontSize: '0.82rem' }}
                />
                {bulkFileName && (
                  <div style={{ fontSize: '0.78rem', marginTop: '0.4rem' }}>
                    <strong style={{ color: 'var(--success, #059669)' }}>{bulkRows.length}</strong> row{bulkRows.length === 1 ? '' : 's'} ready from <em>{bulkFileName}</em>
                    {bulkFileErrors.length > 0 && <> · <strong style={{ color: 'var(--danger)' }}>{bulkFileErrors.length}</strong> problem{bulkFileErrors.length === 1 ? '' : 's'}</>}
                    {bulkFileErrors.slice(0, 5).map((e, i) => (
                      <div key={i} style={{ color: 'var(--danger)', fontSize: '0.72rem' }}>{e.line ? `${e.line}: ` : ''}{e.msg}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Manual paste alternative */}
              <div>
                <label className="modal-form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  Or paste rows manually
                  <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>Day, Time, Program, Student, Teacher, Branch, ClassType</span>
                </label>
                <textarea
                  value={bulkText}
                  onChange={(e) => { setBulkText(e.target.value); setBulkResult(null); }}
                  placeholder={'Monday, 1.00 pm - 3.00 pm, JF1.5, Dave Kingsley, Angel, Gading Serpong, Regular'}
                  rows={4}
                  className="modal-input-field"
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
                  disabled={bulkRows.length > 0}
                />
                {bulkRows.length === 0 && bulkText.trim() && (() => {
                  const { rows, errors } = parseBulkSchedule(bulkText);
                  return (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                      <strong style={{ color: 'var(--success, #059669)' }}>{rows.length}</strong> valid row{rows.length === 1 ? '' : 's'}
                      {errors.length > 0 && <> · <strong style={{ color: 'var(--danger)' }}>{errors.length}</strong> problem{errors.length === 1 ? '' : 's'}</>}
                    </div>
                  );
                })()}
              </div>

              {bulkResult?.done && (
                <div style={{ fontSize: '0.8rem', color: bulkResult.ok > 0 ? 'var(--success, #059669)' : 'var(--danger)' }}>
                  Imported {bulkResult.ok} · {bulkResult.failed} failed
                </div>
              )}
            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', background: 'var(--bg-color)' }}>
              <button type="button" onClick={() => setShowBulk(false)} className="btn" style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}>Close</button>
              <button
                type="button"
                onClick={handleBulkImport}
                disabled={bulkImporting || (bulkRows.length === 0 && !bulkText.trim())}
                className="btn btn-primary"
                style={{ borderRadius: '10px', padding: '0.5rem 1.4rem', fontSize: '0.85rem', opacity: bulkImporting || (bulkRows.length === 0 && !bulkText.trim()) ? 0.6 : 1 }}
              >
                {bulkImporting ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Class-type chooser — shown before the allocate form */}
      {allocChooser && (
        <div
          onClick={() => setAllocChooser(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel-bg)', width: '100%', maxWidth: '440px', borderRadius: '16px',
              maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)', border: '1px solid var(--border-color)',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{ padding: '1.25rem 1.5rem 0.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                  {studentScope === 'all' ? `Book for ${allocChooser.name}` : `Allocate ${allocChooser.name}`}
                </h2>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {allocChooser.regularCount > 0 && allocChooser.regulars?.[0]
                    ? `Regular: ${allocChooser.regulars[0].day} ${allocChooser.regulars[0].time} · ${allocChooser.regulars[0].teacher}`
                    : 'Select Term, Lesson & Class Type'}
                </span>
              </div>
              <button
                onClick={() => setAllocChooser(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Target Level, Term and Lesson Pickers */}
            <div style={{ padding: '0.85rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)' }}>
              
              {/* Level / Program Selector */}
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span>Target Level / Program *</span>
                  <span style={{ fontSize: '0.68rem', color: '#4338ca', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                    <Lock size={10} /> Locked to student
                  </span>
                </label>
                <select
                  value={allocCategory}
                  onChange={(e) => setAllocCategory(e.target.value)}
                  disabled={true}
                  aria-label="Target Level / Program"
                  className="modal-select-field"
                  style={{
                    width: '100%', fontSize: '0.82rem', padding: '0.4rem 0.6rem',
                    cursor: 'not-allowed', opacity: 0.85,
                    background: 'var(--bg-secondary, rgba(0,0,0,0.03))',
                  }}
                  title="Program is locked to student's enrolled level in database"
                >
                  {PROGRAM_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.desc})
                    </option>
                  ))}
                </select>
                {allocChooser?.regularClass ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    fontSize: '0.7rem', color: '#4338ca',
                    marginTop: '0.25rem'
                  }}>
                    <Lock size={11} />
                    <span>Auto-inherited from regular class: <strong>{allocChooser.regularClass.program}</strong> ({allocChooser.regularClass.day} {allocChooser.regularClass.time})</span>
                  </div>
                ) : allocChooser?.level ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    fontSize: '0.7rem', color: '#4338ca',
                    marginTop: '0.25rem'
                  }}>
                    <Lock size={11} />
                    <span>Locked to student record: <strong>{allocChooser.level}</strong> (changeable only in Students database)</span>
                  </div>
                ) : null}
              </div>

              {/* Term & Lesson for Junior / Kinder vs Coder */}
              {allocCategory === 'Coder' ? (
                <div style={{
                  padding: '0.65rem 0.85rem', borderRadius: '8px',
                  background: 'rgba(8, 145, 178, 0.08)', border: '1px solid rgba(8, 145, 178, 0.2)',
                  color: '#0e7490', fontSize: '0.78rem', fontWeight: 600, display: 'flex', flexDirection: 'column', gap: '0.25rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#0891b2', fontWeight: 700 }}>
                    <BookOpen size={15} />
                    <span>Coder Program — Subscription & Meeting Based</span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                    12 meetings per 3-month subscription period (24 meetings for 6 months). No fixed lesson numbers or terms required.
                  </span>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                        <span>Target Term *</span>
                        <span style={{ fontSize: '0.68rem', color: '#4338ca', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <Lock size={10} /> Locked
                        </span>
                      </label>
                      <select
                        value={allocTerm}
                        onChange={(e) => setAllocTerm(e.target.value)}
                        disabled={true}
                        aria-label="Target Term"
                        className="modal-select-field"
                        style={{
                          width: '100%', fontSize: '0.82rem', padding: '0.38rem 0.6rem',
                          cursor: 'not-allowed',
                          opacity: 0.85,
                          background: 'var(--bg-secondary, rgba(0,0,0,0.03))',
                        }}
                      >
                        <option value="Term 1">Term 1</option>
                        <option value="Term 2">Term 2</option>
                        <option value="Term 3">Term 3</option>
                        <option value="Term 4">Term 4</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                        Target Lesson *
                      </label>
                      <select
                        value={allocLesson}
                        onChange={(e) => setAllocLesson(e.target.value)}
                        aria-label="Target Lesson"
                        className="modal-select-field"
                        style={{ width: '100%', fontSize: '0.82rem', padding: '0.38rem 0.6rem' }}
                      >
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                          const done = completedLessons.has(n);
                          return (
                            <option key={n} value={String(n)}>
                              Lesson {n} {done ? ' (Done ✓)' : ' (Not done)'}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.7rem', color: completedLessons.has(Number(allocLesson)) ? '#b45309' : 'var(--success, #059669)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    {completedLessons.has(Number(allocLesson)) ? (
                      <span>⚠️ Note: {allocChooser.name} has already completed Lesson {allocLesson}.</span>
                    ) : (
                      <span>💡 Auto-selected Lesson {firstUndoneLesson} (Next uncompleted lesson for {allocChooser.name}).</span>
                    )}
                  </div>
                </>
              )}
            </div>

            <div style={{ padding: '1.25rem 1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {[
                {
                  type: ATTENDANCE.REGULAR, title: 'Regular Class', Icon: BookOpen,
                  desc: 'Fixed weekly place, every week at the same time',
                  color: 'var(--primary-blue, #4f46e5)', bg: 'var(--primary-blue-light, rgba(79,70,229,0.1))',
                },
                {
                  type: ATTENDANCE.REPLACEMENT, title: 'Replacement', Icon: Repeat,
                  desc: 'Replacement for specific Term & Lesson. Ends once date passes.',
                  color: '#7c3aed', bg: 'rgba(124,58,237,0.1)',
                },
                {
                  type: ATTENDANCE.ADDITIONAL, title: 'Additional Session', Icon: CalendarPlus,
                  desc: 'An extra session on top of regular class for chosen Term & Lesson.',
                  color: '#0891b2', bg: 'rgba(8,145,178,0.1)',
                },
                {
                  type: ATTENDANCE.TRIAL, title: 'Trial Class', Icon: BookOpen,
                  desc: 'One-off trial session on a chosen date',
                  color: '#ea580c', bg: 'rgba(249,115,22,0.1)',
                },
              ].map((opt, i) => (
                <button
                  key={opt.type}
                  className="alloc-type-card"
                  onClick={() => startDayReco(allocChooser, opt.type, allocTerm, allocLesson, deriveCodeFromCategoryAndTerm(allocCategory, allocTerm, allocChooser?.level))}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.35rem',
                    padding: '1.1rem 1rem', borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
                    border: `1.5px solid ${opt.color}`, background: opt.bg, color: opt.color,
                    animationDelay: `${i * 0.06}s`,
                  }}
                >
                  <opt.Icon size={20} />
                  <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>{opt.title}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Class Modal */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: 'var(--panel-bg)',
            width: '100%',
            maxWidth: '500px',
            maxHeight: '92vh',
            borderRadius: '16px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
            animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
          }}>
            {/* Header */}
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-color)'
            }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                {editingClass ? 'Edit Operational Class' : 'Add Operational Class'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: '0.25rem', borderRadius: '4px', display: 'flex'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Form Content */}
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                
                {/* Branch and Day Row */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Branch *</label>
                    <select
                      value={form.branchName}
                      onChange={(e) => {
                        const nextBranch = e.target.value;
                        // If the current instructor doesn't belong to the new
                        // branch, clear it so only valid instructors show.
                        const validForBranch = instructorsForBranch(nextBranch);
                        const openDays = branchOpenDays(nextBranch);
                        setForm((prev) => ({
                          ...prev,
                          branchName: nextBranch,
                          teacher: validForBranch.includes(prev.teacher) ? prev.teacher : '',
                          day: openDays.includes(prev.day) ? prev.day : (openDays[0] || prev.day),
                        }));
                      }}
                      className={`modal-select-field ${formErrors.branchName ? 'error' : ''}`}
                    >
                      <option value="">Select Branch</option>
                      {branchList.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                    {formErrors.branchName && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.branchName}</span>}
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Day *</label>
                    <select
                      value={form.day}
                      onChange={(e) => setForm({ ...form, day: e.target.value })}
                      className="modal-select-field"
                    >
                      {modalDays.map(day => <option key={day} value={day}>{day}</option>)}
                    </select>
                  </div>
                </div>

                {/* Time and Program Row */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Start Time *</label>
                    <input
                      type="time"
                      value={startTime}
                      // Editing the start by hand means this is no longer the
                      // class that was being joined, so the lock comes off.
                      onChange={(e) => { setJoinTime(null); setStartTime(e.target.value); }}
                      className={`modal-input-field ${formErrors.time ? 'error' : ''}`}
                    />
                    <span style={{ fontSize: '0.7rem', color: joinTime ? 'var(--success, #10b981)' : 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                      {joinTime
                        ? `Joining the existing ${joinTime} class · change the start time to book a separate one`
                        : form.time
                          ? `Slot: ${form.time} · ${isKinderProgram(form.program) ? 'Kinder 1.5h' : '2h'}`
                          : `Duration: ${isKinderProgram(form.program) ? 'Kinder 1.5h' : '2h'} (auto)`}
                    </span>
                    {formErrors.time && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.time}</span>}
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Program, Term & Lesson *</span>
                      {isStudentLocked && (
                        <span style={{ fontSize: '0.68rem', color: '#4338ca', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <Lock size={10} /> Locked to student
                        </span>
                      )}
                    </label>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <select
                        value={programCode}
                        onChange={(e) => setProgramCode(e.target.value)}
                        disabled={isStudentLocked}
                        className={`modal-select-field ${formErrors.program ? 'error' : ''}`}
                        style={{
                          flex: 2, minWidth: '110px',
                          cursor: isStudentLocked ? 'not-allowed' : 'default',
                          opacity: isStudentLocked ? 0.8 : 1,
                          background: isStudentLocked ? 'var(--bg-secondary, rgba(0,0,0,0.03))' : undefined,
                        }}
                        title={isStudentLocked ? "Program is locked to student's enrolled level in database" : "Select Program"}
                      >
                        <option value="">Program</option>
                        {programGroups.map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.codes.map((code) => <option key={code} value={code}>{code}</option>)}
                          </optgroup>
                        ))}
                      </select>
                      <select
                        value={termNo}
                        onChange={(e) => setTermNo(e.target.value)}
                        disabled={isStudentLocked}
                        className="modal-select-field"
                        style={{
                          flex: 1, minWidth: '85px',
                          cursor: isStudentLocked ? 'not-allowed' : 'default',
                          opacity: isStudentLocked ? 0.8 : 1,
                          background: isStudentLocked ? 'var(--bg-secondary, rgba(0,0,0,0.03))' : undefined,
                        }}
                        title={isStudentLocked ? "Term is locked to student's enrolled level in database" : "Select Term"}
                      >
                        <option value="Term 1">Term 1</option>
                        <option value="Term 2">Term 2</option>
                        <option value="Term 3">Term 3</option>
                        <option value="Term 4">Term 4</option>
                      </select>
                      {codeHasLessons(programCode) && (
                        <select
                          value={lessonNo}
                          onChange={(e) => setLessonNo(e.target.value)}
                          className="modal-select-field"
                          style={{ flex: 1, minWidth: '65px' }}
                          title="Lesson number"
                        >
                          {Array.from({ length: LESSON_COUNT }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={String(n)}>L{n}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    {form.program && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                        Program: {form.program}
                      </span>
                    )}

                    {formStudentLevel && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        fontSize: '0.72rem', color: '#4338ca',
                        marginTop: '0.35rem', padding: '0.35rem 0.6rem',
                        borderRadius: '6px', background: 'rgba(79, 70, 229, 0.08)',
                        border: '1px solid rgba(79, 70, 229, 0.2)'
                      }}>
                        <Lock size={12} style={{ flexShrink: 0 }} />
                        <span>
                          <strong>Locked to Student Database:</strong> {formStudentLevel.name} is enrolled in{' '}
                          <strong style={{ color: '#3730a3' }}>{formStudentLevel.level || formStudentLevel.category}</strong>.
                          Program and Term can only be changed in the Students database.
                        </span>
                      </div>
                    )}

                    {programMismatch && (
                      <span style={{ display: 'flex', alignItems: 'flex-start', gap: '0.3rem', fontSize: '0.72rem', color: '#b45309', marginTop: '0.3rem' }}>
                        <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '0.15rem' }} />
                        This is a {programMismatch.chosen} program but the student is {programMismatch.expected}.
                        Update their level under Students if they have moved.
                      </span>
                    )}

                    {formErrors.program && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.program}</span>}

                    {/* Slot-combination verdict against the Schedule Rules */}
                    {ruleCheck && !formErrors.program && (
                      <div style={{
                        marginTop: '0.4rem', padding: '0.45rem 0.6rem', borderRadius: '8px',
                        display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.72rem',
                        color: ruleCheck.severity === 'ok' ? 'var(--success, #059669)'
                          : ruleCheck.severity === 'warn' ? '#b45309' : 'var(--danger)',
                        background: ruleCheck.severity === 'ok' ? 'rgba(16,185,129,0.08)'
                          : ruleCheck.severity === 'warn' ? 'rgba(245,158,11,0.1)' : 'var(--danger-bg, rgba(239,68,68,0.08))',
                        border: `1px solid ${ruleCheck.severity === 'ok' ? 'rgba(16,185,129,0.3)'
                          : ruleCheck.severity === 'warn' ? 'rgba(245,158,11,0.35)' : 'rgba(239,68,68,0.3)'}`,
                      }}>
                        {ruleCheck.severity === 'ok'
                          ? <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: '0.05rem' }} />
                          : <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '0.05rem' }} />}
                        <span>
                          {ruleCheck.reason}
                          <span style={{ display: 'block', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                            Slot already has: {slotPrograms.join(', ')}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Student and Instructor Row */}
                <div>
                  <label className="modal-form-label">Student Name(s) *</label>
                  <input
                    type="text"
                    placeholder="Type student name..."
                    value={form.student}
                    onChange={(e) => setForm({ ...form, student: e.target.value })}
                    className={`modal-input-field ${formErrors.student ? 'error' : ''}`}
                  />
                  {formErrors.student && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.student}</span>}
                </div>

                <div>
                  <label className="modal-form-label">Instructor *</label>
                  <select
                    value={form.teacher}
                    onChange={(e) => setForm({ ...form, teacher: e.target.value })}
                    className={`modal-select-field ${formErrors.teacher ? 'error' : ''}`}
                  >
                    <option value="">
                      {form.branchName ? 'Select Instructor' : 'Select a branch first'}
                    </option>
                    {modalInstructorGroups.qualified.map((t) => {
                      const v = teacherStatus.get(t);
                      return (
                        <option key={t} value={t}>
                          {v && !v.free ? `${t} — ${v.reason}` : t}
                        </option>
                      );
                    })}
                    {/* Listed but not selectable: the reason stays visible, so
                        nobody hunts for an instructor that was filtered away. */}
                    {modalInstructorGroups.unqualified.length > 0 && (
                      <optgroup
                        label={`Not qualified for ${parseProgram(form.program).category || 'this program'}`}
                      >
                        {modalInstructorGroups.unqualified.map((t) => {
                          const q = teacherQualification.get(t);
                          return (
                            <option key={t} value={t} disabled>
                              {`${t} — ${q?.level || 'unclassified'}`}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                  {form.branchName && modalInstructors.length === 0 && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                      No instructors assigned to {form.branchName}. Add them under Instructors.
                    </span>
                  )}
                  {/* Qualification is reported even with no time entered, since
                      it does not depend on one. */}
                  {form.teacher && !(teacherQualification.get(form.teacher)?.qualified ?? true) && (
                    <span style={{ fontSize: '0.72rem', marginTop: '0.25rem', display: 'block', color: 'var(--danger)' }}>
                      ✕ {form.teacher} is {teacherQualification.get(form.teacher).level || 'unclassified'} — cannot
                      teach {teacherQualification.get(form.teacher).category}
                    </span>
                  )}
                  {/* Live availability for the chosen instructor, so the reason
                      is visible before the save is attempted. */}
                  {form.teacher && form.time && teacherStatus.get(form.teacher) && (
                    <span style={{
                      fontSize: '0.72rem', marginTop: '0.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.25rem',
                      color: teacherStatus.get(form.teacher).free ? 'var(--success, #10b981)' : 'var(--danger)',
                    }}>
                      {teacherStatus.get(form.teacher).free
                        ? `✓ Free at ${form.time}`
                        : `✕ ${teacherStatus.get(form.teacher).reason}`}
                    </span>
                  )}
                  {formErrors.teacher && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.teacher}</span>}
                </div>

                <div>
                  <label className="modal-form-label">Class Type *</label>
                  <select
                    value={form.classType || 'Regular'}
                    onChange={(e) => {
                      const next = e.target.value;
                      // Switching to a dated kind seeds the coming occurrence of
                      // the chosen day; switching back to Regular clears dates,
                      // which is what the API stores for a weekly place anyway.
                      const seed = nextDateForDay(form.day);
                      setForm({
                        ...form,
                        classType: next,
                        sessionDates: isDatedKind(next)
                          ? ((form.sessionDates || []).length ? form.sessionDates : [seed].filter(Boolean))
                          : [],
                      });
                    }}
                    className="modal-select-field"
                  >
                    <option value={ATTENDANCE.REGULAR}>Regular Class — fixed weekly place</option>
                    <option value={ATTENDANCE.REPLACEMENT}>Replacement — moved from their regular week</option>
                    <option value={ATTENDANCE.ADDITIONAL}>Additional Session — extra on top of regular</option>
                    <option value={ATTENDANCE.TRIAL}>Trial Class — one-off sample</option>
                  </select>
                </div>

                {/* Dates for a non-weekly place. Listed rather than a single
                    field because a replacement can run over several weeks. */}
                {isDatedKind(form.classType) && (
                  <div>
                    <label className="modal-form-label" htmlFor="session-date-input">
                      Session Date{(form.sessionDates || []).length === 1 ? '' : 's'} *
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        id="session-date-input"
                        type="date"
                        value={sessionDateDraft}
                        onChange={(e) => setSessionDateDraft(e.target.value)}
                        className={`modal-input-field ${formErrors.sessionDates ? 'error' : ''}`}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const d = sessionDateDraft;
                          if (!d || (form.sessionDates || []).includes(d)) return;
                          setForm({ ...form, sessionDates: [...(form.sessionDates || []), d].sort() });
                          setSessionDateDraft('');
                        }}
                        disabled={!sessionDateDraft}
                        className="btn"
                        style={{
                          border: '1px solid var(--border-color)', borderRadius: '8px',
                          padding: '0 0.8rem', cursor: sessionDateDraft ? 'pointer' : 'not-allowed',
                          background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.8rem',
                          opacity: sessionDateDraft ? 1 : 0.5,
                        }}
                      >
                        Add date
                      </button>
                    </div>

                    {(form.sessionDates || []).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
                        {form.sessionDates.map((d) => {
                          const past = d < todayISO;
                          const wrongDay = dayNameOfISO(d) !== form.day;
                          return (
                            <span
                              key={d}
                              title={[
                                past ? 'Already passed — this session drops off the schedule' : null,
                                wrongDay ? `${d} is a ${dayNameOfISO(d)}, but this class runs on ${form.day}` : null,
                              ].filter(Boolean).join('. ') || d}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.45rem',
                                borderRadius: '99px',
                                color: wrongDay ? 'var(--danger)' : past ? 'var(--text-muted)' : 'var(--text-secondary)',
                                background: wrongDay ? 'var(--danger-bg, rgba(239,68,68,0.1))' : 'var(--bg-color)',
                                border: `1px solid ${wrongDay ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'}`,
                                textDecoration: past ? 'line-through' : 'none',
                              }}
                            >
                              {d}
                              {wrongDay && <AlertTriangle size={11} />}
                              <button
                                type="button"
                                onClick={() => setForm({ ...form, sessionDates: form.sessionDates.filter((x) => x !== d) })}
                                aria-label={`Remove ${d}`}
                                title={`Remove ${d}`}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 0 }}
                              >
                                <X size={11} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}

                    <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                      {form.classType === ATTENDANCE.REPLACEMENT
                        ? 'The student sits in this class on these dates instead of their own regular week. It leaves the schedule once the last date passes.'
                        : form.classType === ATTENDANCE.ADDITIONAL
                          ? 'An extra session on top of their regular class, so a week can hold more than one. Add several dates for a run.'
                          : 'The trial runs only on these dates.'}
                    </span>
                    {formErrors.sessionDates && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>
                        {formErrors.sessionDates}
                      </span>
                    )}
                  </div>
                )}

                {/* Remarks */}
                <div>
                  <label className="modal-form-label">Remarks / Notes</label>
                  <textarea
                    placeholder="Enter any additional details..."
                    value={form.remarks}
                    onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                    className="modal-textarea-field"
                  />
                </div>
              </div>

              {/* Actions Footer */}
              <div style={{
                padding: '1rem 1.5rem',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                background: 'var(--bg-color)'
              }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn"
                  style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ borderRadius: '10px', padding: '0.5rem 1.5rem', fontSize: '0.85rem' }}
                >
                  Save Class
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal animation style */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes modalAppear {
          from { opacity: 0; transform: scale(0.96) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes cardPop {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .alloc-type-card {
          animation: cardPop 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
          transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
        }
        .alloc-type-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.12);
          filter: brightness(1.02);
        }
        .alloc-type-card:active { transform: translateY(-1px) scale(0.98); }
      `}} />
    </section>
  );
}
