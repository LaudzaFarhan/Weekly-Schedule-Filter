# Requirements Document

Feature: Instructor Availability Slot Planner

## Introduction

Today, Class Operation time slots in New Operations are built blind. An admin picks a branch and a day, then types start times and durations. The only staffing check that exists (`findCapacityConflicts` in `NewOperationalsPage.jsx`) counts how many instructors are *assigned to the branch* and whether their level covers the slot category. It never looks at whether those instructors are already teaching, whether they are teaching at another branch, or whether they are on leave.
Today, Class Operation time slots in New Operations are built blind. An admin picks a branch and a day, then types start times and durations. The only staffing check that exists (`findCapacityConflicts` in `NewOperationalsPage.jsx`) counts how many instructors are *assigned to the branch* and whether their level covers the slot category. It never looks at whether those instructors are already teaching, whether they are teaching at another branch, or whether they are on leave.

This feature inverts the flow. The admin starts from **Branch → Instructor Availability**, sees who is genuinely free at each time on each day, and opens only the class types that free instructors are actually qualified to teach. Slot creation becomes a selection from what is possible, rather than a guess that may or may not be staffable.

The primary surface is a **schedule grid**: time down the left, one column per instructor, filtered by day, branch, and instructor. Occupied cells show the class and its seat occupancy; free cells are clickable to open a slot; unavailable cells say why. Each column also reports how much teaching room that instructor has left on the day.

The same availability answer must then be reused everywhere a scheduling decision is made, so the planner and the schedule form can never disagree.

### Scope

In scope:
- A shared availability engine used by every New Operations scheduling path.
- A time-by-instructor schedule grid inside Operationals (Class Operation), with day, branch, and instructor filters.
- Creating and removing Class Operation slots by clicking grid cells, including an optional intended instructor on the slot.
- Per-instructor remaining capacity for the selected day.
- Correcting the three confirmed availability gaps (no teacher-overlap check on save, cross-branch conflicts invisible, leave ignored).
- Exposing availability over the New Operations API.

Out of scope:
- Old Operations (Google Sheets) behaviour.
- Adding an "All Programs" instructor level. Instructor levels remain exactly `Kinder and Junior` and `Junior and Coder`.
- Changing the program-combination rules themselves (`src/lib/programRules.js` stays as-is; the planner consumes it).
- Per-date class instances. `internal_classes` has no date column and stays a recurring weekly pattern.

## Glossary

| Term | Meaning |
| --- | --- |
| **Slot** | An entry in a branch/day Class Operation plan: `{ type, start, end, label }`. Has no instructor. |
| **Class** | A row in `internal_classes`: branch + day + time + program + teacher + student. Recurring weekly. |
| **Capability** | Whether an instructor's `level` string covers a category (`levelCovers`). No level covers all three categories. |
| **Free** | Capable, at the branch, not teaching an overlapping class anywhere, and not on leave for the date in context. |
| **Openable type** | A slot category (Kinder / Junior / Coder) for which at least one instructor is free in a given window. |
| **Concurrency** | The number of same-time slots that can be staffed at once, solved as a bipartite matching (`maxConcurrentAssignable`). |

---

## Requirements

### Requirement 1: Single shared availability engine

**User Story:** As an operations admin, I want every part of New Operations to agree on whether an instructor is available, so that the planner, the schedule form, and the trial availability report never contradict each other.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide one module that answers instructor availability for a given instructor, branch, day, and time window, returning at minimum `{ free: boolean, reason: string }`.
2. WHEN the instructor is not assigned to the branch (neither an explicit branch match nor `All Branches`) THEN THE SYSTEM SHALL report not free with the reason identifying the branch mismatch.
3. WHEN the instructor's level does not cover the requested category THEN THE SYSTEM SHALL report not free with the reason naming the missing capability.
4. WHEN the instructor has a class in `internal_classes` on the same day whose time overlaps the window THEN THE SYSTEM SHALL report not free, naming the conflicting class time and the branch it is at.
5. THE SYSTEM SHALL evaluate the overlap check across **all branches**, not only the branch being planned.
6. WHEN a leave record in `internal_leaves` covers the date in context for that instructor THEN THE SYSTEM SHALL report not free with the reason referencing the leave.
7. WHEN no capability, branch, overlap, or leave objection applies THEN THE SYSTEM SHALL report free.
8. THE SYSTEM SHALL read only New Operations data (PostgreSQL) and SHALL NOT consult the Google Sheets branch config or `overallClasses`.
9. THE SYSTEM SHALL return a stable, machine-readable reason code alongside the human-readable reason, so callers can style or filter by cause.

---

### Requirement 2: Schedule grid — time rows by instructor columns

**User Story:** As an operations admin, I want a grid with the clock down the side and my instructors across the top, so that I can see the whole day's staffing in one view and click straight into an empty cell to open a class.

#### Acceptance Criteria

1. THE SYSTEM SHALL render a grid whose first column is time and whose remaining columns are one instructor each, for one selected day at a time.
2. THE SYSTEM SHALL show in each column header the instructor's name, their branch, and their level, with an avatar or initial marker.
3. THE SYSTEM SHALL provide a day filter as a row of day chips, showing only the days the selected branch is open, with the active day visually marked.
4. THE SYSTEM SHALL provide a branch filter that scopes the instructor columns to instructors at that branch, plus an all-branches option.
5. THE SYSTEM SHALL provide an instructor filter that narrows the grid to a single instructor, labelled with the total count when set to all (for example, `All Teachers (15)`).
6. THE SYSTEM SHALL generate time rows from the branch's operating hours via `hoursFor`, falling back to a documented default when hours are unset, and SHALL align rows to the branch's Class Operation plan start times when a plan exists.
7. WHERE a cell is occupied by an existing class, THE SYSTEM SHALL render a card showing the program, the class type, and seat occupancy as `used/capacity` with capacity from `maxStudentsFor`.
8. WHERE a cell is occupied by an existing Class Operation slot with no students yet, THE SYSTEM SHALL render it distinctly from both a filled class and an empty cell.
9. WHERE a cell is free and the instructor could take a class then, THE SYSTEM SHALL render an affordance to add a slot (for example, `+ Available Slot`).
10. WHERE a cell is unavailable, THE SYSTEM SHALL render it as non-clickable and SHALL convey the reason on hover or focus: teaching at another branch (naming that branch), break, training, meeting, on leave, or outside operating hours.
11. THE SYSTEM SHALL colour cards by slot category using the existing `SLOT_TYPES` palette (Kinder orange, Junior cyan, Coder indigo, break amber, training violet, meeting red) and SHALL NOT introduce a new palette.
12. THE SYSTEM SHALL respect the application's existing theme tokens for grid surfaces, borders, and text, so the grid matches the rest of the product in both light and dark themes.
13. WHEN the selected branch is closed on the selected day THEN THE SYSTEM SHALL state that the branch is closed rather than rendering an empty grid.
14. WHEN a branch has no instructors assigned THEN THE SYSTEM SHALL state that explicitly and SHALL render no add affordances.
15. THE SYSTEM SHALL exclude the `Default Branch` placeholder from the branch filter.
16. WHERE the number of instructor columns exceeds the viewport width, THE SYSTEM SHALL scroll horizontally while keeping the time column and the header row visible.

---

### Requirement 3: Openable class types per time window

**User Story:** As an operations admin, I want the planner to tell me which class types can be opened at each time, so that I only create slots I can actually staff.

#### Acceptance Criteria

1. THE SYSTEM SHALL compute, for each candidate time window in the selected branch/day, the set of openable categories (Kinder, Junior, Coder) based on which instructors are free and what their levels cover.
2. THE SYSTEM SHALL show, per category per window, the count of free capable instructors and their names.
3. WHEN no instructor is free and capable for a category in a window THEN THE SYSTEM SHALL show that category as not openable with the reason (for example, all capable instructors teaching, or no instructor at this branch holds that capability).
4. THE SYSTEM SHALL account for the difference in program duration when generating windows: Kinder 90 minutes, Junior and Coder 120 minutes.
5. THE SYSTEM SHALL respect existing non-class slots — a window overlapping a break, training, or meeting SHALL be shown as not openable with that block as the reason.
6. THE SYSTEM SHALL respect existing class slots already in the day's plan when computing remaining availability, so a second slot is only offered when a second instructor is free.
7. WHERE a single instructor is free for a window that could serve multiple categories, THE SYSTEM SHALL make it clear that only one of those categories can actually be opened, and SHALL NOT present them as independently available.
8. THE SYSTEM SHALL show the seat capacity that a slot of each category would carry, sourced from `maxStudentsFor` (Kinder 4, Junior 6, Coder 6 by default) rather than hardcoded values.

---

### Requirement 4: Create slots from the availability board

**User Story:** As an operations admin, I want to click an empty cell in the grid and open a class there, so that planning takes one click instead of retyping branch, day, time, and instructor.

#### Acceptance Criteria

1. WHEN the admin clicks an available cell THEN THE SYSTEM SHALL offer only the categories that cell's instructor can actually teach, per Requirement 3.
2. WHEN the admin confirms a category THEN THE SYSTEM SHALL create the slot in that branch/day plan with the cell's start time, the end time derived from the category's program duration, and the cell's instructor recorded as the intended instructor.
3. THE SYSTEM SHALL extend the Class Operation slot shape with an optional intended instructor, and SHALL treat slots saved without one as unassigned so existing plans keep working unchanged.
4. THE SYSTEM SHALL persist the new slot immediately via the existing per-day persistence path, so an unsaved row cannot be wiped by the background refresh.
5. THE SYSTEM SHALL preserve existing slots when adding, including the day's break slot.
6. WHEN the admin creates a slot THEN THE SYSTEM SHALL recompute the grid so that instructor's other cells reflect the new commitment and the remaining count updates.
7. WHEN the created slot would overlap a window the instructor is no longer free for (because of a change made since the grid rendered) THEN THE SYSTEM SHALL reject the creation and SHALL explain the conflict rather than saving it.
8. THE SYSTEM SHALL allow the admin to remove a slot from its cell in the grid, preserving break slots and persisting immediately.
9. THE SYSTEM SHALL allow selecting several available cells and creating their slots in one action.
10. THE SYSTEM SHALL support copying a completed day's grid to other open days of the same branch, preserving each target day's break.
11. THE SYSTEM SHALL record slot creation and removal in the activity log with the acting user, consistent with the existing activity logging.
12. THE SYSTEM SHALL keep the existing Quick Build and Add Slot Manually paths working, so the grid is an additional way to plan rather than a replacement.

---

### Requirement 5: Slot plans validated against real availability

**User Story:** As an operations admin, I want the capacity warning to reflect who is genuinely free, so that a plan that passes validation is a plan I can staff.

#### Acceptance Criteria

1. THE SYSTEM SHALL replace the headcount-and-capability-only capacity check with one that also excludes instructors already teaching at that time at any branch and instructors on leave.
2. WHEN a day's plan requires more concurrent instructors than are genuinely free THEN THE SYSTEM SHALL flag the affected slots and state the shortfall in terms of free instructors, not total instructors.
3. THE SYSTEM SHALL continue to block saving a day plan that has unresolved capacity conflicts.
4. WHEN a conflict is caused by a class at another branch THEN THE SYSTEM SHALL name that branch in the conflict reason.
5. WHEN a conflict is caused by leave THEN THE SYSTEM SHALL name the instructor and the leave dates.
6. THE SYSTEM SHALL keep the existing bipartite-matching approach for concurrency so that capability overlap between levels is solved correctly rather than by naive counting.

---

### Requirement 6: Leave-aware availability with a date context

**User Story:** As an operations admin, I want availability to account for leave, so that I do not plan a class for someone who will not be there.

#### Acceptance Criteria

1. THE SYSTEM SHALL let the admin choose the week (or effective date range) the availability board applies to, defaulting to the current week.
2. THE SYSTEM SHALL map the selected day name to the concrete date within the chosen week when testing leave overlap.
3. WHEN an instructor is on leave for the resolved date THEN THE SYSTEM SHALL mark them unavailable and SHALL surface the leave reason and status.
4. THE SYSTEM SHALL treat only leave records whose status indicates the leave is in force as blocking, and SHALL document which statuses block.
5. WHERE availability is consumed outside a dated context (for example, the recurring weekly Class Operation plan) THE SYSTEM SHALL make clear that leave is date-specific and SHALL indicate when a plan is affected by leave in the current week rather than silently ignoring it.

---

### Requirement 7: Schedule form cannot double-book an instructor

**User Story:** As an operations admin, I want the Add/Edit class form to stop me from assigning an instructor who is already busy, so that double bookings cannot be saved.

#### Acceptance Criteria

1. WHEN the admin saves a class whose instructor already has an overlapping class on that day at any branch THEN THE SYSTEM SHALL block the save and SHALL show the conflicting class in the error.
2. WHERE the overlapping class is the same slot the form is legitimately adding a student to (same branch, day, time, and instructor, and the programs are compatible under the Schedule Rules) THE SYSTEM SHALL allow the save.
3. WHEN editing an existing class THE SYSTEM SHALL exclude that class from its own conflict check.
4. THE SYSTEM SHALL annotate the instructor dropdown with each instructor's availability for the currently selected day, time, and branch, including the reason when unavailable.
5. THE SYSTEM SHALL keep the existing program-combination validation and SHALL present availability errors separately from program-rule errors.
6. WHEN the admin picks a recommended time THE SYSTEM SHALL use the same availability engine, so a recommended time is never one that the save step would reject.

---

### Requirement 8: Consistent availability across derived reports and the API

**User Story:** As an integrator, I want the availability answer to be reachable over the API and to match what the UI shows, so that Hermes and any other client can plan without a second implementation.

#### Acceptance Criteria

1. THE SYSTEM SHALL expose a read endpoint under `/api/new/` that returns, for a branch and day (and optional date), the instructors, their per-window availability, and the openable categories per window.
2. THE SYSTEM SHALL include the machine-readable reason codes from Requirement 1 in the response.
3. THE SYSTEM SHALL protect the endpoint with the existing `NEW_OPS_API_KEY` middleware and same-origin allowance.
4. THE SYSTEM SHALL document the endpoint in `docs/new-operations-api.md` and in `/api/new/openapi.json`.
5. THE SYSTEM SHALL make `/api/new/trial-availability` derive its availability from the shared engine, so trial counts account for cross-branch conflicts and leave.
6. THE SYSTEM SHALL keep existing endpoint defaults unchanged, so clients that send no new parameters see the same response shape they see today.

---

### Requirement 9: Non-functional expectations

**User Story:** As an operations admin, I want the availability board to be fast, honest about loading and failure, and usable without a mouse, so that I can trust it during a busy planning session.

#### Acceptance Criteria

1. THE SYSTEM SHALL compute the availability board for one branch and day without additional network round trips beyond the data New Operations pages already load (instructors, classes, operational rules, leave).
2. THE SYSTEM SHALL keep the availability board responsive at the current data scale (15 instructors, 21 classes, 42 operational rules) and SHALL degrade gracefully as data grows.
3. THE SYSTEM SHALL show a loading state until the data required for an availability verdict has arrived, and SHALL NOT render a verdict from partial data.
4. WHEN required data fails to load THEN THE SYSTEM SHALL show the failure and SHALL NOT present an optimistic "free" verdict.
5. THE SYSTEM SHALL keep every availability control reachable by keyboard and SHALL convey free/busy state by text or icon in addition to colour.

---

### Requirement 10: Remaining capacity per instructor per day

**User Story:** As an operations admin, I want to see how much teaching room each instructor has left on the selected day, so that I can spread the load instead of overloading one person.

#### Acceptance Criteria

1. THE SYSTEM SHALL show, per instructor column, how many slots that instructor is already committed to on the selected day and how many are still open to them.
2. THE SYSTEM SHALL count commitments from `internal_classes` across all branches, so a class at another branch reduces the remaining count.
3. THE SYSTEM SHALL derive the remaining count from windows where the shared availability engine reports the instructor free, rather than from a fixed per-day maximum.
4. WHERE a configured daily teaching limit exists for an instructor, THE SYSTEM SHALL cap the remaining count at that limit and SHALL indicate when the limit is the binding constraint.
5. WHEN an instructor has no remaining capacity on the selected day THEN THE SYSTEM SHALL mark that column as full and SHALL state why: fully booked, on leave, or branch closed.
6. THE SYSTEM SHALL show the instructor's committed teaching hours for the day alongside the slot counts.
7. WHEN the admin creates or removes a slot THEN THE SYSTEM SHALL update the affected instructor's remaining count without a page reload.
8. WHEN the instructor filter is set to a single instructor THEN THE SYSTEM SHALL show that instructor's remaining capacity for every open day of the branch, not only the selected day.

---

### Requirement 11: Configurable class duration

**User Story:** As an operations admin, I want to decide how long each category's classes run, and to open a longer or shorter one when a gap calls for it, so that the planner matches how we actually teach instead of a fixed 90/120 rule.

#### Acceptance Criteria

1. THE SYSTEM SHALL store a default class duration per category in the Schedule Rules, alongside `maxStudents`, and SHALL expose it for editing in the Schedule Rules panel.
2. THE SYSTEM SHALL default to Kinder 90 minutes and Junior/Coder 120 minutes, so behaviour is unchanged until an admin edits it.
3. THE SYSTEM SHALL allow more than one permitted duration per category (for example Kinder 90 or 120) and SHALL offer each permitted length when opening a class.
4. WHERE any permitted duration for a category fits the gap, THE SYSTEM SHALL treat the window as openable for that category — a 60-minute gap SHALL offer a 60-minute class when 60 is permitted.
5. WHEN the admin opens a class THE SYSTEM SHALL let them pick the length, defaulting to that category's default duration.
6. THE SYSTEM SHALL keep resizing free-form in 30-minute steps rather than restricting it to the permitted durations, and SHALL indicate when a class has been resized outside them.
7. THE SYSTEM SHALL derive duration from the rules everywhere it is currently hardcoded: the grid's openable check, the category picker, the legend, the recommended-times panel, the Add/Edit class time-slot builder, Add Slot Manually, `/api/new/workload`, and `/api/new/trial-availability`.
8. WHEN a category's default duration changes THEN THE SYSTEM SHALL NOT alter existing classes; the stored `time` string on each class remains authoritative.
9. THE SYSTEM SHALL validate a duration as a multiple of 15 minutes, at least 30 and at most 300, and SHALL reject anything else with a clear message.
10. WHERE a branch's operating hours cannot accommodate a category's shortest permitted duration on a given day, THE SYSTEM SHALL say so rather than presenting an empty time list.

---

## Implementation status

| Requirement | State | Notes |
| --- | --- | --- |
| 1 — shared availability engine | done | `src/lib/instructorAvailability.js`, with reason codes in `AVAIL` |
| 2 — schedule grid | done | `src/components/operations/ScheduleGrid.jsx` |
| 3 — openable types per window | done | Probed per category at its real length, not one fixed length |
| 4 — create slots from the grid | mostly | 4.9 multi-select and 4.10 copy-day not yet wired into the grid |
| 5 — plans validated against availability | mostly | Cross-branch teaching now counts; leave excluded by design, see 6.5 |
| 6 — leave-aware with a date context | done | Week picker on the grid; blocking statuses are everything except rejected/cancelled/declined |
| 7 — form cannot double-book | done | `validateForm` blocks it, dropdown annotated, recommended times share the engine |
| 8 — API + derived report consistency | not started | No `/api/new/availability` yet; `trial-availability` still has its own logic |
| 9 — non-functional | partial | No extra round trips; keyboard and text-plus-colour states in place |
| 10 — remaining capacity per instructor | mostly | 10.4 daily limit and 10.8 all-days view outstanding |
| 11 — configurable class duration | not started | Duration is hardcoded 90/120 in 8 places; see design.md |

## Known gaps this feature closes

Verified by reading the code, not assumed:

1. ~~`validateForm` in `src/views/NewSchedulePage.jsx` has no instructor-overlap check.~~ **Closed** — it now blocks the save and names the conflicting class.
2. ~~`freeFor` inside `recoTimes` filters conflicts with `(!branch || c.branchName === branch)`.~~ **Closed** — recommended times use the shared engine with no branch filter on conflicts.
3. ~~`internal_leaves` is never consulted by any New Operations scheduling path.~~ **Closed for the grid** — still not read by `trial-availability` (Requirement 8.5) or the Add/Edit form, which has no date context.
4. ~~`findCapacityConflicts` ignores actual bookings.~~ **Closed for cross-branch teaching** — classes at the same branch are still counted as available, because those are the realisation of the slots being validated.

## Decisions taken

1. **Class Operation slots gain an optional intended instructor** (Requirement 4.3). The grid puts every cell at the intersection of a time and an instructor, so clicking a cell inherently assigns one. Slots saved without an instructor stay valid, which keeps the 12 existing slots and the Quick Build path working.

## Open questions

1. Which leave statuses block availability? Records default to `Approved`; the set of possible statuses is not constrained in the API.
2. Should the grid offer to open the *best* category automatically when only one instructor is free, or always leave the choice to the admin (Requirement 3.7)?
3. Is there a per-instructor daily teaching limit to enforce (Requirement 10.4)? No such field exists on the instructor record today.
4. Should the grid show only one branch's instructors at a time, or all 15 across branches with the branch shown per column as in the reference design? The reference mixes branches in one view; that only makes sense with the all-branches filter option.
