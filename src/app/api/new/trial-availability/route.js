import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';
import { DAY_NAMES } from '@/utils/constants';
import {
  categorize,
  levelCovers,
  hhmmToMin,
  minToHHMM,
  parseSlotLabel,
  rangesOverlap,
  groupIntoSlots,
  maxStudentsForProgram,
  standardTrialWindows,
  hourlyWindows
} from '@/lib/newOpsAnalytics';

/**
 * GET: Trial availability — which windows can still take a student, and why the
 * rest cannot.
 *
 * Read-only. Optional filters:
 *   ?branch=Bekasi&day=Monday&category=Kinder|Junior|Coder
 *
 * Windows come from the best source available for each branch/day, so this
 * works whether or not Operationals has been configured:
 *   1. `plan`     — the branch's Class Operation slot plan (richest: typed
 *                   slots, breaks, training and meetings all respected)
 *   2. `hours`    — hourly windows inside the branch's operating hours
 *   3. `standard` — the default 1pm-6:30pm one-hour trial windows
 *
 * Availability itself always comes from instructor capability plus the live
 * schedule, which exist independently of any configuration.
 */
export async function GET(req) {
  try {
    await ensureTable('internal_operationals');

    const { searchParams } = new URL(req.url);
    const branchFilter = searchParams.get('branch');
    const dayFilter = searchParams.get('day');
    const categoryFilter = searchParams.get('category');

    const [opsRes, instRes, classRes] = await Promise.all([
      query('SELECT * FROM internal_operationals ORDER BY branch_name, id'),
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

    // rule lookup: "branch||day" -> row
    const ruleFor = new Map();
    for (const r of opsRes.rows) ruleFor.set(`${r.branch_name}||${r.day}`, r);

    // Branch universe: anywhere that has rules, instructors or classes. This is
    // what lets the endpoint answer before Operationals is configured.
    const branchSet = new Set();
    for (const r of opsRes.rows) branchSet.add(r.branch_name);
    for (const i of instructors) {
      for (const b of i.branches) if (b && b !== 'All Branches') branchSet.add(b);
    }
    for (const c of classes) if (c.branchName) branchSet.add(c.branchName);

    const branches = [...branchSet]
      .filter((b) => !branchFilter || b === branchFilter)
      .sort();

    const staffAt = (branchName) => instructors.filter((i) =>
      i.branches.includes(branchName) || i.branches.includes('All Branches')
    );

    const results = [];
    const sourcesUsed = new Set();

    for (const branchName of branches) {
      const staff = staffAt(branchName);

      // Days: the branch's configured open days, else every day.
      const configuredDays = DAY_NAMES.filter((d) => ruleFor.get(`${branchName}||${d}`)?.isOpen);
      const days = (configuredDays.length ? configuredDays : DAY_NAMES)
        .filter((d) => !dayFilter || d === dayFilter);

      for (const day of days) {
        const rule = ruleFor.get(`${branchName}||${day}`);
        const plan = Array.isArray(rule?.slots) ? rule.slots : [];

        // Pick the window source for this day.
        let windows;
        let source;
        if (plan.length) {
          source = 'plan';
          windows = plan.map((s) => ({
            start: hhmmToMin(s.start),
            end: hhmmToMin(s.end),
            type: s.type || 'any',
            label: s.label || ''
          }));
        } else if (rule?.open_time && rule?.close_time) {
          source = 'hours';
          const duration = categoryFilter === 'Kinder' ? 90 : 120;
          windows = hourlyWindows(hhmmToMin(rule.open_time), hhmmToMin(rule.close_time), duration)
            .map((w) => ({ ...w, type: 'any', label: '' }));
        } else {
          source = 'standard';
          windows = standardTrialWindows().map((w) => ({ ...w, type: 'any', label: '' }));
        }
        sourcesUsed.add(source);

        for (const w of windows) {
          if (w.start == null || w.end == null) continue;
          const label = `${minToHHMM(w.start)} - ${minToHHMM(w.end)}`;

          // Non-class blocks never take a student.
          if (['break', 'training', 'meeting'].includes(w.type)) {
            results.push({
              branchName, day, source,
              start: minToHHMM(w.start), end: minToHHMM(w.end),
              slotType: w.type, note: w.label,
              available: false,
              reason: `Reserved for ${w.type}${w.label ? ` — ${w.label}` : ''}`,
              freeInstructors: [], joinableClasses: [], existingSlots: []
            });
            continue;
          }

          const slotCategory = w.type === 'any'
            ? null
            : w.type.charAt(0).toUpperCase() + w.type.slice(1);

          // A typed slot can't serve a different category.
          if (categoryFilter && slotCategory && slotCategory !== categoryFilter) {
            results.push({
              branchName, day, source,
              start: minToHHMM(w.start), end: minToHHMM(w.end),
              slotType: w.type, note: w.label,
              available: false,
              reason: `${slotCategory} Class slot — student is ${categoryFilter}`,
              freeInstructors: [], joinableClasses: [], existingSlots: []
            });
            continue;
          }

          const wantedCategory = categoryFilter || slotCategory;
          const qualified = staff.filter((i) => levelCovers(i.level, wantedCategory));

          // Classes already running in this window at this branch.
          const overlapping = bookedSlots.filter((s) => {
            if (s.day !== day || s.branchName !== branchName) return false;
            const parsed = parseSlotLabel(s.time);
            return parsed ? rangesOverlap(parsed, w) : false;
          });
          const busyNames = new Set(overlapping.map((s) => s.teacher));
          const free = qualified.filter((i) => !busyNames.has(i.name));

          const existing = overlapping.map((s) => {
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
          if (staff.length === 0) {
            available = false;
            reason = 'No instructors assigned to this branch';
          } else if (qualified.length === 0) {
            available = false;
            reason = wantedCategory
              ? `No ${wantedCategory} instructor at this branch`
              : 'No instructor at this branch';
          } else if (free.length === 0 && joinable.length === 0) {
            available = false;
            reason = 'All qualified instructors busy and no open seats';
          } else if (free.length === 0) {
            const seats = joinable.reduce((s, e) => s + e.seatsLeft, 0);
            reason = `Can join an existing class (${seats} seat${seats === 1 ? '' : 's'} left)`;
          } else if (slotCategory) {
            reason = `${slotCategory} Class · ${reason}`;
          }

          results.push({
            branchName, day, source,
            start: minToHHMM(w.start), end: minToHHMM(w.end),
            slotType: w.type, note: w.label,
            available, reason,
            freeInstructors: free.map((i) => ({ name: i.name, level: i.level })),
            joinableClasses: joinable,
            existingSlots: existing
          });
        }
      }
    }

    const dayOrder = (d) => {
      const i = DAY_NAMES.indexOf(d);
      return i === -1 ? 99 : i;
    };
    results.sort((a, b) =>
      a.branchName.localeCompare(b.branchName) ||
      dayOrder(a.day) - dayOrder(b.day) ||
      a.start.localeCompare(b.start)
    );

    return NextResponse.json({
      filters: {
        branch: branchFilter || null,
        day: dayFilter || null,
        category: categoryFilter || null
      },
      // Tells the caller how much of this is configured vs assumed.
      windowSources: [...sourcesUsed],
      configuredRules: opsRes.rowCount,
      note: opsRes.rowCount === 0
        ? 'No Class Operation plan configured, so the standard 1pm-6:30pm trial windows were used. Availability still reflects live instructors and classes.'
        : undefined,
      total: results.length,
      availableCount: results.filter((r) => r.available).length,
      data: results
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
