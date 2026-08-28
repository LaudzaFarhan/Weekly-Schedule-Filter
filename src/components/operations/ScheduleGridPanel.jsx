'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { LayoutGrid, Video } from 'lucide-react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { useNewOperationals } from '../../hooks/useNewOperationals';
import { useScheduleRules } from '../../hooks/useScheduleRules';
import { subscribeToInternalInstructors } from '../../services/internalInstructorService';
import {
  subscribeToInternalClasses, createInternalClass,
  updateInternalClass, deleteInternalClass,
} from '../../services/internalScheduleService';
import { subscribeToLeaves } from '../../services/newLeaveService';
import { subscribeToLiveProgress, saveLiveProgress } from '../../services/newLiveProgressService';
import { saveOperational } from '../../services/newOperationalsService';
import { logActivity } from '../../services/newActivityService';
import { formatScheduleActivitySummary } from '../../lib/scheduleActivityHelper';
import { groupClasses } from '../../lib/instructorAvailability';
import { slotTypeMeta, cleanSlotList } from '../../lib/slotTypes';
import { DAY_NAMES, isSameBranch } from '../../utils/constants';
import { isSameTeacher, resolveCanonicalTeacherName } from '../../utils/instructorUtils';
import ScheduleGrid from './ScheduleGrid';

/**
 * The availability-first planning grid, with everything it needs to read and
 * write on its own.
 *
 * Self-contained so it can sit on the Schedule page — where the planning
 * actually happens — rather than only inside Operationals. All state comes from
 * PostgreSQL via the New Operations hooks and services.
 */
export default function ScheduleGridPanel({ onNavigate } = {}) {
  const { branches } = useSchedule();
  const { showToast } = useToast();
  const { user } = useAuth();
  const { rules: opRules, applyLocal } = useNewOperationals();
  const { rules: scheduleRules } = useScheduleRules();

  const [instructors, setInstructors] = useState([]);
  const [classes, setClasses] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [liveProgress, setLiveProgress] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = subscribeToInternalInstructors((data) => setInstructors(data || []));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToInternalClasses(
      (data) => setClasses(data || []),
      () => { /* the grid falls back to plan-only knowledge */ }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToLeaves(
      (data) => setLeaves(data || []),
      () => { /* leave is optional context */ }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToLiveProgress((data) => setLiveProgress(data || []));
    return () => unsub();
  }, []);

  // internal_classes holds one row per enrolled student; collapse them into
  // actual classes so occupancy and conflicts count correctly.
  const classGroups = useMemo(() => groupClasses(classes), [classes]);

  // ── branch rules, shaped the way the grid expects ──────────────────────────

  const byBranchDay = useMemo(() => {
    const map = new Map();
    for (const r of opRules) map.set(`${r.branchName}||${r.day}`, r);
    return map;
  }, [opRules]);

  /** branchId -> Set(open day names) */
  const draft = useMemo(() => {
    const out = {};
    for (const b of branches) {
      const set = new Set();
      for (const day of DAY_NAMES) {
        if (byBranchDay.get(`${b.name}||${day}`)?.isOpen) set.add(day);
      }
      out[b.id] = set;
    }
    return out;
  }, [branches, byBranchDay]);

  /** branchId -> { day: { start, end } } */
  const draftHours = useMemo(() => {
    const out = {};
    for (const b of branches) {
      const hours = {};
      for (const day of DAY_NAMES) {
        const r = byBranchDay.get(`${b.name}||${day}`);
        if (r?.openTime && r?.closeTime) hours[day] = { start: r.openTime, end: r.closeTime };
      }
      out[b.id] = hours;
    }
    return out;
  }, [branches, byBranchDay]);

  /** branchId -> { day: [slots] } */
  const draftOps = useMemo(() => {
    const out = {};
    for (const b of branches) {
      const ops = {};
      for (const day of DAY_NAMES) {
        const slots = byBranchDay.get(`${b.name}||${day}`)?.slots;
        if (Array.isArray(slots) && slots.length) ops[day] = slots;
      }
      out[b.id] = ops;
    }
    return out;
  }, [branches, byBranchDay]);

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Write one branch/day rule, then reflect it locally so the grid updates
   * immediately rather than on the next poll.
   */
  const persistDay = useCallback(async (branchId, day, slots) => {
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;
    const hrs = draftHours[branchId]?.[day];
    const payload = {
      branchName: branch.name,
      day,
      isOpen: !!draft[branchId]?.has(day),
      openTime: hrs?.start || null,
      closeTime: hrs?.end || null,
      slots: cleanSlotList(slots),
    };
    await saveOperational(payload);
    applyLocal(payload);
  }, [branches, draft, draftHours, applyLocal]);

  const withSaving = async (fn, failTitle) => {
    setSaving(true);
    try {
      await fn();
    } catch (err) {
      showToast({ title: failTitle, message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const addSlot = (branchId, day, slot) => withSaving(async () => {
    const next = [...(draftOps[branchId]?.[day] || []), slot]
      .sort((a, b) => a.start.localeCompare(b.start));
    await persistDay(branchId, day, next);
    showToast({
      title: `${slotTypeMeta(slot.type).label} added`,
      message: `${slot.start}–${slot.end}${slot.instructor ? ` for ${slot.instructor}` : ''} on ${day}.`,
      variant: 'success',
    });
  }, 'Could not add the slot');

  const removeSlot = (branchId, day, idx) => withSaving(async () => {
    const next = (draftOps[branchId]?.[day] || []).filter((_, i) => i !== idx);
    await persistDay(branchId, day, next);
  }, 'Could not remove the slot');

  const moveSlot = (branchId, day, idx, patch) => withSaving(async () => {
    const next = (draftOps[branchId]?.[day] || [])
      .map((s, i) => (i === idx ? { ...s, ...patch } : s))
      .sort((a, b) => a.start.localeCompare(b.start));
    await persistDay(branchId, day, next);
    showToast({
      title: 'Slot moved',
      message: `Now ${patch.start}–${patch.end}${patch.instructor ? ` with ${patch.instructor}` : ''}.`,
      variant: 'success',
    });
  }, 'Could not move the slot');

  const editSlot = (branchId, day, idx, patch) => withSaving(async () => {
    const next = (draftOps[branchId]?.[day] || [])
      .map((s, i) => (
        // `instructor: ''` must clear the field, so it is assigned outright.
        i === idx ? { ...s, ...patch, instructor: patch.instructor || undefined } : s
      ))
      .sort((a, b) => a.start.localeCompare(b.start));
    await persistDay(branchId, day, next);
    showToast({ title: `${slotTypeMeta(patch.type).label} updated`, variant: 'success' });
  }, 'Could not update the session');

  /**
   * Move a real class. Every enrolled student is one row, so the whole group
   * moves together — live student data, hence the confirmation.
   */
  const moveClass = async (group, patch) => {
    const count = group.ids.length;
    const changes = [
      patch.time !== group.time ? `Time: ${group.time} → ${patch.time}` : null,
      patch.teacher !== group.teacher ? `Instructor: ${group.teacher} → ${patch.teacher}` : null,
    ].filter(Boolean);
    if (!changes.length) return;

    const sameStart = patch.time.split(' - ')[0] === group.time.split(' - ')[0];
    const verb = sameStart && patch.teacher === group.teacher
      ? "Change this class's length"
      : 'Move this class';

    if (!window.confirm(
      `${verb}?\n\n${changes.join('\n')}\n\n` +
      `${count} student${count === 1 ? '' : 's'} on ${group.day} at ${group.branchName} will be rescheduled.`
    )) return;

    await withSaving(async () => {
      // PUT /api/new/schedule replaces the whole row, so every field is sent —
      // a partial body would blank the student, program and branch.
      for (const id of group.ids) {
        const row = classes.find((c) => c.id === id);
        if (!row) continue;
        await updateInternalClass(id, {
          day: row.day,
          time: patch.time,
          program: row.program,
          student: row.student,
          teacher: patch.teacher,
          branchName: row.branchName,
          classType: row.classType,
          remarks: row.remarks,
          sessionDates: row.sessionDates || [],
        });
      }
      setClasses((prev) => prev.map((c) => (
        group.ids.includes(c.id) ? { ...c, time: patch.time, teacher: patch.teacher } : c
      )));
      const diffList = [];
      if (patch.time !== group.time) diffList.push({ field: 'Slot', before: group.time, after: patch.time });
      if (patch.teacher !== group.teacher) diffList.push({ field: 'Teacher', before: group.teacher, after: patch.teacher });

      await logActivity({
        action: 'edit',
        summary: `Moved class on ${group.day} at ${group.branchName}: ${changes.join(', ')}`,
        count,
        source: 'schedule',
        userEmail: user?.email || null,
        details: {
          day: group.day,
          branchName: group.branchName,
          previous: { time: group.time, teacher: group.teacher },
          after: { time: patch.time, teacher: patch.teacher },
          changes: diffList,
          count,
        },
      });
      showToast({ title: 'Class moved', message: `${count} student${count === 1 ? '' : 's'} rescheduled.`, variant: 'success' });
    }, 'Could not move the class');
  };

  const addStudent = (group, entry) => withSaving(async () => {
    const created = await createInternalClass({
      day: group.day,
      time: group.time,
      program: entry.program || group.programs[0] || '',
      student: entry.student,
      teacher: group.teacher,
      branchName: group.branchName,
      classType: entry.classType,
      sessionDates: entry.sessionDates || [],
    });
    if (created) setClasses((prev) => [created, ...prev]);
    await logActivity({
      action: 'add',
      summary: `Added ${entry.student} (${entry.classType || 'Regular'}) — ${entry.program || group.programs[0] || 'General'} · ${group.day} ${group.time} with ${group.teacher} @ ${group.branchName}`,
      source: 'schedule',
      userEmail: user?.email || null,
      details: {
        student: entry.student,
        program: entry.program || group.programs[0] || '',
        day: group.day,
        time: group.time,
        teacher: group.teacher,
        branchName: group.branchName,
        classType: entry.classType || 'Regular',
      },
    });
    showToast({
      title: `${entry.student} added`,
      message: entry.classType === 'Regular'
        ? 'Fixed weekly place.'
        : `${entry.classType} on ${(entry.sessionDates || []).join(', ')}.`,
      variant: 'success',
    });
  }, 'Could not add the student');

  const removeStudent = async (member, group) => {
    const studentName = member.student ? String(member.student).trim() : '';
    if (!studentName) return;

    const normStudent = studentName.toLowerCase();
    const currentTeacher = group?.teacher || member.teacher;

    // Check if this student is currently in a temporary lesson arrangement in liveProgress
    const lpRecord = (liveProgress || []).find(
      (p) => String(p.studentName || p.student_name || p.student || '').trim().toLowerCase() === normStudent
    );

    const arrangedTeacher = lpRecord?.arrangedTeacher || lpRecord?.arranged_teacher;
    const mainTeacher = lpRecord?.mainTeacher || lpRecord?.main_teacher || member?.mainTeacher || member?.main_teacher;

    const isArrangedPlacement = (
      (!!arrangedTeacher && isSameTeacher(arrangedTeacher, currentTeacher)) ||
      (!!mainTeacher && !isSameTeacher(mainTeacher, currentTeacher))
    );

    if (!isArrangedPlacement || !mainTeacher) {
      showToast({
        title: 'Cannot remove from main instructor',
        message: `${studentName} is assigned to main instructor ${currentTeacher}. Main instructor schedule placements cannot be deleted from the Schedule Grid. Use Live Progress to reassign their lesson.`,
        variant: 'warning',
      });
      return;
    }

    const canonicalMain = resolveCanonicalTeacherName(mainTeacher, instructors);
    if (window.confirm(
      `Ending temporary arrangement for ${studentName} with ${currentTeacher}?\n\n` +
      `This will restore ${studentName} back to their main instructor ${canonicalMain || mainTeacher}.`
    )) {
      await withSaving(async () => {
        // 1. Remove student from current temporary teacher's schedule row
        const currentRows = classes.filter((c) => {
          const sList = String(c.student || '').split(',').map((s) => s.trim().toLowerCase());
          return sList.includes(normStudent) && isSameTeacher(c.teacher, currentTeacher);
        });

        const updatedCurrentRows = [];

        for (const c of currentRows) {
          const remaining = String(c.student || '').split(',').map((s) => s.trim()).filter((s) => s.toLowerCase() !== normStudent);
          const updatedRow = { ...c, student: remaining.join(', ') };
          await updateInternalClass(c.id, {
            day: c.day,
            time: c.time,
            student: remaining.join(', '),
            branchName: c.branchName,
            classType: c.classType,
            teacher: c.teacher,
            program: c.program,
          });
          updatedCurrentRows.push(updatedRow);
        }

        // 2. Re-create / Restore student in mainTeacher's schedule as an individual class row
        const mainTargetTeacher = canonicalMain || mainTeacher;
        const targetDay = lpRecord?.mainDay || lpRecord?.main_day || member.mainDay || member.day || group?.day || 'Monday';
        const targetBranch = member.branchName || member.branch_name || group?.branchName || group?.branch || 'Puri Indah';
        const targetProgram = member.program || lpRecord?.programCode || 'K1';

        // Check if mainTargetTeacher has an existing class slot on targetDay & targetBranch
        const mainTeacherClass = classes.find((c) => {
          const sameTeacher = isSameTeacher(c.teacher, mainTargetTeacher);
          const sameDay = String(c.day || '').trim().toLowerCase() === String(targetDay || '').trim().toLowerCase();
          const sameBranch = isSameBranch(c.branchName, targetBranch) ||
            String(c.branchName || '').trim().toLowerCase() === 'all branches' ||
            String(targetBranch || '').trim().toLowerCase() === 'all branches';
          return sameTeacher && sameDay && sameBranch;
        });

        if (mainTeacherClass) {
          // Merge student into mainTeacherClass instead of creating a duplicate row
          const currentStudents = String(mainTeacherClass.student || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const normStudentName = studentName.trim().toLowerCase();
          if (!currentStudents.some((s) => s.toLowerCase() === normStudentName)) {
            currentStudents.push(studentName.trim());
          }
          await updateInternalClass(mainTeacherClass.id, {
            day: mainTeacherClass.day || targetDay,
            time: mainTeacherClass.time || targetTime,
            student: currentStudents.join(', '),
            branchName: mainTeacherClass.branchName || targetBranch,
            program: mainTeacherClass.program || targetProgram,
            classType: mainTeacherClass.classType || member.classType || 'Regular',
            teacher: mainTargetTeacher,
          });
        } else {
          await createInternalClass({
            teacher: mainTargetTeacher,
            student: studentName,
            day: targetDay,
            time: targetTime,
            branchName: targetBranch,
            program: targetProgram,
            classType: member.classType || 'Regular',
          });
        }

        // 3. Clear arrangedTeacher and arrangedLesson in internal_live_progress
        if (lpRecord) {
          await saveLiveProgress({
            studentName: lpRecord.studentName || studentName,
            programCode: lpRecord.programCode || targetProgram,
            arrangedTeacher: null,
            arrangedLesson: null,
            mainTeacher: mainTargetTeacher,
          });
        }

        // 4. Instantly update local React state `classes` so the grid updates on screen IMMEDIATELY
        setClasses((prev) => {
          let next = prev.map((c) => {
            const u = updatedCurrentRows.find((uc) => uc.id === c.id);
            return u || c;
          });
          if (createdRestoredRow) {
            next = [createdRestoredRow, ...next];
          }
          return next;
        });

        await logActivity({
          action: 'edit',
          summary: `Ended temporary arrangement for ${studentName} — Teacher: ${currentTeacher} → ${mainTargetTeacher} @ ${targetBranch}`,
          source: 'schedule',
          userEmail: user?.email || null,
          details: {
            student: studentName,
            branchName: targetBranch,
            previous: { teacher: currentTeacher },
            after: { teacher: mainTargetTeacher },
            changes: [
              { field: 'Teacher', before: currentTeacher, after: mainTargetTeacher },
            ],
          },
        });

        showToast({
          title: `Restored to ${mainTargetTeacher}`,
          message: `Temporary arrangement ended. ${studentName} returned to main instructor ${mainTargetTeacher}.`,
          variant: 'success',
        });
      }, 'Could not restore student to main instructor');
    }
  };

  const updateStudent = (member, patch) => withSaving(async () => {
    const targetRowId = member.rowId || member.id;
    const row = classes.find((c) => c.id === targetRowId);
    if (!row) return;
    const isIzinPatch = patch.isIzin !== undefined ? patch.isIzin : (patch.notArranged !== undefined ? patch.notArranged : undefined);
    const newIzinState = isIzinPatch !== undefined ? isIzinPatch : !!(row.notArranged || row.isIzin || (typeof row.remarks === 'string' && row.remarks.toLowerCase().includes('izin')));
    const remarks = newIzinState ? 'Izin' : (patch.remarks !== undefined ? patch.remarks : (row.remarks === 'Izin' ? '' : row.remarks));

    // Handle explicit progressUpdateStatus update
    if (patch.progressUpdateStatus !== undefined) {
      try {
        await saveLiveProgress({
          studentName: row.student,
          programCode: row.program || 'General',
          progressUpdateStatus: patch.progressUpdateStatus,
        });
      } catch (e) {
        console.warn('Could not save live progress status:', e);
      }
    }

    const updated = await updateInternalClass(targetRowId, {
      day: row.day,
      time: row.time,
      program: row.program,
      student: row.student,
      teacher: row.teacher,
      branchName: row.branchName,
      classType: patch.classType ?? row.classType,
      remarks: remarks,
      sessionDates: patch.sessionDates ?? row.sessionDates ?? [],
    });

    setClasses((prev) =>
      prev.map((c) =>
        c.id === targetRowId
          ? {
              ...c,
              ...updated,
              notArranged: newIzinState,
              isIzin: newIzinState,
              remarks: remarks,
              progressUpdateStatus: patch.progressUpdateStatus ?? c.progressUpdateStatus,
            }
          : c
      )
    );

    showToast({
      title: patch.progressUpdateStatus
        ? `Updated progress status for ${row.student}`
        : `${row.student} ${newIzinState ? 'marked Izin (On Leave)' : 'marked Present'}`,
      message: patch.progressUpdateStatus
        ? `Status set to "${patch.progressUpdateStatus}".`
        : newIzinState ? '1 open replacement seat created for this slot.' : 'Status updated.',
      variant: newIzinState ? 'warning' : 'success',
    });
  }, 'Could not update the student');

  return (
    <div className="panel" style={{ margin: '0 0 1.5rem' }}>
      <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <LayoutGrid size={19} /> Schedule Grid
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
            Plan from who is actually free. Columns are instructors, rows are 30 minutes. Click a cell to open a class,
            or a card to manage its students. Gaps too short for a class can still take a meeting, training or break.
            Drag a card to move it, drag its bottom edge to change length.
          </p>
        </div>
        {onNavigate && (
          <button
            onClick={() => onNavigate('meetings')}
            className="btn btn-primary"
            style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', borderRadius: '8px' }}
          >
            <Video size={15} /> Schedule Meeting
          </button>
        )}
      </div>

      <ScheduleGrid
        branches={branches}
        instructors={instructors}
        classGroups={classGroups}
        leaves={leaves}
        liveProgress={liveProgress}
        draft={draft}
        draftOps={draftOps}
        draftHours={draftHours}
        rules={scheduleRules}
        saving={saving}
        onAddSlot={addSlot}
        onRemoveSlot={removeSlot}
        onMoveSlot={moveSlot}
        onMoveClass={moveClass}
        onEditSlot={editSlot}
        onAddStudent={addStudent}
        onRemoveStudent={removeStudent}
        onUpdateStudent={updateStudent}
        /*
         * A class card holds a student NAME, not an id — `internal_classes`
         * stores names. This panel does not load the student registry, so the
         * name is passed through and the Report Cards page resolves it against
         * the list it already holds. Resolving here would mean subscribing to
         * the whole registry for one button.
         */
        onOpenStudentReport={onNavigate
          ? (studentName) => onNavigate('report-cards', { studentName })
          : undefined}
      />
    </div>
  );
}
