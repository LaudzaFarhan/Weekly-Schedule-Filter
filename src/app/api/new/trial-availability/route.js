import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';
import {
  categorize,
  levelCovers,
  hhmmToMin,
  minToHHMM,
  parseSlotLabel,
  rangesOverlap,
  groupIntoSlots,
  maxStudentsForProgram
} from '@/lib/newOpsAnalytics';

/**
 * GET: Trial availability — which planned slots can still take a student.
 *
 * Read-only. Optional filters:
 *   ?branch=Bekasi&day=Monday&category=Kinder|Junior|Coder
 *
 * Availability is worked out from three sources:
 *  1. internal_operationals — the branch/day Class Operation plan (open days,
 *     hours, and each slot's type). Falls back to hourly windows inside the
 *     operating hours when a day has no plan.
 *  2. internal_instructors — who works at that branch and what they can teach.
 *  3. internal_classes — who is already busy, and how full each slot is.
 */
export async function GET(req) {
  try {
    // Reads the operational plan, so make sure that table exists first.
    await ensureTable('internal_operationals');
    const { searchParams } = new URL(req.url);
    const branchFilter = searchParams.get('branch');
    const dayFilter = searchParams.get('day');
    const categoryFilter = searchParams.get('category');

    const [opsRes, instRes, classRes] = await Promise.all([
      query('SELECT * FROM internal_operationals WHERE is_open = TRUE ORDER BY branch_name, id'),
      query('SELECT name, level, branches, status FROM internal_instructors'),
      query('SELECT id, day, time, program, student, teacher, branch_name, remarks FROM internal_classes')
    ]);

    const instructors = instRes.rows
      .filter((r) => !r.status || r.status === 'Active')
      .map((r) => ({ name: r.name, level: r.level, branches: r.branches || [] }));

    const classes = classRes.rows.map((r) => ({
      id: r.id,
      day: r.day,
      time: r.time,
      program: r.program,
      student: r.student,
      teacher: r.teacher,
      branchName: r.branch_name,
      remarks: r.remarks
    }));
    const bookedSlots = groupIntoSlots(classes);

    const atBranch = (branchName) => instructors.filter((i) =>
      i.branches.includes(branchName) || i.branches.includes('All Branches')
    );

    const results = [];

    for (const rule of opsRes.rows) {
      const branchName = rule.branch_name;
      const day = rule.day;
      if (branchFilter && branchName !== branchFilter) continue;
      if (dayFilter && day !== dayFilter) continue;

      const staff = atBranch(branchName);
      const planned = Array.isArray(rule.slots) ? rule.slots : [];

      // Candidate windows: the day's plan, or hourly fallback within hours.
      let windows;
      if (planned.length) {
        windows = planned.map((s) => ({
          start: hhmmToMin(s.start),
          end: hhmmToMin(s.end),
          type: s.type || 'any',
          label: s.label || '',
          fromPlan: true
        }));
      } else {
        const openMin = hhmmToMin(rule.open_time) ?? 9 * 60;
        const closeMin = hhmmToMin(rule.close_time) ?? 18 * 60;
        windows = [];
        for (let t = openMin; t + 120 <= closeMin; t += 60) {
          windows.push({ start: t, end: t + 120, type: 'any', label: '', fromPlan: false });
        }
      }

      for (const w of windows) {
        if (w.start == null || w.end == null) continue;

        // Non-class blocks never take a student.
        if (['break', 'training', 'meeting'].includes(w.type)) {
          results.push({
            branchName,
            day,
            start: minToHHMM(w.start),
            end: minToHHMM(w.end),
            slotType: w.type,
            note: w.label,
            available: false,
            reason: `Reserved for ${w.type}`,
            freeInstructors: [],
            existingSlots: []
          });
          continue;
        }

        const slotCategory = w.type === 'any' ? null
          : w.type.charAt(0).toUpperCase() + w.type.slice(1);

        // Skip windows that can't serve the requested category.
        if (categoryFilter && slotCategory && slotCategory !== categoryFilter) continue;
        const wantedCategory = categoryFilter || slotCategory;

        // Instructors qualified for this window and not already teaching in it.
        const qualified = staff.filter((i) => levelCovers(i.level, wantedCategory));
        const busyNames = new Set(
          bookedSlots
            .filter((s) => {
              if (s.day !== day || s.branchName !== branchName) return false;
              const parsed = parseSlotLabel(s.time);
              return parsed ? rangesOverlap(parsed, w) : false;
            })
            .map((s) => s.teacher)
        );
        const free = qualified.filter((i) => !busyNames.has(i.name));

        // Existing lessons in this window that still have room.
        const existing = bookedSlots
          .filter((s) => {
            if (s.day !== day || s.branchName !== branchName) return false;
            const parsed = parseSlotLabel(s.time);
            return parsed ? rangesOverlap(parsed, w) : false;
          })
          .map((s) => {
            const max = maxStudentsForProgram(s.program);
            return {
              teacher: s.teacher,
              time: s.time,
              program: s.program,
              category: categorize(s.program),
              studentCount: s.students.length,
              maxStudents: max,
              seatsLeft: Math.max(0, max - s.students.length)
            };
          });

        const joinable = existing.filter((e) =>
          e.seatsLeft > 0 && (!wantedCategory || e.category === wantedCategory)
        );

        let available = true;
        let reason = `${free.length} instructor${free.length === 1 ? '' : 's'} free`;
        if (qualified.length === 0) {
          available = false;
          reason = wantedCategory
            ? `No ${wantedCategory} instructor at this branch`
            : 'No instructor at this branch';
        } else if (free.length === 0 && joinable.length === 0) {
          available = false;
          reason = 'All qualified instructors busy and no open seats';
        } else if (free.length === 0 && joinable.length > 0) {
          reason = `Can join an existing class (${joinable.reduce((s, e) => s + e.seatsLeft, 0)} seats left)`;
        }

        results.push({
          branchName,
          day,
          start: minToHHMM(w.start),
          end: minToHHMM(w.end),
          slotType: w.type,
          note: w.label,
          fromPlan: w.fromPlan,
          available,
          reason,
          freeInstructors: free.map((i) => ({ name: i.name, level: i.level })),
          joinableClasses: joinable,
          existingSlots: existing
        });
      }
    }

    results.sort((a, b) =>
      a.branchName.localeCompare(b.branchName) ||
      a.day.localeCompare(b.day) ||
      a.start.localeCompare(b.start)
    );

    return NextResponse.json({
      filters: {
        branch: branchFilter || null,
        day: dayFilter || null,
        category: categoryFilter || null
      },
      note: opsRes.rowCount === 0
        ? 'No operational rules found — configure Operationals or POST to /api/new/operationals first.'
        : undefined,
      total: results.length,
      availableCount: results.filter((r) => r.available).length,
      data: results
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
