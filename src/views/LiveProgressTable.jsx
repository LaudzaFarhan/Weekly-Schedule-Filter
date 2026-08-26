'use client';

/**
 * Live Progress for one category.
 *
 * One row per enrolled student, built by joining the live schedule (who teaches
 * them, when, on what program) with the progress stored per student per level
 * (attendance, videos sent, whether they will carry on).
 *
 * The three sidebar pages are this component with a different `category`.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useToast } from '../components/ui/Toast';
import { subscribeToInternalClasses, updateInternalClass, createInternalClass, deleteInternalClass } from '../services/internalScheduleService';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { subscribeToInternalStudents } from '../services/internalStudentService';
import { resolveCanonicalTeacherName, getInstructorDisplayName, isInstructorMatch, isSameTeacher } from '../utils/instructorUtils';
import {
  subscribeToLiveProgress, saveLiveProgress,
} from '../services/newLiveProgressService';
import { logActivity } from '../services/newActivityService';
import { useAuth } from '../contexts/AuthContext';
import { useSchedule } from '../contexts/ScheduleContext';
import Pagination from '../components/ui/Pagination';
import {
  parseProgram, levelsForCategory, LESSONS_PER_LEVEL, CONTINUATION_OPTIONS,
  normaliseCoderLevel, lessonsForCategory,
} from '../lib/programRules';
import { resolveProgramCategory, studentProgramCategory } from '../lib/studentFilter';
import { isoOf } from '../lib/instructorAvailability';
import { isSameBranch, getCanonicalBranchName, DEFAULT_BRANCH_LIST } from '../utils/constants';
import {
  Search, X, User, MapPin, Clock, Calendar, GraduationCap, Check, Video,
  StickyNote, AlertTriangle, TrendingUp, BookOpen, Edit3, Save, UserCheck, ChevronDown, CheckCircle2,
  ExternalLink,
} from 'lucide-react';

const PAGE_SIZE = 5;
const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ORDER = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};
const getDayIndex = (day) => DAY_ORDER[String(day || '').trim().toLowerCase()] || 99;

/** Colour per continuation answer, so a table of them can be read at a glance. */
const CONTINUATION_TINT = {
  Continue: { color: '#047857', bg: 'rgba(5,150,105,0.12)' },
  Uncertain: { color: '#b45309', bg: 'rgba(245,158,11,0.14)' },
  Break: { color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
  'Not Decide Yet': { color: 'var(--text-muted)', bg: 'var(--bg-color)' },
  'Not Continue': { color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
};

/** Helper to parse start time string into minutes from midnight */
function parseStartMinutes(str) {
  if (!str) return 900; // Default 3:00 PM (15 * 60 = 900)
  const left = String(str).split('-')[0].trim();
  const match = left.match(/(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i);
  if (!match) return 900;

  let hh = parseInt(match[1], 10);
  const mm = parseInt(match[2] || '0', 10);
  const ampm = (match[3] || '').toLowerCase();

  if (ampm === 'pm' && hh < 12) hh += 12;
  if (ampm === 'am' && hh === 12) hh = 0;
  if (!ampm && hh >= 1 && hh <= 7) hh += 12;

  return hh * 60 + mm;
}

/** Helper to format minutes into "h:mm AM/PM" */
function formatMinutesTo12h(totalMin) {
  let hh = Math.floor(totalMin / 60) % 24;
  const mm = totalMin % 60;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  const mmStr = mm < 10 ? `0${mm}` : `${mm}`;
  return `${hh}:${mmStr} ${ampm}`;
}

/** Build complete range string from start time & duration minutes */
function buildTimeRangeStr(startStr, durationMin = 90) {
  const startMin = parseStartMinutes(startStr);
  const endMin = startMin + durationMin;
  const startFormatted = formatMinutesTo12h(startMin);
  const endFormatted = formatMinutesTo12h(endMin);
  return `${startFormatted} - ${endFormatted}`;
}

/** Stable identity for a progress record: one student, one level. */
const keyOf = (studentName, programCode) =>
  `${String(studentName || '').trim().toLowerCase()}||${String(programCode || '').trim().toLowerCase()}`;

export default function LiveProgressTable({ category }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { enabledBranches, branches } = useSchedule();

  const maxLessons = useMemo(() => lessonsForCategory(category), [category]);
  const lessons = useMemo(() => Array.from({ length: maxLessons }, (_, i) => i + 1), [maxLessons]);

  const [classes, setClasses] = useState([]);
  const [progress, setProgress] = useState([]);
  const [instructorProfiles, setInstructorProfiles] = useState([]);
  const [studentRegistry, setStudentRegistry] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterDay, setFilterDay] = useState('all');
  const [filterInstructor, setFilterInstructor] = useState('all');
  const [filterContinuation, setFilterContinuation] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);

  // The attendance cell being edited: { rowKey, lesson }.
  const [editing, setEditing] = useState(null);
  const [draftDate, setDraftDate] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Lesson Arrangement state & handlers
  const [arrangingRow, setArrangingRow] = useState(null);
  const [arrangedLesson, setArrangedLesson] = useState('1');
  const [arrangedTeacher, setArrangedTeacher] = useState('');
  const [arrangedDay, setArrangedDay] = useState('Monday');
  const [startTimeChoice, setStartTimeChoice] = useState('3:00 PM');
  const [customStartTime, setCustomStartTime] = useState('3:00 PM');
  const [arrangingSaving, setArrangingSaving] = useState(false);

  // Video attachment modal state
  const [videoModal, setVideoModal] = useState(null); // { row, level, link }
  const [videoLinkInput, setVideoLinkInput] = useState('');
  const [videoSaving, setVideoSaving] = useState(false);

  const getInstructorsForBranch = (branchName) => {
    const bClean = String(branchName || '').trim();
    const list = new Set();

    (instructorProfiles || []).forEach((inst) => {
      if (!inst) return;
      const primaryName = getInstructorDisplayName(inst) || inst.name;
      if (!primaryName) return;

      if (!bClean || bClean === '—' || bClean.toLowerCase() === 'all branches') {
        const canonical = resolveCanonicalTeacherName(primaryName, instructorProfiles);
        if (canonical && canonical !== 'TBD') list.add(canonical);
        return;
      }

      const branches = Array.isArray(inst.branches)
        ? inst.branches
        : [inst.branchName || inst.branch || ''];

      if (branches.some((b) => isSameBranch(b, bClean) || String(b).trim().toLowerCase() === 'all branches')) {
        const canonical = resolveCanonicalTeacherName(primaryName, instructorProfiles);
        if (canonical && canonical !== 'TBD') list.add(canonical);
      }
    });

    classes.forEach((c) => {
      if (c.teacher && c.teacher !== '—' && (!bClean || bClean === '—' || isSameBranch(c.branchName, bClean) || String(c.branchName || '').trim().toLowerCase() === 'all branches')) {
        const canonical = resolveCanonicalTeacherName(c.teacher, instructorProfiles);
        if (canonical && canonical !== 'TBD') list.add(canonical);
      }
    });

    if (list.size === 0) {
      (instructorProfiles || []).forEach((inst) => {
        const primaryName = getInstructorDisplayName(inst) || inst.name;
        const canonical = resolveCanonicalTeacherName(primaryName, instructorProfiles);
        if (canonical && canonical !== 'TBD') list.add(canonical);
      });
    }

    return Array.from(list).sort((a, b) => a.localeCompare(b));
  };

  const getNextUndoneLesson = (attendanceMap, maxL = 10) => {
    for (let i = 1; i <= maxL; i++) {
      if (!attendanceMap[i]) return String(i);
    }
    return String(maxL);
  };

  const isDayMatch = (d1, d2) => {
    if (!d1 || !d2) return false;
    const str1 = String(d1).trim().toLowerCase();
    const str2 = String(d2).trim().toLowerCase();
    if (str1 === str2) return true;
    if (str1.slice(0, 3) === str2.slice(0, 3)) return true;
    return false;
  };

  const checkInstructorAvailability = (instName, targetDay) => {
    if (!instName || !instructorProfiles.length) {
      return { employmentType: 'Full-Time', isAvailable: true, label: 'Full-Time', profile: null };
    }

    const trimmed = String(instName).trim();
    const profile = instructorProfiles.find((p) => {
      const primaryName = getInstructorDisplayName(p) || p.name;
      return (
        isSameTeacher(primaryName, trimmed) ||
        isSameTeacher(p.name, trimmed) ||
        isSameTeacher(p.username, trimmed)
      );
    });

    if (!profile) {
      return { employmentType: 'Full-Time', isAvailable: true, label: 'Full-Time', profile: null };
    }

    const empType = profile.employmentType || profile.type || 'Full-Time';
    const availDays = Array.isArray(profile.availableDays) ? profile.availableDays : [];

    let isAvailable = true;
    if (empType === 'Part-Time' && availDays.length > 0 && targetDay) {
      isAvailable = availDays.some((ad) => isDayMatch(ad, targetDay));
    }

    let label = empType;
    if (empType === 'Part-Time' && availDays.length > 0) {
      label += ` (${availDays.join(', ')})`;
    } else if (empType === 'Part-Time') {
      label += ` (Part-Time)`;
    } else {
      label += ` (All Days)`;
    }

    return {
      employmentType: empType,
      availableDays: availDays,
      isAvailable,
      label,
      profile,
    };
  };

  const extractStartTimeStr = (timeStr) => {
    if (!timeStr) return '3:00 PM';
    const left = String(timeStr).split('-')[0].trim();
    return left || '3:00 PM';
  };

  const openArrangementModal = (row) => {
    const nextUndone = getNextUndoneLesson(row.attendance, maxLessons);
    const branchInsts = getInstructorsForBranch(row.branchName);
    setArrangingRow(row);
    setArrangedLesson(row.arrangedLesson || row.lesson || nextUndone);
    const initialTeacher = row.arrangedTeacher || (row.instructor && row.instructor !== 'Unassigned' && row.instructor !== '—' ? row.instructor : (branchInsts[0] || ''));
    setArrangedTeacher(initialTeacher);
    setArrangedDay(row.arrangedDay || (row.day && row.day !== '—' ? row.day : 'Monday'));

    const rawTime = row.arrangedTime || (row.time && row.time !== '—' ? row.time : '3:00 PM - 4:30 PM');
    const initStart = extractStartTimeStr(rawTime);
    setStartTimeChoice(initStart);
    setCustomStartTime(initStart);
    setIsCustomStartTime(false);
  };

  const reassignStudentInSchedule = async ({ studentName, targetTeacher, day, time, branchName, classType, program }) => {
    if (!studentName || !targetTeacher) return;

    const normStudent = studentName.trim().toLowerCase();
    const targetCanonical = resolveCanonicalTeacherName(targetTeacher, instructorProfiles);

    // 1. Find all class rows containing this student
    const studentClasses = classes.filter((c) => {
      const sList = String(c.student || '')
        .split(',')
        .map((s) => s.trim().toLowerCase());
      return sList.includes(normStudent);
    });

    // 2. Remove student from any class row where teacher is NOT targetTeacher / targetCanonical
    for (const c of studentClasses) {
      if (isSameTeacher(c.teacher, targetTeacher) || isSameTeacher(c.teacher, targetCanonical)) {
        continue;
      }

      const remainingStudents = String(c.student || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.toLowerCase() !== normStudent);

      if (remainingStudents.length > 0) {
        // Update original teacher's row to keep remaining students
        await updateInternalClass(c.id, {
          day: c.day,
          time: c.time,
          student: remainingStudents.join(', '),
          branchName: c.branchName,
          classType: c.classType || 'Regular',
          teacher: c.teacher,
          program: c.program,
        });
      } else {
        // Keep class slot row with empty student string so card box stays on grid
        await updateInternalClass(c.id, {
          day: c.day,
          time: c.time,
          student: '',
          branchName: c.branchName,
          classType: c.classType || 'Regular',
          teacher: c.teacher,
          program: c.program,
        });
      }
    }

    // 3. Find if targetTeacher ALREADY has a class row on this day + time + branch
    const existingTargetClass = classes.find((c) => {
      const sameTeacher = isSameTeacher(c.teacher, targetTeacher) || isSameTeacher(c.teacher, targetCanonical);
      const sameDay = isDayMatch(c.day, day);
      const sameBranch = isSameBranch(c.branchName, branchName) ||
        String(c.branchName || '').trim().toLowerCase() === 'all branches' ||
        String(branchName || '').trim().toLowerCase() === 'all branches';

      return sameTeacher && sameDay && sameBranch;
    });

    if (existingTargetClass) {
      // Append student to target teacher's existing class row
      const existingStudents = String(existingTargetClass.student || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const alreadyIn = existingStudents.some((s) => s.toLowerCase() === normStudent);
      if (!alreadyIn) {
        existingStudents.push(studentName.trim());
        await updateInternalClass(existingTargetClass.id, {
          day: existingTargetClass.day,
          time: existingTargetClass.time,
          student: existingStudents.join(', '),
          branchName: existingTargetClass.branchName,
          classType: existingTargetClass.classType || 'Regular',
          teacher: targetCanonical || existingTargetClass.teacher,
          program: existingTargetClass.program || program,
        });
      }
    } else {
      // Create a NEW class row for targetTeacher on the schedule grid!
      await createInternalClass({
        teacher: targetCanonical || targetTeacher.trim(),
        student: studentName.trim(),
        day: day && day !== '—' ? day : 'Monday',
        time: time && time !== '—' ? time : '2:30 PM - 4:00 PM',
        branchName: branchName && branchName !== '—' ? branchName : 'Kelapa Gading',
        program: program || 'K1',
        classType: classType || 'Regular',
      });
    }
  };

  const handleSaveArrangement = async () => {
    if (!arrangingRow) return;
    setArrangingSaving(true);
    try {
      // The main/original teacher — use stored mainTeacher if already saved, else current instructor or original instructor
      const mainTeacher = arrangingRow.mainTeacher || (arrangingRow.instructor !== 'Unassigned' && arrangingRow.instructor !== '—' ? arrangingRow.instructor : (arrangingRow.originalInstructor || 'Unassigned'));
      const mainDay = arrangingRow.mainDay || (arrangingRow.day !== '—' ? arrangingRow.day : arrangedDay);
      const mainTime = arrangingRow.mainTime || (arrangingRow.time !== '—' ? arrangingRow.time : null);

      const activeStart = isCustomStartTime ? customStartTime : startTimeChoice;
      const durationMin = category === 'Kinder' ? 90 : 120;
      const computedArrangedTime = buildTimeRangeStr(activeStart, durationMin);

      // 1. Save arrangedLesson, arrangedTeacher, arrangedDay, arrangedTime, mainTeacher, mainDay & mainTime into liveProgress
      await persist(arrangingRow, () => ({
        arrangedLesson,
        arrangedTeacher,
        arrangedDay,
        arrangedTime: computedArrangedTime,
        mainTeacher,
        mainDay,
        mainTime: mainTime || computedArrangedTime,
      }));

      // 2. Reassign student in Schedule Grid (internal_classes) to arrangedTeacher, arrangedDay, arrangedTime
      const hasLessonNum = category !== 'Coder';
      const newProgStr = hasLessonNum ? `${arrangingRow.levelCode}.${arrangedLesson}` : arrangingRow.levelCode;

      await reassignStudentInSchedule({
        studentName: arrangingRow.studentName,
        targetTeacher: arrangedTeacher,
        day: arrangedDay,
        time: computedArrangedTime,
        branchName: arrangingRow.branchName !== '—' ? arrangingRow.branchName : (branchList[0] || 'Kelapa Gading'),
        classType: arrangingRow.classType || 'Regular',
        program: newProgStr,
      });

      await logActivity({
        action: 'edit',
        summary: `Arranged lesson for ${arrangingRow.studentName} — Teacher: ${mainTeacher} → ${arrangedTeacher}, Day: ${mainDay} → ${arrangedDay}, Slot: ${mainTime || '—'} → ${computedArrangedTime} @ ${arrangingRow.branchName !== '—' ? arrangingRow.branchName : (branchList[0] || 'Kelapa Gading')}`,
        source: 'schedule',
        userEmail: user?.email || null,
        details: {
          student: arrangingRow.studentName,
          branchName: arrangingRow.branchName !== '—' ? arrangingRow.branchName : (branchList[0] || 'Kelapa Gading'),
          previous: { teacher: mainTeacher, day: mainDay, time: mainTime || '—' },
          after: { teacher: arrangedTeacher, day: arrangedDay, time: computedArrangedTime },
          changes: [
            { field: 'Teacher', before: mainTeacher, after: arrangedTeacher },
            { field: 'Day', before: mainDay, after: arrangedDay },
            { field: 'Slot', before: mainTime || '—', after: computedArrangedTime },
          ],
        },
      });

      const avail = checkInstructorAvailability(arrangedTeacher, arrangedDay);
      const termCode = arrangingRow.levelCode || arrangingRow.program;
      const formattedLesson = String(arrangedLesson).startsWith('L') ? arrangedLesson : `L${arrangedLesson}`;
      let toastMsg = `${termCode} - ${formattedLesson} arranged with ${arrangedTeacher} on ${arrangedDay} (${computedArrangedTime}) for ${arrangingRow.studentName}. (Main teacher: ${mainTeacher}). Schedule Grid updated!`;
      if (!avail.isAvailable) {
        toastMsg += ` ⚠️ Note: ${arrangedTeacher} is ${avail.employmentType} and not usually scheduled on ${arrangedDay}s.`;
      }

      showToast({
        title: 'Lesson Arrangement Saved',
        message: toastMsg,
        variant: avail.isAvailable ? 'success' : 'warning',
      });
      setArrangingRow(null);
    } catch (err) {
      console.error(err);
      showToast({ title: 'Failed to save arrangement', message: err.message, variant: 'error' });
    } finally {
      setArrangingSaving(false);
    }
  };

  const levels = useMemo(() => levelsForCategory(category), [category]);
  const branchList = useMemo(() => {
    const list = [...new Set([
      ...(enabledBranches || []).map((b) => b.name),
      ...(branches || []).map((b) => b.name),
    ])].filter(Boolean);
    return list.length > 0 ? list : DEFAULT_BRANCH_LIST.map((b) => b.name);
  }, [enabledBranches, branches]);

  useEffect(() => {
    const unsub = subscribeToInternalInstructors((data) => setInstructorProfiles(data || []));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToInternalStudents((data) => setStudentRegistry(data || []));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToInternalClasses(
      (data) => { setClasses(data || []); setLoading(false); },
      // Without this the spinner would run forever on a failed fetch, since
      // `loading` is only cleared by a successful response.
      (err) => { setLoadError(err.message); setLoading(false); }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToLiveProgress(
      (data) => { setProgress(data || []); setLoadError(null); },
      (err) => setLoadError(err.message),
      { category }
    );
    return () => unsub();
  }, [category]);

  // Latest stored progress, readable from a handler without it being a
  // dependency — see `persist`.
  const progressRef = useRef([]);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  /** Stored progress by student+level, for joining onto the schedule rows. */
  const progressByKey = useMemo(() => {
    const map = new Map();
    for (const p of progress) map.set(keyOf(p.studentName, p.programCode), p);
    return map;
  }, [progress]);

  /** Map student normalized name -> official registered status & branch in studentRegistry */
  const studentInfoMap = useMemo(() => {
    const map = new Map();
    for (const s of studentRegistry || []) {
      const bName = s.branchName || s.branch_name;
      if (s.name) {
        map.set(s.name.trim().toLowerCase(), {
          branchName: bName || null,
          status: s.status || 'Active',
        });
      }
    }
    return map;
  }, [studentRegistry]);

  /**
   * One row per enrolled student in this category.
   * Merges scheduled classes with registered students so no student is lost,
   * properly identifying unassigned students and unadded instructors.
   */
  const rows = useMemo(() => {
    const candidatesByKey = new Map();
    const placedStudents = new Set();

    // Helper to check if a teacher name corresponds to an active registered instructor
    const isRegisteredTeacher = (teacherName) => {
      if (!teacherName || teacherName === '—' || String(teacherName).trim() === '' || String(teacherName).toUpperCase() === 'TBD' || String(teacherName).toLowerCase() === 'unassigned') {
        return false;
      }
      return (instructorProfiles || []).some((p) => {
        const primary = getInstructorDisplayName(p) || p.name;
        return isInstructorMatch(teacherName, p) || isSameTeacher(teacherName, primary) || isSameTeacher(teacherName, p.name);
      });
    };

    // 1. Collect students from classes that match this category
    for (const c of classes) {
      const parsed = parseProgram(c.program);
      const progCategory = parsed.category || resolveProgramCategory(c.program);
      if (progCategory !== category) continue;

      const names = String(c.student || '')
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      if (names.length === 0) continue;

      // Coder levels are stored whole, so fold a legacy numbered one onto its
      // stage; Kinder and Junior use the bare code without the lesson number.
      const levelCode = category === 'Coder'
        ? normaliseCoderLevel(parsed.code || c.program)
        : (parsed.code || (category === 'Kinder' ? 'K1' : 'J1'));

      const rawTeacher = c.teacher ? String(c.teacher).trim() : '';
      const isKnown = isRegisteredTeacher(rawTeacher);
      const displayInstructor = isKnown ? resolveCanonicalTeacherName(rawTeacher, instructorProfiles) : rawTeacher;

      for (const name of names) {
        placedStudents.add(name.toLowerCase());
        const rowKey = keyOf(name, levelCode);
        const stored = progressByKey.get(rowKey);
        const info = studentInfoMap.get(name.trim().toLowerCase());
        // If we have a stored mainTeacher (original instructor before arrangement),
        // use it for the INSTRUCTOR column; otherwise fall back to the schedule's teacher
        const storedMain = stored?.mainTeacher
          ? resolveCanonicalTeacherName(stored.mainTeacher, instructorProfiles)
          : null;

        const effectiveInstructor = storedMain || displayInstructor || rawTeacher || '—';
        const hasValidInstructor = isRegisteredTeacher(effectiveInstructor);
        const isUnassigned = !hasValidInstructor || !c.day || c.day === '—' || !c.time || c.time === '—';
        const isUnregisteredInstructor = !hasValidInstructor && Boolean(rawTeacher && rawTeacher !== '—' && rawTeacher.toUpperCase() !== 'TBD' && rawTeacher.toLowerCase() !== 'unassigned');

        const item = {
          rowKey,
          classId: c.id,
          studentName: name,
          instructor: effectiveInstructor && effectiveInstructor !== '—' ? effectiveInstructor : 'Unassigned',
          originalInstructor: rawTeacher || null,
          isUnassigned,
          isUnregisteredInstructor,
          day: c.day || '—',
          time: c.time || '—',
          branchName: getCanonicalBranchName(c.branchName || c.branch_name || c.branch || '—') || '—',
          program: c.program || levelCode || '—',
          levelCode,
          lesson: parsed.lesson,
          classType: c.classType || 'Regular',
          status: info?.status || 'Active',
          progressId: stored?.id ?? null,
          attendance: stored?.attendance || {},
          videos: stored?.videos || {},
          continuation: stored?.continuation || CONTINUATION_OPTIONS[0],
          continuationNote: stored?.continuationNote || '',
          arrangedLesson: stored?.arrangedLesson || null,
          arrangedTeacher: stored?.arrangedTeacher ? resolveCanonicalTeacherName(stored.arrangedTeacher, instructorProfiles) : null,
          mainTeacher: storedMain || null,
        };

        if (!candidatesByKey.has(rowKey)) {
          candidatesByKey.set(rowKey, []);
        }
        candidatesByKey.get(rowKey).push(item);
      }
    }

    // 2. Include registered students from studentRegistry who are not placed in a class or belong to this category
    for (const s of (studentRegistry || [])) {
      if (!s.name || !s.name.trim()) continue;
      const sCategory = studentProgramCategory(s) || resolveProgramCategory(s.level);
      if (sCategory !== category) continue;

      const normName = s.name.trim().toLowerCase();
      if (placedStudents.has(normName)) continue; // Already covered by classes

      const defaultLevelCode = category === 'Coder'
        ? normaliseCoderLevel(s.level || 'Coder Basic')
        : (parseProgram(s.level).code || (category === 'Kinder' ? 'K1' : 'J1'));

      const rowKey = keyOf(s.name, defaultLevelCode);
      if (candidatesByKey.has(rowKey)) continue;

      const stored = progressByKey.get(rowKey);

      // Extract instructor/schedule from remarks if present (e.g. "Instructor: Sherlyn | Schedule: Monday 3:00 PM")
      let remarksTeacher = '';
      let remarksDay = '';
      let remarksTime = '';
      const rem = String(s.remarks || '');
      if (rem) {
        const instM = rem.match(/(?:Instructor|Teacher|Pengajar|Guru):\s*([^|\n]+)/i);
        if (instM) remarksTeacher = instM[1].trim();
        const dayM = rem.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i);
        if (dayM) remarksDay = dayM[1];
        const timeM = rem.match(/(\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*(?:am|pm)?)/i);
        if (timeM) remarksTime = timeM[1];
      }

      const rawTeacher = s.rawInstructor || remarksTeacher || '';
      const isKnown = isRegisteredTeacher(rawTeacher);
      const displayTeacher = isKnown ? resolveCanonicalTeacherName(rawTeacher, instructorProfiles) : rawTeacher;
      const isUnregisteredInstructor = !isKnown && Boolean(rawTeacher && rawTeacher !== '—' && rawTeacher.toUpperCase() !== 'TBD' && rawTeacher.toLowerCase() !== 'unassigned');

      const item = {
        rowKey,
        classId: null,
        studentName: s.name.trim(),
        instructor: displayTeacher && displayTeacher !== '—' ? displayTeacher : 'Unassigned',
        originalInstructor: rawTeacher || null,
        isUnassigned: true,
        isUnregisteredInstructor,
        day: s.rawDays || remarksDay || '—',
        time: s.rawTime || remarksTime || '—',
        branchName: getCanonicalBranchName(s.branchName || s.branch_name || s.branch || '—') || '—',
        program: s.level || defaultLevelCode || '—',
        levelCode: defaultLevelCode,
        lesson: null,
        classType: 'Regular',
        status: s.status || 'Active',
        progressId: stored?.id ?? null,
        attendance: stored?.attendance || {},
        videos: stored?.videos || {},
        continuation: stored?.continuation || CONTINUATION_OPTIONS[0],
        continuationNote: stored?.continuationNote || '',
        arrangedLesson: stored?.arrangedLesson || null,
        arrangedTeacher: stored?.arrangedTeacher ? resolveCanonicalTeacherName(stored.arrangedTeacher, instructorProfiles) : null,
        mainTeacher: stored?.mainTeacher || null,
      };

      candidatesByKey.set(rowKey, [item]);
    }

    const result = [];
    for (const [, list] of candidatesByKey.entries()) {
      if (list.length === 1) {
        result.push(list[0]);
        continue;
      }
      // If student appears multiple times (e.g. from imported schedule rows under two branches),
      // prefer the row matching their official branch in studentRegistry!
      const studentNameClean = list[0].studentName.trim().toLowerCase();
      const officialBranch = studentInfoMap.get(studentNameClean)?.branchName;

      let best = list[0];
      if (officialBranch) {
        const match = list.find((item) => isSameBranch(item.branchName, officialBranch));
        if (match) best = match;
      }
      result.push(best);
    }

    return result;
  }, [classes, studentRegistry, category, progressByKey, instructorProfiles, studentInfoMap]);

  /** Summary count for Active, Long Break, Inactive, and Unassigned students */
  const statusStats = useMemo(() => {
    let active = 0;
    let longBreak = 0;
    let inactive = 0;
    let unassigned = 0;
    let total = 0;

    for (const r of rows) {
      if (filterBranch !== 'all' && !isSameBranch(r.branchName, filterBranch)) continue;
      total++;
      if (r.isUnassigned) {
        unassigned++;
      }
      const st = String(r.status || 'Active').trim().toLowerCase();
      if (st.includes('break')) {
        longBreak++;
      } else if (st.includes('inactive')) {
        inactive++;
      } else {
        active++;
      }
    }

    return { active, longBreak, inactive, unassigned, total };
  }, [rows, filterBranch]);

  const instructorList = useMemo(() => {
    const set = new Set();
    let hasUnassigned = false;
    for (const r of rows) {
      if (filterBranch !== 'all' && !isSameBranch(r.branchName, filterBranch)) continue;
      if (filterDay !== 'all' && r.day.trim().toLowerCase() !== filterDay.trim().toLowerCase()) continue;
      if (filterLevel !== 'all' && r.levelCode !== filterLevel) continue;
      if (r.isUnassigned || !r.instructor || r.instructor === '—' || r.instructor.toLowerCase() === 'unassigned') {
        hasUnassigned = true;
      }
      if (r.instructor && r.instructor !== '—' && r.instructor.toLowerCase() !== 'unassigned') {
        set.add(r.instructor);
      }
    }
    const list = Array.from(set).sort((a, b) => a.localeCompare(b));
    if (hasUnassigned) {
      return ['Unassigned', ...list];
    }
    return list;
  }, [rows, filterBranch, filterDay, filterLevel]);

  useEffect(() => {
    if (filterInstructor !== 'all' && !instructorList.includes(filterInstructor)) {
      setFilterInstructor('all');
    }
  }, [instructorList, filterInstructor]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterBranch !== 'all' && !isSameBranch(r.branchName, filterBranch)) return false;
      if (filterLevel !== 'all' && r.levelCode !== filterLevel) return false;
      if (filterDay !== 'all' && r.day.trim().toLowerCase() !== filterDay.trim().toLowerCase()) return false;
      if (filterInstructor !== 'all') {
        if (filterInstructor === 'Unassigned') {
          if (!r.isUnassigned && r.instructor && r.instructor !== '—' && r.instructor.toLowerCase() !== 'unassigned') {
            return false;
          }
        } else if (r.instructor !== filterInstructor) {
          return false;
        }
      }
      if (filterContinuation !== 'all' && r.continuation !== filterContinuation) return false;
      if (filterStatus !== 'all') {
        const rSt = String(r.status || 'Active').toLowerCase();
        const fSt = filterStatus.toLowerCase();
        if (fSt === 'unassigned') {
          if (!r.isUnassigned) return false;
        } else if (fSt === 'active') {
          if (rSt.includes('inactive') || rSt.includes('break')) return false;
        } else if (fSt === 'long break') {
          if (!rSt.includes('break')) return false;
        } else if (fSt === 'inactive') {
          if (!rSt.includes('inactive')) return false;
        }
      }
      if (q) {
        const hit = [r.studentName, r.instructor, r.program, r.day, r.branchName, r.status, r.isUnassigned ? 'unassigned' : '']
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, search, filterBranch, filterLevel, filterDay, filterInstructor, filterContinuation, filterStatus]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => {
      const dayA = getDayIndex(a.day);
      const dayB = getDayIndex(b.day);
      if (dayA !== dayB) return dayA - dayB;
      return a.studentName.localeCompare(b.studentName);
    }),
    [filtered]
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Clamped where it is derived: the schedule polls, so the list can shrink
  // under the current page rather than the user having navigated off the end.
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paged = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /** Attendance ticks recorded across the visible rows, for the header summary. */
  const attended = useMemo(
    () => sorted.reduce((n, r) => n + Object.keys(r.attendance).length, 0),
    [sorted]
  );

  /**
   * Persist a change, sending the whole record because the endpoint upserts.
   *
   * `mutate` receives the freshest stored values rather than the row captured at
   * render, and returns only the fields it changes. This matters: ticking two
   * lessons in quick succession used to send the second one built on the first
   * render's attendance map, which silently dropped the first tick — it looked
   * as though the tick had not saved.
   */
  const persist = async (row, mutate) => {
    const latest = progressRef.current.find(
      (p) => keyOf(p.studentName, p.programCode) === row.rowKey
    );
    const base = {
      attendance: { ...(latest?.attendance ?? row.attendance) },
      videos: { ...(latest?.videos ?? row.videos) },
      continuation: latest?.continuation ?? row.continuation,
      continuationNote: latest?.continuationNote ?? row.continuationNote,
      arrangedLesson: latest?.arrangedLesson ?? row.arrangedLesson,
      arrangedTeacher: latest?.arrangedTeacher ?? row.arrangedTeacher,
      mainTeacher: latest?.mainTeacher ?? row.mainTeacher,
    };
    const record = {
      studentName: row.studentName,
      programCode: row.levelCode,
      category,
      ...base,
      ...mutate(base),
    };

    setSaving(true);
    // Show it at once rather than waiting for the ten-second poll, and keep the
    // optimistic copy in the ref too so a change landing before the next poll
    // still builds on it.
    setProgress((prev) => [
      ...prev.filter((p) => keyOf(p.studentName, p.programCode) !== row.rowKey),
      { id: latest?.id ?? row.progressId, ...record },
    ]);
    try {
      const saved = await saveLiveProgress(record);
      // Adopt the server's row so the id is real and any normalisation sticks.
      setProgress((prev) => [
        ...prev.filter((p) => keyOf(p.studentName, p.programCode) !== row.rowKey),
        saved,
      ]);
    } catch (err) {
      showToast({ title: 'Could not save progress', message: err.message, variant: 'error' });
      // Drop the optimistic copy so the table stops showing a change that the
      // database rejected; the next poll restores the truth.
      setProgress((prev) => prev.filter(
        (p) => keyOf(p.studentName, p.programCode) !== row.rowKey
      ));
    } finally {
      setSaving(false);
    }
  };

  const openAttendance = (row, lesson) => {
    const entry = row.attendance[lesson];
    setEditing({ rowKey: row.rowKey, classId: row.classId, lesson });
    setDraftDate(entry?.date || isoOf(new Date()));
    setDraftNote(entry?.note || '');
  };

  const closeAttendance = () => { setEditing(null); setDraftDate(''); setDraftNote(''); };

  const saveAttendance = async (row, lesson, { clear = false } = {}) => {
    // Close first: the save is optimistic, so the tick is already correct and
    // holding the dialog open until the round trip finishes just feels slow.
    closeAttendance();
    const nextAttendance = { ...row.attendance };
    if (clear) delete nextAttendance[lesson];
    else nextAttendance[lesson] = { date: draftDate || null, note: draftNote };

    await persist(row, () => ({ attendance: nextAttendance }));

    // Sync updated next undone lesson to internal_classes schedule if applicable
    if (category !== 'Coder' && row.studentName) {
      const nextUndone = getNextUndoneLesson(nextAttendance, maxLessons);
      const levelCode = row.levelCode || row.program;
      const newProgStr = `${levelCode}.${nextUndone}`;

      const normStudent = String(row.studentName).trim().toLowerCase();
      const studentClass = (classes || []).find((c) => {
        const sList = String(c.student || '').split(',').map((s) => s.trim().toLowerCase());
        return sList.includes(normStudent);
      });

      if (studentClass && studentClass.id) {
        try {
          await updateInternalClass(studentClass.id, {
            day: studentClass.day,
            time: studentClass.time,
            program: newProgStr,
            student: studentClass.student,
            teacher: studentClass.teacher,
            branchName: studentClass.branchName,
            classType: studentClass.classType || 'Regular',
            remarks: studentClass.remarks || null,
          });
        } catch (e) {
          console.warn('Could not sync attendance lesson to schedule class:', e);
        }
      }
    }
  };

  const openVideoModal = (row, level) => {
    const existing = row.videos?.[level];
    const link = typeof existing === 'string' ? existing : (existing?.link || '');
    setVideoModal({ row, level, link });
    setVideoLinkInput(link);
  };

  const closeVideoModal = () => {
    setVideoModal(null);
    setVideoLinkInput('');
  };

  const handleSaveVideoLink = async () => {
    if (!videoModal) return;
    const { row, level } = videoModal;
    const trimmed = String(videoLinkInput || '').trim();
    setVideoSaving(true);
    try {
      await persist(row, (base) => {
        const videos = { ...base.videos };
        if (trimmed) {
          videos[level] = { link: trimmed, date: new Date().toISOString() };
        } else {
          delete videos[level];
        }
        return { videos };
      });
      showToast({
        title: trimmed ? 'Video Link Saved' : 'Video Link Cleared',
        message: trimmed
          ? `Google video link attached for ${row.studentName} (${level})`
          : `Video link removed for ${row.studentName} (${level})`,
        variant: 'success',
      });
      closeVideoModal();
    } catch (err) {
      showToast({ title: 'Error saving video link', message: err.message, variant: 'error' });
    } finally {
      setVideoSaving(false);
    }
  };

  const handleRemoveVideoLink = async () => {
    if (!videoModal) return;
    const { row, level } = videoModal;
    setVideoSaving(true);
    try {
      await persist(row, (base) => {
        const videos = { ...base.videos };
        delete videos[level];
        return { videos };
      });
      showToast({
        title: 'Video Link Removed',
        message: `Video link removed for ${row.studentName} (${level})`,
        variant: 'success',
      });
      closeVideoModal();
    } catch (err) {
      showToast({ title: 'Error removing video link', message: err.message, variant: 'error' });
    } finally {
      setVideoSaving(false);
    }
  };

  const toggleVideo = async (row, level) => {
    openVideoModal(row, level);
  };

  const setContinuation = async (row, value) => {
    await persist(row, () => ({ continuation: value }));
  };

  // Escape closes the attendance editor, matching the rest of the app.
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeAttendance(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  const editorRef = useRef(null);
  useEffect(() => {
    if (!editing) return undefined;
    const onDown = (e) => {
      if (!editorRef.current?.contains(e.target)) closeAttendance();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [editing]);

  const editingRow = editing
    ? paged.find((r) => r.rowKey === editing.rowKey && r.classId === editing.classId)
    : null;

  return (
    <section className="dashboard-view active">
      <div className="panel full-schedule-panel">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <TrendingUp size={18} /> {category} Progress
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Attendance, videos sent and continuation for every {category} student.
              Tick a lesson to record the date and a note.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            {/* Active Students Counter Badge */}
            <div
              onClick={() => { setFilterStatus(filterStatus === 'Active' ? 'all' : 'Active'); setPage(1); }}
              title="Click to filter Active students"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.3rem 0.65rem', borderRadius: '20px', cursor: 'pointer',
                background: filterStatus === 'Active' ? 'rgba(16,185,129,0.22)' : 'rgba(16,185,129,0.1)',
                border: filterStatus === 'Active' ? '1.5px solid #10b981' : '1px solid rgba(16,185,129,0.3)',
                color: '#047857', fontSize: '0.75rem', fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981' }}></span>
              <span>Active: <strong>{statusStats.active}</strong></span>
            </div>

            {/* Long Break Students Counter Badge */}
            <div
              onClick={() => { setFilterStatus(filterStatus === 'Long Break' ? 'all' : 'Long Break'); setPage(1); }}
              title="Click to filter Long Break students"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.3rem 0.65rem', borderRadius: '20px', cursor: 'pointer',
                background: filterStatus === 'Long Break' ? 'rgba(245,158,11,0.22)' : 'rgba(245,158,11,0.1)',
                border: filterStatus === 'Long Break' ? '1.5px solid #f59e0b' : '1px solid rgba(245,158,11,0.3)',
                color: '#b45309', fontSize: '0.75rem', fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#f59e0b' }}></span>
              <span>Long Break: <strong>{statusStats.longBreak}</strong></span>
            </div>

            {/* Inactive Students Counter Badge */}
            <div
              onClick={() => { setFilterStatus(filterStatus === 'Inactive' ? 'all' : 'Inactive'); setPage(1); }}
              title="Click to filter Inactive students"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.3rem 0.65rem', borderRadius: '20px', cursor: 'pointer',
                background: filterStatus === 'Inactive' ? 'rgba(239,68,68,0.22)' : 'rgba(239,68,68,0.1)',
                border: filterStatus === 'Inactive' ? '1.5px solid #ef4444' : '1px solid rgba(239,68,68,0.3)',
                color: '#b91c1c', fontSize: '0.75rem', fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#ef4444' }}></span>
              <span>Inactive: <strong>{statusStats.inactive}</strong></span>
            </div>

            {/* Unassigned Students Counter Badge */}
            <div
              onClick={() => { setFilterStatus(filterStatus === 'Unassigned' ? 'all' : 'Unassigned'); setPage(1); }}
              title="Click to filter Unassigned students"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.3rem 0.65rem', borderRadius: '20px', cursor: 'pointer',
                background: filterStatus === 'Unassigned' ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.1)',
                border: filterStatus === 'Unassigned' ? '1.5px solid #7c3aed' : '1px solid rgba(124,58,237,0.3)',
                color: '#6d28d9', fontSize: '0.75rem', fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#7c3aed' }}></span>
              <span>Unassigned: <strong>{statusStats.unassigned}</strong></span>
            </div>

            <span aria-hidden="true" style={{ color: 'var(--border-color)', margin: '0 0.15rem' }}>·</span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-main)' }}>{sorted.length}</strong> total · <strong style={{ color: 'var(--text-main)' }}>{attended}</strong> lessons
            </span>
            {saving && <span style={{ color: 'var(--primary-blue)', fontSize: '0.75rem' }}>saving…</span>}
          </div>
        </div>

        {loadError && (
          <div style={{ padding: '0.7rem 1.5rem', fontSize: '0.78rem', color: 'var(--danger)', background: 'var(--danger-bg, rgba(239,68,68,0.08))' }}>
            Could not load progress: {loadError}
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', background: 'var(--bg-color)' }}>
          <div className="input-group" style={{ margin: 0, flex: '1 1 200px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Search</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search student, instructor, program, day…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ paddingLeft: '2rem', width: '100%' }}
              />
            </div>
          </div>

          <div className="input-group" style={{ margin: 0, width: '150px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Status</label>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} style={{ width: '100%' }}>
              <option value="all">All Statuses</option>
              <option value="Active">Active ({statusStats.active})</option>
              <option value="Long Break">Long Break ({statusStats.longBreak})</option>
              <option value="Inactive">Inactive ({statusStats.inactive})</option>
              <option value="Unassigned">Unassigned ({statusStats.unassigned})</option>
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '150px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Instructor</label>
            <select value={filterInstructor} onChange={(e) => { setFilterInstructor(e.target.value); setPage(1); }} style={{ width: '100%' }}>
              <option value="all">All Instructors</option>
              {instructorList.map((inst) => <option key={inst} value={inst}>{inst}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '140px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Day</label>
            <select value={filterDay} onChange={(e) => { setFilterDay(e.target.value); setPage(1); }} style={{ width: '100%' }}>
              <option value="all">All Days</option>
              {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '140px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Level</label>
            <select value={filterLevel} onChange={(e) => { setFilterLevel(e.target.value); setPage(1); }} style={{ width: '100%' }}>
              <option value="all">All Levels</option>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '140px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Branch</label>
            <select value={filterBranch} onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }} style={{ width: '100%' }}>
              <option value="all">All Branches</option>
              {branchList.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '150px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Continuation</label>
            <select value={filterContinuation} onChange={(e) => { setFilterContinuation(e.target.value); setPage(1); }} style={{ width: '100%' }}>
              <option value="all">All Answers</option>
              {CONTINUATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div className="panel-body table-wrapper" style={{ position: 'relative', overflowX: 'auto' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
              <div className="loading-spinner" style={{ marginBottom: '1rem' }} />
              <p>Loading {category} progress…</p>
            </div>
          ) : (
            <table id="schedule-table" style={{ minWidth: '1280px' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: '170px' }}>Student Name</th>
                  <th style={{ width: '140px' }}>Instructor</th>
                  <th style={{ width: '100px' }}>Day</th>
                  <th style={{ width: '130px' }}>Time</th>
                  <th style={{ width: '110px' }}>Program</th>
                  <th style={{ minWidth: '240px' }}>Lesson Arrangement</th>
                  <th style={{ minWidth: category === 'Coder' ? '290px' : '250px' }}>Attendance 1–{maxLessons}</th>
                  <th style={{ minWidth: '180px' }}>Video Sent</th>
                  <th style={{ width: '160px' }}>Continuation</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <AlertTriangle size={32} style={{ color: 'var(--warning)', marginBottom: '0.5rem' }} />
                      <div style={{ fontWeight: 600 }}>No {category} students scheduled</div>
                      <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                        Allocate a {category} student to a class and they will appear here.
                      </div>
                    </td>
                  </tr>
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <div style={{ fontWeight: 600 }}>No student matches your filters.</div>
                    </td>
                  </tr>
                ) : (
                  paged.map((r) => {
                    const tint = CONTINUATION_TINT[r.continuation] || CONTINUATION_TINT['Not Decide Yet'];
                    return (
                      <tr key={`${r.rowKey}||${r.classId}`}>
                        <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <User size={14} style={{ color: 'var(--text-muted)' }} />
                            <span>{r.studentName}</span>
                            {r.isUnassigned && (
                              <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: 'rgba(124,58,237,0.14)', color: '#6d28d9', border: '1px solid rgba(124,58,237,0.3)', whiteSpace: 'nowrap' }}>
                                UNASSIGNED
                              </span>
                            )}
                            {r.status && String(r.status).toLowerCase().includes('break') && (
                              <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: 'rgba(245,158,11,0.15)', color: '#b45309', border: '1px solid rgba(245,158,11,0.3)', whiteSpace: 'nowrap' }}>
                                Long Break
                              </span>
                            )}
                            {r.status && String(r.status).toLowerCase().includes('inactive') && (
                              <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: 'rgba(239,68,68,0.15)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.3)', whiteSpace: 'nowrap' }}>
                                Inactive
                              </span>
                            )}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400, marginTop: '0.15rem' }}>
                            <MapPin size={10} /> {r.branchName}
                            {r.classType !== 'Regular' && ` · ${r.classType}`}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>
                          {r.isUnregisteredInstructor ? (
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{r.instructor}</div>
                              <span style={{ fontSize: '0.64rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: 'rgba(245,158,11,0.15)', color: '#b45309', border: '1px solid rgba(245,158,11,0.3)', display: 'inline-flex', alignItems: 'center', gap: '2px', marginTop: '2px' }}>
                                <AlertTriangle size={9} /> Not in website
                              </span>
                            </div>
                          ) : r.instructor && r.instructor !== '—' && r.instructor.toLowerCase() !== 'unassigned' ? (
                            r.instructor
                          ) : (
                            <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: 'rgba(124,58,237,0.12)', color: '#6d28d9' }}>
                              Unassigned
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Calendar size={12} style={{ color: 'var(--text-muted)' }} /> {r.day}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.82rem' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Clock size={12} style={{ color: 'var(--text-muted)' }} /> {r.time}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                            background: 'var(--primary-blue-light, rgba(79,70,229,0.1))',
                            color: 'var(--primary-blue, #4f46e5)',
                            padding: '0.15rem 0.5rem', borderRadius: '6px',
                            fontSize: '0.74rem', fontWeight: 600, whiteSpace: 'nowrap',
                          }}>
                            <GraduationCap size={11} /> {r.program}
                          </span>
                        </td>

                        {/* Lesson Arrangement (SPA arrangement) */}
                        <td>
                          {(() => {
                            const displayTeacher = r.arrangedTeacher || (r.instructor && r.instructor !== 'Unassigned' && r.instructor !== '—' ? r.instructor : null);
                            const displayLesson = r.arrangedLesson || r.lesson || getNextUndoneLesson(r.attendance, maxLessons);
                            const isArranged = !!r.arrangedTeacher && (!r.instructor || r.arrangedTeacher.toLowerCase() !== r.instructor.toLowerCase());
                            const termCode = r.levelCode || r.program;
                            const cleanLesson = String(displayLesson).replace(/^L/i, '') || '1';
                            
                            let badgeLabel = category === 'Coder'
                              ? `Coder · ${displayTeacher || 'Unassigned'}`
                              : `${termCode}.${cleanLesson} · ${displayTeacher || 'Unassigned'}`;
                            if (!displayTeacher && r.isUnassigned) {
                              badgeLabel = `+ Assign Instructor`;
                            }

                            return (
                              <button
                                type="button"
                                onClick={() => openArrangementModal(r)}
                                title={isArranged
                                  ? `Arranged: ${displayTeacher} (Main: ${r.instructor}). Click to edit.`
                                  : r.isUnassigned
                                    ? `Click to arrange lesson & assign an active instructor for ${r.studentName}`
                                    : `Click to arrange lesson & assign branch instructor for ${r.studentName}`}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                                  padding: '0.28rem 0.6rem', borderRadius: '7px', cursor: 'pointer',
                                  fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
                                  border: isArranged
                                    ? '1.5px solid rgba(217,119,6,0.4)'
                                    : r.isUnassigned
                                      ? '1.5px dashed rgba(124,58,237,0.45)'
                                      : '1.5px solid rgba(79,70,229,0.3)',
                                  background: isArranged
                                    ? 'rgba(245,158,11,0.1)'
                                    : r.isUnassigned
                                      ? 'rgba(124,58,237,0.08)'
                                      : 'rgba(79,70,229,0.06)',
                                  color: isArranged ? '#92400e' : r.isUnassigned ? '#6d28d9' : '#3730a3',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <BookOpen size={12} style={{ color: isArranged ? '#d97706' : r.isUnassigned ? '#7c3aed' : 'var(--primary-blue, #4f46e5)', flexShrink: 0 }} />
                                <span style={{ whiteSpace: 'nowrap' }}>{badgeLabel}</span>
                                {isArranged && (
                                  <span style={{ fontSize: '0.62rem', background: 'rgba(217,119,6,0.15)', color: '#92400e', padding: '0 4px', borderRadius: '3px', fontWeight: 700, letterSpacing: '0.3px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                    REPLACED
                                  </span>
                                )}
                                <Edit3 size={11} style={{ opacity: 0.7, marginLeft: '2px', flexShrink: 0 }} />
                              </button>
                            );
                          })()}
                        </td>

                        {/* Attendance ticks. The title carries the date and note,
                            so hovering answers "when, and what happened". */}
                        <td>
                          <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                            {lessons.map((n) => {
                              const entry = r.attendance[n];
                              const done = !!entry;
                              const isOpen = editing?.rowKey === r.rowKey &&
                                editing?.classId === r.classId && editing?.lesson === n;
                              const tip = done
                                ? `Lesson ${n} · ${entry.date || 'no date'}${entry.note ? `\n${entry.note}` : '\nNo note'}`
                                : `Lesson ${n} — not recorded. Click to tick it.`;
                              return (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => openAttendance(r, n)}
                                  title={tip}
                                  aria-label={`Lesson ${n} for ${r.studentName}${done ? ', attended' : ', not recorded'}`}
                                  aria-pressed={done}
                                  style={{
                                    position: 'relative',
                                    width: '22px', height: '22px', borderRadius: '5px',
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer', fontSize: '0.6rem', fontWeight: 700,
                                    border: `1px solid ${isOpen ? 'var(--primary-blue)' : done ? 'rgba(5,150,105,0.8)' : 'var(--border-color)'}`,
                                    background: done ? 'rgba(5,150,105,0.16)' : 'transparent',
                                    color: done ? '#047857' : 'var(--text-muted)',
                                    outline: isOpen ? '2px solid var(--primary-blue)' : 'none',
                                    outlineOffset: '1px',
                                  }}
                                >
                                  {done ? <Check size={12} strokeWidth={3} /> : n}
                                  {/* A note is easy to miss on a tick alone. */}
                                  {done && entry.note && (
                                    <span
                                      aria-hidden="true"
                                      style={{
                                        position: 'absolute', top: '-3px', right: '-3px',
                                        width: '6px', height: '6px', borderRadius: '99px',
                                        background: '#b45309',
                                      }}
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </td>

                        {/* Video sent, one chip per level in this category. */}
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {levels.map((lvl) => {
                              const videoEntry = r.videos?.[lvl];
                              const sent = !!videoEntry;
                              const link = typeof videoEntry === 'string' ? videoEntry : videoEntry?.link;
                              return (
                                <button
                                  key={lvl}
                                  type="button"
                                  onClick={() => openVideoModal(r, lvl)}
                                  title={sent
                                    ? link
                                      ? `${lvl} Video attached: ${link}\nClick to view or edit Google link`
                                      : `${lvl} Video marked as sent\nClick to attach Google link`
                                    : `Click to attach ${lvl} Google video link`}
                                  aria-pressed={sent}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.22rem',
                                    padding: '0.14rem 0.42rem', borderRadius: '6px', cursor: 'pointer',
                                    fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap',
                                    border: `1.5px solid ${sent ? '#0891b2' : 'var(--border-color)'}`,
                                    background: sent ? 'rgba(8,145,178,0.15)' : 'transparent',
                                    color: sent ? '#0891b2' : 'var(--text-muted)',
                                    boxShadow: sent ? '0 1px 3px rgba(8,145,178,0.2)' : 'none',
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  {sent && <Video size={10} style={{ flexShrink: 0 }} />}
                                  {lvl}
                                </button>
                              );
                            })}
                          </div>
                        </td>

                        <td>
                          <select
                            value={r.continuation}
                            onChange={(e) => setContinuation(r, e.target.value)}
                            aria-label={`Continuation for ${r.studentName}`}
                            className="modal-select-field field-compact"
                            style={{
                              width: '100%', fontSize: '0.75rem', fontWeight: 600,
                              color: tint.color, background: tint.bg,
                            }}
                          >
                            {CONTINUATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {!loading && totalPages > 1 && (
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      </div>

      {/* Attendance editor. A small dialog rather than an inline field, because a
          date and a free-text note do not fit inside a 22px tick. */}
      {editing && editingRow && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            ref={editorRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Lesson ${editing.lesson} for ${editingRow.studentName}`}
            style={{
              background: 'var(--panel-bg)', border: '1px solid var(--border-color)',
              borderRadius: '16px', width: '100%', maxWidth: '400px', maxHeight: '92vh',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{ padding: '1.1rem 1.3rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  Lesson {editing.lesson} of {maxLessons}
                </h3>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {editingRow.studentName} · {editingRow.program} · {editingRow.instructor}
                </p>
              </div>
              <button
                type="button"
                onClick={closeAttendance}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', lineHeight: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1rem 1.3rem', display: 'flex', flexDirection: 'column', gap: '0.8rem', overflowY: 'auto' }}>
              <div>
                <label className="modal-form-label" htmlFor="attendance-date">Date attended</label>
                <input
                  id="attendance-date"
                  type="date"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  className="modal-input-field"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label className="modal-form-label" htmlFor="attendance-note">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <StickyNote size={12} /> Note
                  </span>
                </label>
                <textarea
                  id="attendance-note"
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  placeholder="What happened in this lesson? Shown on hover."
                  className="modal-textarea-field"
                  style={{ width: '100%', minHeight: '90px' }}
                />
              </div>
            </div>

            <div style={{ padding: '0.9rem 1.3rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem', justifyContent: 'space-between', background: 'var(--bg-color)' }}>
              <button
                type="button"
                disabled={saving || !editingRow.attendance[editing.lesson]}
                onClick={() => saveAttendance(editingRow, editing.lesson, { clear: true })}
                title="Remove this tick"
                className="btn"
                style={{
                  border: '1px solid var(--danger-border, rgba(239,68,68,0.4))', background: 'transparent',
                  color: 'var(--danger)', borderRadius: '8px', padding: '0.45rem 0.8rem', fontSize: '0.8rem',
                  cursor: editingRow.attendance[editing.lesson] ? 'pointer' : 'not-allowed',
                  opacity: editingRow.attendance[editing.lesson] ? 1 : 0.5,
                }}
              >
                Clear tick
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={closeAttendance}
                  className="btn"
                  style={{ border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '8px', padding: '0.45rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveAttendance(editingRow, editing.lesson)}
                  className="btn btn-primary"
                  style={{ borderRadius: '8px', padding: '0.45rem 1rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <Check size={14} /> {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lesson & Instructor Arrangement Modal */}
      {arrangingRow && (() => {
        const currentAvail = checkInstructorAvailability(arrangedTeacher, arrangingRow.day);
        const mainAvail = checkInstructorAvailability(arrangingRow.instructor, arrangingRow.day);

        return (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              style={{
                background: 'var(--panel-bg, white)', border: '1px solid var(--border-color)',
                borderRadius: '16px', width: '100%', maxWidth: '620px', maxHeight: '90vh',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
                animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
              }}
            >
              {/* Modal Header */}
              <div style={{ padding: '1.1rem 1.4rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Lesson Arrangement</h3>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {arrangingRow.studentName} · {arrangingRow.branchName} ({arrangingRow.day} {arrangingRow.time})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setArrangingRow(null)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div style={{ padding: '1.25rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1.1rem', overflowY: 'auto' }}>
                
                {/* Main Instructor & Current Enrollment Info Box */}
                <div style={{ background: 'rgba(79,70,229,0.05)', border: '1px solid rgba(79,70,229,0.18)', padding: '0.75rem 1rem', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Main Instructor</div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <User size={14} style={{ color: '#4f46e5' }} />
                      <span>{arrangingRow.instructor}</span>
                      <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(79,70,229,0.12)', color: '#4f46e5', fontWeight: 600 }}>
                        {mainAvail.employmentType}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>Program</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>{arrangingRow.program}</div>
                  </div>
                </div>

                {/* Target Arranged Lesson (Kinder / Junior) */}
                {category !== 'Coder' && (
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                      Target Arranged Lesson *
                    </label>
                    <select
                      value={arrangedLesson}
                      onChange={(e) => setArrangedLesson(e.target.value)}
                      className="modal-select-field"
                      style={{ width: '100%', fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                    >
                      {Array.from({ length: maxLessons }, (_, i) => i + 1).map((n) => {
                        const isDone = !!arrangingRow.attendance[n];
                        const termCode = arrangingRow.levelCode || arrangingRow.program;
                        return (
                          <option key={n} value={String(n)}>
                            {termCode}.{n} {isDone ? ' (Done ✓)' : ' (Not done)'}
                          </option>
                        );
                      })}
                    </select>

                    <div style={{ fontSize: '0.72rem', marginTop: '0.4rem', color: arrangingRow.attendance[arrangedLesson] ? '#b45309' : '#059669', fontWeight: 500 }}>
                      {arrangingRow.attendance[arrangedLesson] ? (
                        <span>⚠️ Note: {arrangingRow.studentName} has already completed {(arrangingRow.levelCode || arrangingRow.program)}.{String(arrangedLesson).replace(/^L/i, '')}.</span>
                      ) : (
                        <span>💡 Arranging {(arrangingRow.levelCode || arrangingRow.program)}.{String(arrangedLesson).replace(/^L/i, '')} for {arrangingRow.studentName}.</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Target Day & Target Time Selection */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                  {/* Target Day */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                      Target Arranged Day *
                    </label>
                    <select
                      value={arrangedDay}
                      onChange={(e) => setArrangedDay(e.target.value)}
                      className="modal-select-field"
                      style={{ width: '100%', fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                    >
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => (
                        <option key={d} value={d}>
                          {d} {d.toLowerCase() === (arrangingRow.day || '').toLowerCase() ? '(Main Schedule Day)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Target Start Schedule */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                      Target Start Schedule *
                    </label>
                    {!isCustomStartTime ? (
                      <select
                        value={startTimeChoice}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') {
                            setIsCustomStartTime(true);
                            setCustomStartTime('');
                          } else {
                            setStartTimeChoice(e.target.value);
                          }
                        }}
                        className="modal-select-field"
                        style={{ width: '100%', fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                      >
                        {[
                          '1:00 PM',
                          '1:30 PM',
                          '2:00 PM',
                          '2:30 PM',
                          '3:00 PM',
                          '3:30 PM',
                          '4:00 PM',
                          '4:30 PM',
                          '5:00 PM',
                        ].map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                        <option value="__custom__">✏️ Custom Start Time...</option>
                      </select>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <input
                          type="text"
                          value={customStartTime}
                          placeholder="e.g. 2:00 PM"
                          onChange={(e) => setCustomStartTime(e.target.value)}
                          className="modal-input-field"
                          style={{ flex: 1, fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setIsCustomStartTime(false)}
                          style={{ fontSize: '0.72rem' }}
                        >
                          Presets
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Automatically Calculated Class Schedule Range Banner */}
                {(() => {
                  const durationMin = category === 'Kinder' ? 90 : 120;
                  const activeStart = isCustomStartTime ? customStartTime : startTimeChoice;
                  const computedRange = buildTimeRangeStr(activeStart, durationMin);
                  return (
                    <div style={{
                      padding: '0.55rem 0.85rem', borderRadius: '8px',
                      background: 'rgba(79,70,229,0.06)', border: '1px solid rgba(79,70,229,0.2)',
                      fontSize: '0.78rem', color: '#4f46e5', fontWeight: 600,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span>🕒 Arranged Class Schedule: <strong>{computedRange}</strong></span>
                      <span style={{ fontSize: '0.7rem', background: '#4f46e5', color: '#fff', padding: '0.15rem 0.45rem', borderRadius: '5px' }}>
                        {category === 'Kinder' ? 'Kinder 90m (1.5h)' : 'Junior/Coder 120m (2.0h)'}
                      </span>
                    </div>
                  );
                })()}

                {/* Arranged / Replacement Instructor Selection */}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                    Arranged / Replacement Instructor at {arrangingRow.branchName} *
                  </label>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.45rem' }}>
                    Select a teacher for this lesson. Main instructor ({arrangingRow.instructor}) will remain preserved.
                  </span>
                  <select
                    value={arrangedTeacher}
                    onChange={(e) => setArrangedTeacher(e.target.value)}
                    className="modal-select-field"
                    style={{ width: '100%', fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                  >
                    {!arrangedTeacher && <option value="">Select Instructor...</option>}
                    {getInstructorsForBranch(arrangingRow.branchName).map((inst) => {
                      const check = checkInstructorAvailability(inst, arrangedDay);
                      const isMain = inst.toLowerCase() === String(arrangingRow.instructor || '').toLowerCase();
                      const warningTag = !check.isAvailable ? ' ⚠️' : '';
                      return (
                        <option key={inst} value={inst}>
                          {inst} — {check.label} {isMain ? '★ (Main Teacher)' : ''}{warningTag}
                        </option>
                      );
                    })}
                  </select>

                  {/* Employment Type & Availability Banner */}
                  {(() => {
                    const currentAvail = checkInstructorAvailability(arrangedTeacher, arrangedDay);
                    return (
                      <div style={{
                        marginTop: '0.6rem', padding: '0.6rem 0.85rem', borderRadius: '8px',
                        fontSize: '0.74rem', fontWeight: 500,
                        background: currentAvail.isAvailable ? 'rgba(5,150,105,0.08)' : 'rgba(245,158,11,0.12)',
                        border: `1px solid ${currentAvail.isAvailable ? 'rgba(5,150,105,0.25)' : 'rgba(245,158,11,0.3)'}`,
                        color: currentAvail.isAvailable ? '#047857' : '#b45309',
                        display: 'flex', alignItems: 'center', gap: '0.4rem'
                      }}>
                        {currentAvail.isAvailable ? (
                          <>
                            <CheckCircle2 size={15} />
                            <span>
                              <strong>{arrangedTeacher}</strong> is <strong>{currentAvail.employmentType}</strong> and available on {arrangedDay}s.
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle size={15} />
                            <span>
                              <strong>Availability Notice:</strong> {arrangedTeacher} is <strong>{currentAvail.employmentType}</strong> and not scheduled on {arrangedDay}s.
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Modal Footer */}
              <div style={{ padding: '1rem 1.4rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', background: 'var(--bg-color)' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setArrangingRow(null)}
                  style={{ background: '#f1f5f9', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={arrangingSaving}
                  onClick={handleSaveArrangement}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Save size={15} />
                  {arrangingSaving ? 'Saving…' : 'Save Lesson Arrangement'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Video Attachment Modal */}
      {videoModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-modal-title"
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: '1rem',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeVideoModal(); }}
        >
          <div
            style={{
              background: 'var(--panel-bg, #ffffff)',
              borderRadius: '16px',
              maxWidth: '480px', width: '100%',
              boxShadow: '0 16px 40px rgba(0,0,0,0.2)',
              border: '1px solid var(--border-color)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '1.2rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              background: 'var(--bg-color)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '10px',
                  background: 'rgba(8, 145, 178, 0.12)', color: '#0891b2',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Video size={18} />
                </div>
                <div>
                  <h3 id="video-modal-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
                    Attach Video Link
                  </h3>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                    {videoModal.row.studentName} — <strong>{videoModal.level}</strong>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeVideoModal}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  Google Drive / Video Link URL *
                </label>
                <input
                  type="url"
                  value={videoLinkInput}
                  onChange={(e) => setVideoLinkInput(e.target.value)}
                  placeholder="https://drive.google.com/file/d/... or link"
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '8px',
                    border: '1.5px solid var(--border-color)',
                    fontSize: '0.85rem',
                    background: 'var(--bg-color)',
                    color: 'var(--text-main)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveVideoLink();
                    }
                  }}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem', display: 'block' }}>
                  Paste Google Drive, Google Photos, YouTube, or any public video recording link.
                </span>
              </div>

              {videoModal.link && (
                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  background: 'rgba(8, 145, 178, 0.08)',
                  border: '1px solid rgba(8, 145, 178, 0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                }}>
                  <div style={{ fontSize: '0.78rem', color: '#0e7490', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '0.5rem' }}>
                    <strong>Attached:</strong> {videoModal.link}
                  </div>
                  <a
                    href={videoModal.link.startsWith('http') ? videoModal.link : `https://${videoModal.link}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      fontSize: '0.75rem', fontWeight: 600,
                      color: '#0891b2', textDecoration: 'none', flexShrink: 0
                    }}
                  >
                    Open <ExternalLink size={13} />
                  </a>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '1rem 1.5rem',
              borderTop: '1px solid var(--border-color)',
              background: 'var(--bg-color)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div>
                {videoModal.row.videos?.[videoModal.level] ? (
                  <button
                    type="button"
                    onClick={handleRemoveVideoLink}
                    disabled={videoSaving}
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: 'var(--danger, #ef4444)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      borderRadius: '8px',
                      padding: '0.45rem 0.9rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Remove Video
                  </button>
                ) : null}
              </div>

              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button
                  type="button"
                  onClick={closeVideoModal}
                  disabled={videoSaving}
                  className="btn"
                  style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.82rem' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveVideoLink}
                  disabled={videoSaving || !videoLinkInput.trim()}
                  className="btn"
                  style={{
                    background: '#0891b2',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.45rem 1.1rem',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: videoSaving || !videoLinkInput.trim() ? 'not-allowed' : 'pointer',
                    opacity: videoSaving || !videoLinkInput.trim() ? 0.6 : 1,
                  }}
                >
                  {videoSaving ? 'Saving...' : 'Save Video Link'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
