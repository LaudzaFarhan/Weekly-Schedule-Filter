'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { 
  subscribeToInternalClasses, 
  createInternalClass, 
  updateInternalClass, 
  deleteInternalClass 
} from '../services/internalScheduleService';
import { subscribeToInternalStudents } from '../services/internalStudentService';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { resolveBranchWorkingDays } from './NewOperationalsPage';
import { DAY_NAMES, SCHEDULE_PAGE_SIZE } from '../utils/constants';
import Pagination from '../components/ui/Pagination';
import { Plus, Pencil, Trash2, Search, X, Calendar, MapPin, User, UserX, BookOpen, Clock, AlertTriangle, Upload, History, Trash, FileDown } from 'lucide-react';
import * as XLSX from 'xlsx';

const HISTORY_KEY = 'newOpsScheduleHistory';

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
    if (!time || !program || !student || !teacher || !branchName) {
      errors.push({ line: lineNo, msg: 'Missing required field (need Day, Time, Program, Student, Teacher, Branch)' });
      return;
    }
    const ct = /trial/i.test(classType || '') ? 'Trial' : 'Regular';
    rows.push({ day: dayMatch, time, program, student, teacher, branchName, classType: ct, remarks: '' });
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
  const coder = [{ Day: 'Wednesday', 'Start Time': '1:00 PM', Program: 'Coder Advance 1', Student: 'Dave Kingsley', Teacher: 'Christian', Branch: 'Gading Serpong', 'Class Type': 'Trial' }];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kinder), 'Kinder');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(junior), 'Junior');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coder), 'Coder');
  XLSX.writeFile(wb, 'schedule-import-template.xlsx');
}

/** Normalise a student name for allocation matching (case/space/punct-insensitive). */
const normalizeStudentName = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');

// Program catalogue. Kinder & Junior programs each have 10 lessons; Coder has
// no lesson number. Codes: KF1/KF2 (Kinder Foundation), K1-K4 (Kinder Core),
// JF1/JF2 (Junior Foundation), J1-J4 (Junior Core), Coder.
const PROGRAM_GROUPS = [
  { label: 'Kinder Foundation', codes: ['KF1', 'KF2'] },
  { label: 'Kinder Core (Term 1–4)', codes: ['K1', 'K2', 'K3', 'K4'] },
  { label: 'Junior Foundation', codes: ['JF1', 'JF2'] },
  { label: 'Junior Core (Term 1–4)', codes: ['J1', 'J2', 'J3', 'J4'] },
  {
    label: 'Coder',
    codes: [
      'Coder Foundation 1', 'Coder Foundation 2', 'Coder Foundation 3', 'Coder Foundation 4',
      'Coder Basic 1', 'Coder Basic 2',
      'Coder Intermediate 1', 'Coder Intermediate 2',
      'Coder Advance 1', 'Coder Advance 2', 'Coder Advance 3',
    ],
  },
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

/** Max students per slot: Kinder programs 4, Junior & Coder 6. */
const maxStudentsForProgram = (program) => (isKinderProgram(program) ? 4 : 6);

/** Parse a stored program value ("JF1.5", "Coder", "K2") into code + lesson. */
const parseProgramValue = (p) => {
  const val = String(p || '').trim();
  if (!val) return { code: '', lesson: '1' };
  // Coder programs store their full level as the code (e.g. "Coder Advance 1").
  if (/^coder/i.test(val)) return { code: val, lesson: '1' };
  const m = val.match(/^([A-Za-z]{1,3}\d+)(?:[.\s]+(\d+))?$/);
  if (m) return { code: m[1].toUpperCase(), lesson: m[2] || '1' };
  return { code: '', lesson: '1' };
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
  const { showToast } = useToast();

  // State
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showUnallocated, setShowUnallocated] = useState(true);
  const [startTime, setStartTime] = useState(''); // HH:MM for the class start
  const [programCode, setProgramCode] = useState('');
  const [lessonNo, setLessonNo] = useState('1');
  const [allocChooser, setAllocChooser] = useState(null); // student pending class-type choice

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

  // Subscribe to the New Operations instructors list — the instructor dropdown
  // must use New Operations data, not the old schedule's teachers.
  useEffect(() => {
    const unsubscribe = subscribeToInternalInstructors((data) => setInstructors(data));
    return () => unsubscribe();
  }, []);

  // Derive the program value ("JF1.5", "Coder", ...) from the code + lesson.
  useEffect(() => {
    if (!programCode) return;
    const val = codeHasLessons(programCode) ? `${programCode}.${lessonNo}` : programCode;
    setForm((prev) => (prev.program === val ? prev : { ...prev, program: val }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programCode, lessonNo]);

  // Auto-derive the time slot from the chosen start time + program duration
  // rule (Kinder = 1.5h, everything else = 2h). Only runs once a start time is
  // picked, so editing an existing class keeps its saved slot untouched.
  useEffect(() => {
    if (!startTime) return;
    const slot = buildTimeSlot(startTime, form.program);
    setForm((prev) => (prev.time === slot ? prev : { ...prev, time: slot }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, form.program]);

  const sortedTeachers = [...new Set((instructors || []).map(i => i.name))].filter(Boolean).sort();
  const branchList = [...new Set([...(enabledBranches || []).map(b => b.name), ...(branches || []).map(b => b.name)])].filter(Boolean);

  // Instructors available for a given branch: those whose New Ops profile lists
  // that branch (or "All Branches"). Used by the Add/Edit modal so the teacher
  // options are scoped to the branch selected in the form.
  const instructorsForBranch = (branchName) => {
    const list = (instructors || [])
      .filter((i) => {
        if (!branchName) return true;
        const brs = Array.isArray(i.branches) ? i.branches : [];
        return brs.includes(branchName) || brs.includes('All Branches');
      })
      .map((i) => i.name);
    return [...new Set(list)].filter(Boolean).sort();
  };
  const modalInstructors = instructorsForBranch(form.branchName);

  // Days a given branch is open, from the Operationals config. Falls back to all
  // days when no branch is selected or the branch has no saved working days.
  const branchOpenDays = (branchName) => {
    if (!branchName) return DAY_NAMES;
    const branch = (branches || []).find((b) => b.name === branchName) || { name: branchName };
    const days = resolveBranchWorkingDays(branch);
    return Array.isArray(days) && days.length ? days : DAY_NAMES;
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
      .filter((i) => (i.branches || []).includes(filterBranch))
      .map((i) => i.name);
    return [...new Set(names)].filter(Boolean).sort();
  }, [instructors, filterBranch, sortedTeachers]);

  // Filters & Search
  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return classes.filter((c) => {
      if (filterDay !== 'all' && c.day !== filterDay) return false;
      if (filterBranch !== 'all' && c.branchName !== filterBranch) return false;
      if (filterInstructor !== 'all' && c.teacher !== filterInstructor) return false;
      if (filterProgram !== 'all' && c.program !== filterProgram) return false;
      if (filterTime !== 'all' && c.time !== filterTime) return false;
      const type = c.classType || 'Regular';
      if (filterClassType !== 'all' && type !== filterClassType) return false;
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
  }, [classes, search, filterDay, filterBranch, filterInstructor, filterProgram, filterTime, filterClassType]);

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

  // Students that exist in the Students list but aren't allocated to any class.
  // A class's `student` field may hold several comma-separated names.
  const unallocatedStudents = useMemo(() => {
    const allocated = new Set();
    classes.forEach((c) => {
      String(c.student || '')
        .split(',')
        .forEach((part) => {
          const key = normalizeStudentName(part);
          if (key) allocated.add(key);
        });
    });
    return students.filter((st) => {
      const key = normalizeStudentName(st.name);
      return key && !allocated.has(key);
    });
  }, [students, classes]);

  const openAddModal = () => {
    setEditingClass(null);
    setStartTime('');
    setProgramCode('');
    setLessonNo('1');
    const addBranch = branchList[0] || '';
    setForm({
      day: branchOpenDays(addBranch)[0] || 'Monday',
      time: '',
      program: '',
      teacher: '',
      student: '',
      branchName: addBranch,
      classType: 'Regular',
      remarks: ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  // Open the Add modal prefilled to allocate a specific unallocated student,
  // with the class type chosen in the pre-step.
  const openAllocateModal = (student, classType) => {
    setEditingClass(null);
    setStartTime('');
    setProgramCode('');
    setLessonNo('1');
    const allocBranch = student.branchName || branchList[0] || '';
    setForm({
      day: branchOpenDays(allocBranch)[0] || 'Monday',
      time: '',
      program: '',
      teacher: '',
      student: student.name || '',
      branchName: allocBranch,
      classType: classType || 'Regular',
      remarks: ''
    });
    setFormErrors({});
    setAllocChooser(null);
    setShowModal(true);
  };

  const openEditModal = (c) => {
    setEditingClass(c);
    setStartTime('');
    const parsed = parseProgramValue(c.program);
    setProgramCode(parsed.code);
    setLessonNo(parsed.lesson);
    setForm({
      day: c.day || 'Monday',
      time: c.time || '',
      program: c.program || '',
      teacher: c.teacher || '',
      student: c.student || '',
      branchName: c.branchName || '',
      classType: c.classType || 'Regular',
      remarks: c.remarks || ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  const validateForm = () => {
    const errors = {};
    if (!form.time.trim()) errors.time = 'Time slot is required';
    if (!form.program.trim()) errors.program = 'Program/Lesson detail is required';
    if (!form.teacher) errors.teacher = 'Instructor is required';
    if (!form.student.trim()) errors.student = 'Student name is required';
    if (!form.branchName) errors.branchName = 'Branch is required';
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Load activity history once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const addHistory = (entry) => {
    setHistory((prev) => {
      const next = [{ at: new Date().toISOString(), ...entry }, ...prev].slice(0, 30);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (editingClass) {
        await updateInternalClass(editingClass.id, form);
        showToast({ title: 'Class updated successfully', variant: 'success' });
        addHistory({ action: 'edit', count: 1, summary: `Edited ${form.student} — ${form.program} · ${form.day} ${form.time} @ ${form.branchName}` });
      } else {
        await createInternalClass(form);
        showToast({ title: 'Class added successfully', variant: 'success' });
        addHistory({ action: 'add', count: 1, summary: `Added ${form.student} — ${form.program} · ${form.day} ${form.time} @ ${form.branchName}` });
      }
      setShowModal(false);
    } catch (err) {
      console.error('Error saving class:', err);
      showToast({ title: 'Failed to save class', variant: 'error' });
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
      addHistory({ action: 'bulk', count: ok, summary: `Bulk imported ${ok} class${ok === 1 ? '' : 'es'}${branches.length ? ` @ ${branches.join(', ')}` : ''}` });
      showToast({ title: `Imported ${ok} class${ok === 1 ? '' : 'es'}`, variant: failed.length ? 'warning' : 'success' });
    } else {
      showToast({ title: 'Nothing imported', message: 'Check the format and required fields.', variant: 'error' });
    }
  };

  const handleDelete = async (classId, studentName) => {
    if (!window.confirm(`Delete the class for student "${studentName}"?`)) return;
    try {
      await deleteInternalClass(classId);
      showToast({ title: 'Class deleted successfully', variant: 'success' });
      addHistory({ action: 'delete', count: 1, summary: `Deleted class for ${studentName}` });
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
      {/* Top row: Unallocated + Schedule Activity, side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: showUnallocated ? '1fr 1fr' : '1fr', gap: '1.5rem', alignItems: 'start', marginBottom: '1.5rem' }}>

        {/* Unallocated Students sidebar */}
        {showUnallocated && (
          <div className="panel" style={{ margin: 0, position: 'sticky', top: '1rem' }}>
            <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.15rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <UserX size={16} /> Unallocated
                <span style={{
                  fontSize: '0.72rem', fontWeight: 700,
                  color: unallocatedStudents.length > 0 ? 'var(--danger)' : 'var(--success, #10b981)',
                  background: unallocatedStudents.length > 0 ? 'var(--danger-bg, rgba(239,68,68,0.12))' : 'rgba(16,185,129,0.12)',
                  padding: '0.05rem 0.45rem', borderRadius: '99px',
                }}>
                  {unallocatedStudents.length}
                </span>
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Students not yet assigned to a class. Click to allocate.
              </span>
            </div>

            <div style={{ padding: '0.85rem 1rem' }}>
              {students.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                  No students in the list yet. Add them under Students.
                </p>
              ) : unallocatedStudents.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--success, #10b981)', margin: 0, fontWeight: 500 }}>
                  All students are allocated. 🎉
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '232px', overflowY: 'auto' }}>
                  {unallocatedStudents.map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setAllocChooser(st)}
                      title={`Allocate ${st.name} to a class`}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '0.5rem', width: '100%', textAlign: 'left',
                        padding: '0.5rem 0.6rem', borderRadius: '8px', cursor: 'pointer',
                        border: '1px solid var(--border-color)', background: 'var(--bg-color)',
                      }}
                    >
                      <User size={14} style={{ flexShrink: 0, marginTop: '0.1rem', color: 'var(--text-muted)' }} />
                      <span style={{ overflow: 'hidden' }}>
                        <span style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {st.name}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {[st.level, st.branchName].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Schedule Activity — side by side with Unallocated */}
        <div className="panel" style={{ margin: 0 }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '168px', overflowY: 'auto' }}>
                {history.map((h, i) => {
                  const meta = {
                    add: { color: '#059669', bg: 'rgba(5,150,105,0.12)', label: 'ADD' },
                    bulk: { color: '#4f46e5', bg: 'rgba(79,70,229,0.12)', label: 'BULK' },
                    edit: { color: '#d97706', bg: 'rgba(217,119,6,0.12)', label: 'EDIT' },
                    delete: { color: '#dc2626', bg: 'rgba(220,38,38,0.12)', label: 'DELETE' },
                  }[h.action] || { color: 'var(--text-muted)', bg: 'var(--bg-color)', label: (h.action || '').toUpperCase() };
                  const when = new Date(h.at);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.6rem', borderRadius: '8px', background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: 700, color: meta.color, background: meta.bg, padding: '0.1rem 0.4rem', borderRadius: '5px', flexShrink: 0, minWidth: '48px', textAlign: 'center' }}>{meta.label}</span>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-main)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.summary}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                        {isNaN(when.getTime()) ? '' : when.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel full-schedule-panel">
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
          
          <div className="input-group" style={{ margin: 0, width: '150px' }}>
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
              <option value="Regular">Regular Class</option>
              <option value="Trial">Trial Class</option>
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
                        <span style={{ 
                          background: c.program.toLowerCase().includes('trial') ? 'var(--primary-orange-light)' : 'var(--primary-blue-light)',
                          color: c.program.toLowerCase().includes('trial') ? 'var(--primary-orange)' : 'var(--primary-blue)',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}>
                          <BookOpen size={11} />
                          {c.program}
                        </span>
                      </td>
                      <td>
                        <span style={{ 
                          background: (c.classType || 'Regular') === 'Trial' ? 'rgba(249, 115, 22, 0.08)' : 'rgba(95, 61, 196, 0.08)',
                          border: (c.classType || 'Regular') === 'Trial' ? '1px solid rgba(249, 115, 22, 0.2)' : '1px solid rgba(95, 61, 196, 0.2)',
                          color: (c.classType || 'Regular') === 'Trial' ? '#ea580c' : '#5f3dc4',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}>
                          {(c.classType || 'Regular')}
                        </span>
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
                          const max = maxStudentsForProgram(c.program);
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
                  <li><strong>Coder</strong>: Day · Start Time · Program (<code>Coder Advance 1</code>, <code>Coder Basic 2</code>, …) · Student · Teacher · Branch · Class Type</li>
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
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)', border: '1px solid var(--border-color)', overflow: 'hidden',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Allocate {allocChooser.name}</h2>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Choose the class type to continue</span>
              </div>
              <button
                onClick={() => setAllocChooser(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {[
                { type: 'Regular', title: 'Regular Class', desc: 'Ongoing enrolled class', color: 'var(--primary-blue, #4f46e5)', bg: 'var(--primary-blue-light, rgba(79,70,229,0.1))' },
                { type: 'Trial', title: 'Trial Class', desc: 'One-off trial session', color: '#ea580c', bg: 'rgba(249,115,22,0.1)' },
              ].map((opt, i) => (
                <button
                  key={opt.type}
                  className="alloc-type-card"
                  onClick={() => openAllocateModal(allocChooser, opt.type)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.35rem',
                    padding: '1.1rem 1rem', borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
                    border: `1.5px solid ${opt.color}`, background: opt.bg, color: opt.color,
                    animationDelay: `${i * 0.06}s`,
                  }}
                >
                  <BookOpen size={20} />
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
                      onChange={(e) => setStartTime(e.target.value)}
                      className={`modal-input-field ${formErrors.time ? 'error' : ''}`}
                    />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                      {form.time
                        ? `Slot: ${form.time} · ${isKinderProgram(form.program) ? 'Kinder 1.5h' : '2h'}`
                        : `Duration: ${isKinderProgram(form.program) ? 'Kinder 1.5h' : '2h'} (auto)`}
                    </span>
                    {formErrors.time && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.time}</span>}
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Program / Lesson *</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <select
                        value={programCode}
                        onChange={(e) => setProgramCode(e.target.value)}
                        className={`modal-select-field ${formErrors.program ? 'error' : ''}`}
                        style={{ flex: 2 }}
                      >
                        <option value="">Program</option>
                        {PROGRAM_GROUPS.map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.codes.map((code) => <option key={code} value={code}>{code}</option>)}
                          </optgroup>
                        ))}
                      </select>
                      {codeHasLessons(programCode) && (
                        <select
                          value={lessonNo}
                          onChange={(e) => setLessonNo(e.target.value)}
                          className="modal-select-field"
                          style={{ flex: 1 }}
                          title="Lesson number"
                        >
                          {Array.from({ length: LESSON_COUNT }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>L{n}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    {form.program && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                        Program: {form.program}
                      </span>
                    )}
                    {formErrors.program && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.program}</span>}
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
                    {modalInstructors.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {form.branchName && modalInstructors.length === 0 && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                      No instructors assigned to {form.branchName}. Add them under Instructors.
                    </span>
                  )}
                  {formErrors.teacher && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.teacher}</span>}
                </div>

                <div>
                  <label className="modal-form-label">Class Type *</label>
                  <select
                    value={form.classType || 'Regular'}
                    onChange={(e) => setForm({ ...form, classType: e.target.value })}
                    className="modal-select-field"
                  >
                    <option value="Regular">Regular Class</option>
                    <option value="Trial">Trial Class</option>
                  </select>
                </div>

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
