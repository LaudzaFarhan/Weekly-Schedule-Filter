# Design Document

Feature: Instructor Availability Slot Planner

## Overview

The planner turns slot creation from "type a time and hope someone can teach it" into "pick from what is genuinely possible". It rests on one idea: a **single availability engine** that every scheduling path consults, so the grid, the Add/Edit form and the recommended-times panel can never disagree.

Most of the feature is built. This document records the architecture as implemented, then designs the two outstanding pieces: configurable class duration (Requirement 11) and the availability API (Requirement 8).

## Architecture

```
                    ┌──────────────────────────────┐
                    │  lib/instructorAvailability  │  the engine
                    │  availabilityFor(inst, ctx)  │
                    │  → { free, code, reason }    │
                    └──────────────┬───────────────┘
                                   │
        ┌──────────────────┬───────┴────────┬──────────────────────┐
        │                  │                │                      │
  ScheduleGrid      NewSchedulePage   NewOperationalsPage    /api/new/* (planned)
  (cells, move,     (validateForm,    (findCapacity-         (availability,
   resize, roster)   recoTimes,        Conflicts)             trial-availability)
                     dropdown)
```

### Why one engine

Before it existed, four places each had a partial answer: the capacity check counted heads without looking at bookings, the schedule form checked nothing at all, the recommended-times panel ignored classes at other branches, and nothing anywhere read leave. Any fix applied to one left the others wrong. Centralising it means a verdict is computed once and the same refusal text reaches the user wherever they hit it.

### Layers

| Layer | File | Responsibility |
| --- | --- | --- |
| Engine | `src/lib/instructorAvailability.js` | Availability verdicts, reason codes, class grouping, time parsing |
| Slot vocabulary | `src/lib/slotTypes.js` | Slot kinds, colours, categories, durations |
| Combination rules | `src/lib/programRules.js` | Which programs may share a slot, seat capacity |
| Grid UI | `src/components/operations/ScheduleGrid.jsx` | Presentation and interaction only |
| Grid data | `src/components/operations/ScheduleGridPanel.jsx` | Subscriptions, derived branch rules, all writes |
| Branch rules | `src/hooks/useNewOperationals.js` | Operating hours, open days, slot plans, `applyLocal` |

`ScheduleGrid` holds no data of its own. That split is what let the grid move from Operationals to the Schedule page without duplicating logic.

## Components and Interfaces

### The availability verdict

```js
availabilityFor(instructor, {
  branchName, day, startMin, endMin, category,
  classGroups, leaves, date, blocks, hours, plannedSlots, requireBranch,
}) // → { free: boolean, code: AVAIL.*, reason: string, conflict: object|null }
```

Checks run in a deliberate order, cheapest and most fundamental first:

1. **Outside operating hours** — the window doesn't fit the branch's day
2. **Not at this branch** — no explicit branch match nor `All Branches`
3. **No capability** — level doesn't cover the category
4. **On leave** — only when a date is supplied
5. **Already teaching** — across *all* branches, distinguishing `TEACHING` from `TEACHING_ELSEWHERE`
6. **Held by a planned slot** for this instructor
7. **Branch-wide blocked time** — break, training, meeting

Reason codes (`AVAIL.*`) are stable so callers can style or filter by cause without string matching.

### Two-stage cell evaluation

A single fixed probe length was wrong: it reported whichever obstacle it hit first, so a class two hours away read as "Teaching" right now. Cells are therefore evaluated in two stages:

1. **Gate** — can this instructor be here at all? Probe the shortest possible session (30 min). A refusal here is genuine: leave, closed, wrong branch, actually occupied.
2. **Window** — how long until their next commitment? `nextObstacleAfter()` returns the earliest of the next block, planned slot, class, or closing time.

The gap then decides the cell state:

| Cell | Condition |
| --- | --- |
| `free` | at least one permitted category duration fits the gap |
| `short` | gap ≥ 30 min but no class fits — still usable for a session |
| `unavailable` | the gate refused |

This is why a 60-minute gap before a break reads "60 min free" and stays clickable, rather than pretending to be a dead end.

### Grid layout

Rows step every 30 minutes (`STEP`), which divides both 90 and 120. Occupied windows claim a `rowSpan` so a card renders once at its true height. The invariant — spans must tile each column exactly — is what keeps the table from misaligning, and it holds by construction because `spanFor()` never counts past the row array.

### Data model

Two additions were needed, both shaped by a constraint discovered at runtime: **the application's database user does not own the original tables**, so `ALTER TABLE` is refused.

| Need | Where it went | Why |
| --- | --- | --- |
| Intended instructor on a slot | new optional `instructor` key inside the existing `slots` JSONB | JSONB needs no DDL |
| Replacement attendance dates | new table `internal_class_sessions (class_id, session_date)` | `ALTER internal_classes` is refused |

Both are additive. Slots without an instructor stay valid; classes without dates are Regulars attending weekly.

## Data Models

### Slot — inside `internal_operationals.slots` (JSONB array)

```js
{
  type: 'kinder'|'junior'|'coder'|'any'|'break'|'training'|'meeting',
  start: '13:00',            // 24h HH:MM
  end:   '14:30',
  label: '',                 // optional note
  instructor: 'Risa',        // optional; absent means unassigned
}
```

`instructor` is permitted on class kinds plus `training` and `meeting` (which then block only that person's column). It is rejected on `break`, which applies to the whole branch.

### Class — `internal_classes`, one row per enrolled student

```js
{
  id, day: 'Tuesday', time: '1.00 pm - 2.30 pm',
  program: 'K1.1', student: 'Risa Putri', teacher: 'Risa',
  branchName: 'Bekasi', classType: 'Regular'|'Replacement'|'Trial',
  remarks, sessionDates: ['2026-08-04', ...],   // from the companion table
}
```

`time` is authoritative for a class's length. Duration is read *from* it via `classWindow()`, never recomputed from the category — which is what protects existing classes when a default changes.

### Attendance — `internal_class_sessions`

```sql
class_id INTEGER, session_date DATE, UNIQUE (class_id, session_date)
```

A Regular has no rows and attends weekly. A Replacement or Trial has one row per date attended.

### Class group — derived, never stored

`groupClasses()` collapses rows sharing branch + day + time + teacher into one class with `members[]`, `startMin`, `endMin`. Seat occupancy is the member count, so occupancy is per-week once replacements are considered.

### Schedule rules — `internal_schedule_rules`, single row

```js
{
  allowMixCategories: false,
  Kinder: { allowMixFamilies: false, maxDistinctLessons: 2, maxStudents: 4,
            enforcement: 'block', durationMin: 90,  durationOptions: [90, 120] },
  Junior: { allowMixFamilies: true,  maxDistinctLessons: 2, maxStudents: 6,
            enforcement: 'block', durationMin: 120, durationOptions: [90, 120] },
  Coder:  { allowMixFamilies: true,  maxDistinctLessons: 0, maxStudents: 6,
            enforcement: 'block', durationMin: 120, durationOptions: [90, 120, 150] },
}
```

`durationMin` and `durationOptions` are the Requirement 11 additions. `withDefaults()` merges stored values over the defaults, so a row saved before this change gains the new keys automatically.

## Correctness Properties

Properties that must hold regardless of data, and how each is checked.

### Property 1: Span tiling

For every instructor column, the sum of cell spans equals the row count, and each cell starts where the previous one ended. A violation misaligns the entire table. *Verified across all 90 live branch/day/instructor columns, 97 multi-row cards, zero gaps or overlaps.*

**Validates: Requirements 2.7, 2.8, 2.9**

### Property 2: Time-label round-trip

`classWindow(slotLabelFor(s, e))` returns `{ s, e }` for every window the UI can produce, and `slotLabelFor` regenerates any stored label byte-identically. A violation silently orphans student rows from their class. *Verified against all 8 stored formats and 8 generated windows.*

**Validates: Requirements 4.2, 7.2**

### Property 3: Grouping stability

Rewriting a class's `time` moves the whole group together: group count unchanged, member count preserved. *Verified — a 2-student group stayed one group after a rewrite.*

**Validates: Requirements 4.11, 7.2**

### Property 4: Self-exclusion

A card being moved or resized never blocks itself. The engine is always called with that card excluded from `classGroups` or `plannedSlots`.

**Validates: Requirements 4.7**

### Property 5: No level covers all three categories

Instructor levels are only `Kinder and Junior` and `Junior and Coder`, so `categoriesFor()` returns at most two. *Verified: 0 of 15 instructors cover all three.*

**Validates: Requirements 1.3, 3.1, 3.7**

### Property 6: A locked program list is never empty

Every student level maps to at least one program code, so restricting the program dropdown to a student's category can never trap them with no option. *Verified: 35/35 students, 6 distinct levels.*

**Validates: Requirements 7.5**

### Property 7: Regulars carry no dates

`normaliseSessionDates` drops dates when `classType` is `Regular`, so a fixed weekly place can never be accidentally date-limited.

**Validates: Requirements 6.5**

### Property 8: Duration monotonicity

If a window is openable at duration *d*, it is openable at every permitted duration shorter than *d*. This is what makes "any permitted option fits" a sound openable test rather than an optimistic one.

**Validates: Requirements 11.3, 11.4**

### Property 9: Defaults are inert

Changing a category's default duration alters no existing class, because duration is read from each class's stored `time` label and never recomputed from its category.

**Validates: Requirements 11.8**

## Design: configurable class duration (Requirement 11)

### The problem

Duration is hardcoded `Kinder 90 : else 120` in eight places:

`slotTypes.durationForCategory`, `NewSchedulePage.programDurationMin`, `NewSchedulePage.recoTimes`, `NewOperationalsPage.changeMaType`, `NewOperationalsPage.changeMaStart`, `NewHomePage.durationFor`, `newOpsAnalytics.programDurationMin`, `trial-availability` route.

Eight copies of one policy is why a "flexible 90 minutes or more" change is currently an eight-file edit.

### Where the setting belongs

`internal_schedule_rules` already holds per-category policy — `maxStudents`, `allowMixFamilies`, `maxDistinctLessons`, `enforcement`. Duration is the same kind of thing, so it goes there. No new table, no migration, and `withDefaults()` already merges stored values over defaults so old rows keep working.

```js
// DEFAULT_RULES in src/lib/programRules.js
Kinder: { ..., durationMin: 90,  durationOptions: [90, 120] },
Junior: { ..., durationMin: 120, durationOptions: [90, 120] },
Coder:  { ..., durationMin: 120, durationOptions: [90, 120, 150] },
```

`durationMin` is the default offered; `durationOptions` is the set an admin may pick from when opening a class. Keeping them separate means the common case stays one click while the flexible case stays possible.

### New accessors

```js
// src/lib/programRules.js
durationFor(category, rules)        // → number, the default
durationOptionsFor(category, rules) // → number[], ascending, always includes the default
```

Both mirror the existing `maxStudentsFor(program, rules)`, which already reads the same rule set — so callers that have `rules` in hand need no new plumbing.

`slotTypes.durationForCategory` becomes a thin deprecated wrapper returning the built-in default, kept only so a caller without access to `rules` (the legend, for instance) still renders. Everything that can pass `rules` must.

### Effects on the grid

- **Openable check** — a category is openable when *any* of its `durationOptions` fits the gap, not only the default. A 60-minute gap offers a 60-minute Kinder class if 60 is permitted.
- **Picker** — each category row gains a length selector, defaulting to `durationFor`, listing only options that actually fit the gap and pass `canOccupy` at that length.
- **Legend** — shows the configured default per category rather than a literal `90m`.
- **Resize** — unchanged and deliberately unconstrained: free-form in 30-minute steps up to `resizeLimit`. Requirement 11.6 asks only that a class resized outside the permitted set be *indicated*, not blocked, because real days need exceptions.

### Effects elsewhere

| Caller | Change |
| --- | --- |
| `NewSchedulePage.buildTimeSlot` | takes `rules`; drives the Add/Edit time string |
| `NewSchedulePage.recoTimes` | generates windows per permitted duration, not one fixed length |
| `NewOperationalsPage` manual add | seeds end time from `durationFor` |
| `NewHomePage`, `newOpsAnalytics` | read the configured default |
| `trial-availability` | reads the rules rather than `category === 'Kinder' ? 90 : 120` |

### Validation

Server-side in the `schedule-rules` PUT, mirroring the existing `maxStudents` check: multiple of 15, between 30 and 300. `durationOptions` entries validated the same way, deduplicated and sorted, with the default forced into the set so a category can never offer nothing.

### What must not change

Existing classes keep their stored `time` string — that remains authoritative. Changing a default must never retroactively move a class, so nothing recomputes duration from a class's category; duration is read *from* the stored label via `classWindow()`.

## Design: availability API (Requirement 8)

`GET /api/new/availability?branch=&day=&date=` returns instructors, per-window verdicts and openable categories, reusing the engine server-side. Two reasons this matters beyond Hermes:

1. `trial-availability` still has its own availability logic and so cannot see cross-branch conflicts or leave.
2. At scale the browser should not receive the whole dataset to compute availability locally. Measured today at **278 bytes per class row**, 200,000 rows is a ~56 MB response — the grid's client-side scan is the thing that breaks first, well before the database notices.

Protected by the existing `NEW_OPS_API_KEY` middleware, documented in `openapi.json` and `docs/new-operations-api.md`.

## Error Handling

| Situation | Behaviour |
| --- | --- |
| Required data still loading | Loading state; never a verdict from partial data |
| Data failed to load | Show the failure; never an optimistic "free" |
| Branch closed / no instructors | Explicit message, no add affordances |
| Slot write rejected | Toast with the server's message; local state untouched |
| Destination no longer free | Reject the move and explain, rather than saving a conflict |
| Companion table unreachable | Classes still list, with empty attendance dates |

Non-class slots carrying an instructor are rejected by the API for `break`, since a break belongs to the whole branch.

## Testing Strategy

Verification has been by assertion against live data through temporary server routes, then removing them. This suited a feature whose correctness depends on real branch rules, real levels and real bookings.

| What | Result |
| --- | --- |
| Engine verdicts | 16/16 — including cross-branch, capability, leave statuses, hours, blocks |
| Form double-booking | 9/9 — including joining a slot vs splitting one |
| Grid `rowSpan` tiling | 90/90 columns tile exactly, 97 multi-row cards |
| Class time round-trip | 8/8 stored formats regenerate byte-identically |
| Roster round-trip | Replacement dates persist; retag to Regular clears them |
| Student level mapping | 35/35 students map to a program, none unmapped |

For duration, the cases that matter are: a gap shorter than the default but long enough for a permitted option; a category whose default no longer fits its branch hours; and an existing class keeping its length after its category default changes.

## Open Decisions

1. Should `durationOptions` be per category, or a single global set of permitted lengths? Per category is designed above; global is simpler to explain if in practice every category allows the same lengths.
2. Which leave statuses block? Currently everything except rejected/cancelled/declined.
3. Is there a per-instructor daily teaching limit (Requirement 10.4)? No such field exists on the instructor record.
4. Should the grid auto-pick the only openable category when just one instructor is free (Requirement 3.7)?
