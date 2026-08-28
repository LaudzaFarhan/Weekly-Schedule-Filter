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
  standardTrialWindows,
  hourlyWindows
} from '@/lib/newOpsAnalytics';
import { maxStudentsFor } from '@/lib/programRules';
import { slotCapacity } from '@/lib/slotTypes';
import { indexProgress, indexStudents, seatsFor } from '@/lib/trialSeats';

/** Seat totals for a window that holds no class at all. */
const EMPTY_SEATS = { classes: 0, max: 0, enrolled: 0, occupied: 0, releasing: 0, left: 0, leftStrict: 0 };

/** Slot kinds that block the time rather than taking a student. */
const NON_CLASS_TYPES = ['break', 'training', 'meeting'];

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
 *                   slots, breaks, training and meetings all respected, and a
 *                   window may declare its own seat limit)
 *   2. `hours`    — hourly windows inside the branch's operating hours
 *   3. `standard` — the default 1pm-6:30pm one-hour trial windows
 *
 * Availability itself always comes from instructor capability plus the live
 * schedule, which exist independently of any configuration.
 *
 * Seats are then refined by Live Progress: a student answering "Not Continue" or
 * "Break", or one who has ticked every meeting of their term, is on their way
 * out, so their seat is reported as opening. `seatsLeft` counts those;
 * `seatsLeftStrict` does not, and is the honest number while the leaver is still
 * turning up.
 *
 * Not modelled: instructor leave. `internal_leaves` is date-ranged and this
 * endpoint answers per weekday, so there is no date to test a range against.
 */
export async function GET(req) {
  try {
    await ensureTable('internal_operationals');
    await ensureTable('internal_live_progress');

    const { searchParams } = new URL(req.url);
    const branchFilter = searchParams.get('branch');
    const dayFilter = searchParams.get('day');
    const categoryFilter = searchParams.get('category');

    const [opsRes, instRes, classRes, progressRes, studentRes, rulesRes] = await Promise.all([
      query('SELECT * FROM internal_operationals ORDER BY branch_name, id'),
      query('SELECT name, level, branches, status FROM internal_instructors'),
      query('SELECT id, day, time, program, student, teacher, branch_name, remarks FROM internal_classes'),
      query('SELECT student_name, program_code, category, attendance, continuation FROM internal_live_progress'),
      query('SELECT name, remarks FROM internal_students'),
      query('SELECT rules FROM internal_schedule_rules WHERE id = 1')
    ]);

    // Live Progress tells us which of the occupied seats are actually finishing.
    const progressIndex = indexProgress(progressRes.rows.map((r) => ({
      studentName: r.student_name,
      programCode: r.program_code,
      category: r.category,
      attendance: r.attendance || {},
      continuation: r.continuation
    })));
    const studentIndex = indexStudents(studentRes.rows);
    const scheduleRules = rulesRes.rows[0]?.rules || null;

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
      // `ruleFor` holds raw rows, so the column is `is_open` — reading `isOpen`
      // here silently matched nothing and reported every branch as open daily.
      const configuredDays = DAY_NAMES.filter((d) => ruleFor.get(`${branchName}||${d}`)?.is_open);
      const days = (configuredDays.length ? configuredDays : DAY_NAMES)
        .filter((d) => !dayFilter || d === dayFilter);

      for (const day of days) {
        const rule = ruleFor.get(`${branchName}||${day}`);
        const plan = Array.isArray(rule?.slots) ? rule.slots : [];

        // The day's planned windows, deduplicated. A day can hold the same
        // window twice, meaning two classes run side by side; that is reported
        // once with a count rather than as identical duplicate rows.
        const byWindow = new Map();
        for (const s of plan) {
          const w = {
            start: hhmmToMin(s.start),
            end: hhmmToMin(s.end),
            type: s.type || 'any',
            label: s.label || '',
            // A planned window may cap its own seats, overriding the category
            // rule. Null means "follow the rules".
            capacity: slotCapacity(s),
            parallel: 1,
            source: 'plan'
          };
          const key = `${w.start}||${w.end}||${w.type}||${w.label}||${w.capacity}`;
          if (byWindow.has(key)) byWindow.get(key).parallel += 1;
          else byWindow.set(key, w);
        }
        const planWindows = [...byWindow.values()];
        const blocks = planWindows.filter((w) => NON_CLASS_TYPES.includes(w.type));
        const bookablePlan = planWindows.filter((w) => !NON_CLASS_TYPES.includes(w.type));

        /**
         * Candidate windows for the day.
         *
         * A plan that names actual class slots is taken as the whole answer. But
         * most days configure only the lunch break, and treating that as the
         * plan left the day with nothing bookable at all — a branch open
         * 11:00-18:30 reported one unavailable window and no trial times. So
         * when the plan holds no class slot, windows are derived from the day's
         * hours instead, with the planned blocks kept and any window colliding
         * with one dropped.
         */
        let windows;
        if (bookablePlan.length) {
          windows = planWindows;
        } else {
          const hasHours = rule?.open_time && rule?.close_time;
          const duration = categoryFilter === 'Kinder' ? 90 : 120;
          const derived = (hasHours
            ? hourlyWindows(hhmmToMin(rule.open_time), hhmmToMin(rule.close_time), duration)
            : standardTrialWindows()
          ).map((w) => ({
            ...w, type: 'any', label: '', capacity: null, parallel: 1,
            source: hasHours ? 'hours' : 'standard'
          }));
          windows = [
            ...blocks,
            ...derived.filter((d) => !blocks.some((b) => rangesOverlap(b, d)))
          ].sort((a, b) => a.start - b.start);
        }
        for (const w of windows) sourcesUsed.add(w.source);

        for (const w of windows) {
          if (w.start == null || w.end == null) continue;
          const label = `${minToHHMM(w.start)} - ${minToHHMM(w.end)}`;

          // Non-class blocks never take a student.
          if (['break', 'training', 'meeting'].includes(w.type)) {
            results.push({
              branchName, day, source: w.source,
              start: minToHHMM(w.start), end: minToHHMM(w.end),
              slotType: w.type, note: w.label,
              slotCapacity: null,
              available: false,
              reason: `Reserved for ${w.type}${w.label ? ` — ${w.label}` : ''}`,
              seats: EMPTY_SEATS, parallel: w.parallel,
              freeInstructors: [], joinableClasses: [], openingSoonClasses: [], existingSlots: []
            });
            continue;
          }

          const slotCategory = w.type === 'any'
            ? null
            : w.type.charAt(0).toUpperCase() + w.type.slice(1);

          // A typed slot can't serve a different category.
          if (categoryFilter && slotCategory && slotCategory !== categoryFilter) {
            results.push({
              branchName, day, source: w.source,
              start: minToHHMM(w.start), end: minToHHMM(w.end),
              slotType: w.type, note: w.label,
              slotCapacity: w.capacity ?? null,
              available: false,
              reason: `${slotCategory} Class slot — student is ${categoryFilter}`,
              seats: EMPTY_SEATS, parallel: w.parallel,
              freeInstructors: [], joinableClasses: [], openingSoonClasses: [], existingSlots: []
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
            // The window's own limit wins when the operator set one; otherwise
            // the class falls back to its category's configured seat rule.
            const max = w.capacity ?? maxStudentsFor(s.program, scheduleRules);
            const seats = seatsFor(s, max, progressIndex, studentIndex);
            return {
              teacher: s.teacher,
              time: s.time,
              program: s.program,
              category: seats.category ?? categorize(s.program),
              capacitySource: w.capacity != null ? 'slot' : 'rules',
              maxStudents: seats.maxStudents,
              // On paper vs actually still coming.
              studentCount: seats.enrolled,
              occupied: seats.occupied,
              releasing: seats.releasing,
              releasingStudents: seats.holders
                .filter((h) => h.releasing)
                .map((h) => ({ name: h.name, reason: h.reason })),
              seatsLeft: seats.seatsLeft,
              seatsLeftStrict: seats.seatsLeftStrict
            };
          });

          const ofWantedCategory = (e) => !wantedCategory || e.category === wantedCategory;
          // A seat free right now.
          const joinable = existing.filter((e) => e.seatsLeftStrict > 0 && ofWantedCategory(e));
          // Only free because someone is finishing or leaving.
          const openingSoon = existing.filter((e) =>
            e.seatsLeftStrict === 0 && e.seatsLeft > 0 && ofWantedCategory(e)
          );

          // Only classes a student of the wanted category could actually sit in.
          // Summing every overlapping class regardless of category produced a
          // headline capacity that answered no real question — a Junior window
          // reporting 74 seats because eight Kinder classes ran alongside it.
          const counted = existing.filter(ofWantedCategory);
          const seatsSummary = {
            classes: counted.length,
            max: counted.reduce((n, e) => n + e.maxStudents, 0),
            enrolled: counted.reduce((n, e) => n + e.studentCount, 0),
            occupied: counted.reduce((n, e) => n + e.occupied, 0),
            releasing: counted.reduce((n, e) => n + e.releasing, 0),
            left: counted.reduce((n, e) => n + e.seatsLeft, 0),
            leftStrict: counted.reduce((n, e) => n + e.seatsLeftStrict, 0)
          };

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
          } else if (free.length === 0 && joinable.length === 0 && openingSoon.length === 0) {
            available = false;
            reason = 'All qualified instructors busy and no open seats';
          } else if (free.length === 0 && joinable.length === 0) {
            // Nothing free today, but Live Progress says a seat is finishing.
            const seats = openingSoon.reduce((s, e) => s + e.seatsLeft, 0);
            const who = openingSoon
              .flatMap((e) => e.releasingStudents)
              .map((r) => `${r.name} ${r.reason}`)
              .join(', ');
            reason = `${seats} seat${seats === 1 ? '' : 's'} opening — ${who}`;
          } else if (free.length === 0) {
            const seats = joinable.reduce((s, e) => s + e.seatsLeftStrict, 0);
            reason = `Can join an existing class (${seats} seat${seats === 1 ? '' : 's'} left)`;
          } else if (slotCategory) {
            reason = `${slotCategory} Class · ${reason}`;
          }

          results.push({
            branchName, day, source: w.source,
            start: minToHHMM(w.start), end: minToHHMM(w.end),
            slotType: w.type, note: w.label,
            slotCapacity: w.capacity ?? null,
            parallel: w.parallel,
            available, reason,
            seats: seatsSummary,
            freeInstructors: free.map((i) => ({ name: i.name, level: i.level })),
            joinableClasses: joinable,
            openingSoonClasses: openingSoon,
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
      // How much of the answer leans on Live Progress rather than a free seat.
      openingSoonCount: results.filter((r) => r.openingSoonClasses?.length > 0).length,
      progressRows: progressRes.rowCount,
      data: results
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
