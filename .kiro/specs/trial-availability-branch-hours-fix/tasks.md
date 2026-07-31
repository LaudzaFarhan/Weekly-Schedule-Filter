# Implementation Plan

## Overview

Re-anchor the New Operations Trial Availability report to each branch/day's configured
`open_time`/`close_time`, on both the page and `/api/new/trial-availability`. The order matters: the
legacy behaviour is copied into frozen fixtures first (it is the `F` that preservation checking
compares against), then exploratory tests confirm the seven hypothesised defects on unfixed code,
then the fix lands in a shared pure window-derivation module plus two extracted report modules, and
finally Property 1 (fix) and Property 2 (preservation) are checked.

## Task Dependency Graph

```
1. Test runner + frozen legacy fixtures
   ├── 1.1 Vitest + fast-check
   ├── 1.2 legacyTrialOverview   (before 4.5 edits the page)
   ├── 1.3 legacyTrialAvailability (before 4.6 edits the route)
   └── 1.4 live-like dataset fixture
        │
        ├──> 2. Property 1: Bug Condition exploration test (must FAIL)
        └──> 3. Property 2: Preservation tests (must PASS)
                 │
                 v
             4. Fix
               4.1 newOpsAnalytics.js  (no deps)
               4.2 timeUtils.js        (no deps)
               4.3 trialOverview.js         <- 4.1, 4.2
               4.4 trialAvailabilityCore.js <- 4.1
               4.5 NewTrialAvailabilityPage.jsx <- 4.3
               4.6 trial-availability/route.js  <- 4.4
               4.7 Verify Property 1 <- 4.1..4.6
               4.8 Verify Property 2 <- 4.1..4.6
                 │
                 v
             5. Checkpoint
```

```json
{
  "waves": [
    {
      "wave": 1,
      "description": "Set up the runner and freeze legacy behaviour before any source edit",
      "tasks": ["1.1", "1.2", "1.3", "1.4"]
    },
    {
      "wave": 2,
      "description": "Exploratory bug condition checking and preservation baseline on unfixed code",
      "tasks": ["2", "3"]
    },
    {
      "wave": 3,
      "description": "Shared pure derivation helpers",
      "tasks": ["4.1", "4.2"]
    },
    {
      "wave": 4,
      "description": "Extract the page and endpoint report logic into pure modules",
      "tasks": ["4.3", "4.4"]
    },
    {
      "wave": 5,
      "description": "Rewire the page and the route onto the pure modules",
      "tasks": ["4.5", "4.6"]
    },
    {
      "wave": 6,
      "description": "Fix checking and preservation checking",
      "tasks": ["4.7", "4.8"]
    },
    {
      "wave": 7,
      "description": "Checkpoint",
      "tasks": ["5"]
    }
  ]
}
```

## Tasks

- [ ] 1. Freeze legacy behaviour and set up the test runner

  - [ ] 1.1 Add Vitest and fast-check, and a single-run test script
    - Add `vitest` and `fast-check` to `devDependencies` with pinned versions
    - Add `"test": "vitest --run"` to `package.json` scripts (single run, never watch mode)
    - Add a minimal `vitest.config.js` with `environment: 'node'` and `include: ['tests/**/*.test.js']`
    - Verify `npm run test` executes and reports "no test files" cleanly before any test is written
    - _Requirements: 3.9_

  - [ ] 1.2 Copy the current page memo into `tests/fixtures/legacyTrialReport.js` as `legacyTrialOverview`
    - **MUST happen BEFORE `NewTrialAvailabilityPage.jsx` is edited** — this is `F`, the unfixed behaviour
    - Lift the current overview memo body verbatim, including `FIXED_TRIAL_SLOTS`, `workingDaysFor` (with its `days.size === 0 → all days` fallback) and the `inst.branches.includes(overviewBranch)` filter
    - Take `{ rules, instructors, classes, branch }` as arguments instead of reading React state; change nothing else
    - This fixture is frozen once written and never updated by later tasks
    - _Requirements: 1.1, 1.2, 1.3, 1.7_

  - [ ] 1.3 Copy the current route body into `tests/fixtures/legacyTrialReport.js` as `legacyTrialAvailability`
    - **MUST happen BEFORE `src/app/api/new/trial-availability/route.js` is edited**
    - Lift the current handler body verbatim, including the `ruleFor.get(...)?.isOpen` open-day read, the `configuredDays.length ? configuredDays : DAY_NAMES` fallback, the plan-before-hours precedence and the `standardTrialWindows()` else branch
    - Take `{ rules, instructors, classes, filters }` as arguments instead of querying Postgres; return the same response object
    - _Requirements: 1.4, 1.5, 1.6, 3.12_

  - [ ] 1.4 Build the live-like dataset fixture in `tests/fixtures/liveLikeData.js`
    - Rules mirroring the live database: Gading Serpong open 11:00–18:30 Monday to Friday, 10:00–17:00 Saturday, no Sunday row; Bekasi with a Sunday 08:00–16:00 row; a second branch with different hours for the branch-varies test
    - Every rule carries a `slots` plan with a 12:00–13:00 `break`, matching the live plans
    - Rows in raw snake_case shape (`is_open`, `open_time`, `close_time`, `slots`) plus a camelCase variant of the same data, so `readRule` can be exercised both ways
    - Instructors covering each level string, one with `branches: ['All Branches']`, one non-Active, one at a branch with no rules; classes including a cross-branch clash
    - _Requirements: 3.9, 3.10_

- [ ] 2. Write bug condition exploration test
  - **Property 1: Bug Condition** - Trial windows follow the branch's configured operating hours
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate each of the seven hypothesised defects
  - **Scoped PBT Approach**: The bug is deterministic and presently total, so scope the property to the concrete live-like coordinates in `tests/fixtures/liveLikeData.js` (Gading Serpong Monday/Saturday/Sunday, Bekasi Sunday, `Default Branch`) rather than generating rules freely
  - Write `tests/exploration/bugCondition.test.js` driving `legacyTrialOverview` and `legacyTrialAvailability`
  - Assert per the Bug Condition in design (`isBugCondition` = `hoursMismatch OR closedDayLeak OR phantomBranch`):
    - Page grid for Gading Serpong Monday contains a window starting at 11:00 (defect 1, Req 1.1 / 2.1)
    - Page grid for Gading Serpong Saturday contains no window ending after 17:00 (defect 1, Req 1.1 / 2.1)
    - Page grid differs between two branches with different hours (defects 1, 2, Req 1.2 / 2.2)
    - Selector source excludes `Default Branch` (defect 2, Req 1.3 / 2.3)
    - Endpoint results omit Gading Serpong Sunday entirely (defects 3, 5, Req 1.4, 1.5 / 2.4, 2.5)
    - Endpoint returns at least one `available: true` result for Gading Serpong Monday despite the blocking-only plan (defect 4, Req 1.6 / 2.6)
    - An `All Branches` instructor is counted at a named branch on the page fixture — and confirm the route fixture already passes this, proving it is page-only (defect 6, Req 1.7 / 2.7)
    - An instructor at a branch with no rules yields closed cells, not seven open days (defect 7, Req 1.5 / 2.5)
  - Run test on UNFIXED code with `npm run test`
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: identical page rows across branches and days, Sunday emitted and available, `source: 'plan'` with `availableCount: 0` on every configured day
  - **If any assertion unexpectedly PASSES**, that root cause is refuted — re-hypothesise before touching any source file
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [ ] 3. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Verdicts, reasons and response shape are unchanged
  - **IMPORTANT**: Follow observation-first methodology — record what the legacy fixtures actually return, then assert that
  - Write `tests/preservation/trialReport.test.js` using fast-check generators over instructors, classes and slot plans
  - Observe on UNFIXED code via `legacyTrialOverview` / `legacyTrialAvailability` and capture:
    - The ten row labels for a branch open exactly 13:00–18:30 (`¬C(X)`), `1.00 - 2.00 pm` through `5.30 - 6.30 pm`, and their per-cell counts (Req 3.1)
    - The `Teaching [Branch] Program (time)` reason text for a class clash at another branch (Req 3.2)
    - Level gating outcomes: "Kinder and Junior" absent from Coder counts, "Junior and Coder" absent from Kinder counts, no level in all three (Req 3.3)
    - Seat capacity 4 for Kinder, 6 for Junior/Coder, and the joinable-class filter (seats left AND category match) (Req 3.4, 3.5)
    - The `Reserved for {type} — {label}` reason for a window overlapping a break, training or meeting (Req 3.6)
    - The category-mismatch reason on a typed slot (Req 3.7)
    - Non-Active instructors excluded from every count (Req 3.10)
    - The exact key sets of the response envelope (`filters`, `windowSources`, `configuredRules`, `total`, `availableCount`, `data`) and of each result object (`source`, `start`, `end`, `slotType`, `note`, `available`, `reason`, `freeInstructors`, `joinableClasses`, `existingSlots`) (Req 3.12)
  - Write the properties in the two quantifications Property 2 requires:
    - Grid equality on `¬C(X)`: for a branch open exactly 13:00–18:30 on every day, fixed page rows equal legacy page rows
    - Window-wise equality on the intersection: for every window in both grids at an open branch/day, verdict, reason text, free list and unavailable list are equal (Req 3.8)
  - Add a static guard that `src/views/TrialPriorityPage.jsx` imports nothing from the new modules and its own fixed grid is unchanged (Req 3.13)
  - Run tests on UNFIXED code (assert against the legacy fixtures on both sides for now)
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.10, 3.12, 3.13_

- [ ] 4. Fix for trial availability ignoring branch operating hours

  - [ ] 4.1 Add the shared window derivation to `src/lib/newOpsAnalytics.js`
    - Add `trialWindowsFromHours(openMin, closeMin, { duration = 60, step = 30 })`: windows for `start = openMin; start + duration <= closeMin; start += step`; `[]` when either bound is null or the span is shorter than `duration`
    - Re-express `standardTrialWindows()` as `trialWindowsFromHours(13 * 60, 18 * 60 + 30)` — element-for-element equal to the current loop, so Req 3.1 holds by construction
    - Add `readRule(row)` returning `{ isOpen, openMin, closeMin, slots }`, reading `row.is_open ?? row.isOpen`, `row.open_time ?? row.openTime`, `row.close_time ?? row.closeTime` (fixes defect 3)
    - Add `trialWindowGridFor(row)` with the precedence: missing row or `isOpen === false` → `{ source: 'closed', windows: [] }`; hours present → `{ source: 'hours', windows: trialWindowsFromHours(...) }` **before any plan check** (fixes defect 4); else non-empty plan → `{ source: 'plan', windows: planWindows }`; else → `{ source: 'standard', windows: standardTrialWindows() }`
    - Leave `hourlyWindows` in place, unused by the trial route
    - Add unit tests: 11:00–18:30 → 14 windows, 10:00–17:00 → 13, 13:00–18:30 → the ten standard windows, 08:00–16:00 → 15, a 30-minute span → none, null bounds → none; `readRule` on snake_case / camelCase / null / `is_open: false`; `trialWindowGridFor` for each of the four sources
    - _Bug_Condition: isBugCondition(X) — hoursMismatch and closedDayLeak_
    - _Expected_Behavior: 60-minute windows stepping 30 minutes inside [open_time, close_time]; empty grid when closed or unruled_
    - _Preservation: standardTrialWindows() output unchanged (Req 3.1)_
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 3.1_

  - [ ] 4.2 Add `formatTrialWindowLabel(startMin, endMin)` to `src/utils/timeUtils.js`
    - Reproduce the page's label style: `1.00 - 2.00 pm` when both ends share a meridiem, `11.00 am - 12.00 pm` when they do not, `10.00 - 11.00 am` in the morning
    - Must reproduce the ten `FIXED_TRIAL_SLOTS` labels exactly, and every generated label must round-trip through the existing `parseTimeSlot`
    - Do not touch `parseTimeSlot`, `doTimeSlotsOverlap` or `generateTrialSlots`
    - Add a property test: `parseTimeSlot(formatTrialWindowLabel(w.start, w.end))` equals `{ start: w.start, end: w.end }` for every window the fixed grid can produce
    - _Bug_Condition: isBugCondition(X) — hoursMismatch produces labels outside 13:00–18:30_
    - _Expected_Behavior: labels for hours-derived windows parse back to the same minute range_
    - _Preservation: the ten standard labels are byte-identical (Req 3.1); class-overlap reasons keep working (Req 3.2)_
    - _Requirements: 2.1, 3.1, 3.2_

  - [ ] 4.3 Create the pure page report module `src/lib/trialOverview.js`
    - Add `buildTrialOverview({ rules, instructors, classes, branch })` — the page memo lifted out of React, now hours-aware
    - Rows: union of `trialWindowGridFor(rule).windows` over the rules in scope (selected branch, or all branches when `branch === 'all'`), sorted by start and de-duplicated on `start-end`, labelled with `formatTrialWindowLabel`
    - Per cell: missing or closed rule → `closed: true` with the existing `Branch closed` reason; a window outside that day's hours → the same; otherwise evaluate instructors exactly as today (Active only, class-overlap reason built from `busy.branchName`, `busy.program`, `busy.time`)
    - Branch scope: `inst.branches.includes(branch) || inst.branches.includes('All Branches')`, matching the endpoint's `staffAt` (fixes defect 6)
    - Working days come from the rules only — remove the `days.size === 0 → all days` fallback (fixes defect 7)
    - Move level counting (`canKinder`/`canJunior`/`canCoder`) and the empty-cell reason strings (`No instructors`, `All N teaching`, `N teaching, M closed`) across unchanged
    - Keep ignoring the slot plan on this surface, per the agreed scope
    - _Bug_Condition: isBugCondition(X) — all three disjuncts on the page surface_
    - _Expected_Behavior: rows derived from open_time/close_time per branch/day; closed days show closed_
    - _Preservation: Preservation Requirements Req 3.1, 3.2, 3.3, 3.9, 3.10, 3.11_
    - _Requirements: 2.1, 2.2, 2.5, 2.7, 3.1, 3.2, 3.3, 3.6, 3.9, 3.10, 3.11_

  - [ ] 4.4 Create the pure endpoint core `src/lib/trialAvailabilityCore.js`
    - Add `buildTrialAvailability({ rules, instructors, classes, filters })` — the route body with the I/O removed, returning the same response object
    - Days: `DAY_NAMES.filter((d) => readRule(ruleFor(branch, d)).isOpen)`, with no all-seven-days fallback (fixes defects 3 and 5)
    - Windows from `trialWindowGridFor(rule)`; `source: 'closed'` contributes no results for that branch/day
    - Plan overlay on the hours-derived grid: for each window find overlapping plan slots via the existing `rangesOverlap`; a `break`, `training` or `meeting` overlap yields the current `Reserved for {type}{ — label}` result carrying the slot's own type and label; otherwise a typed class slot supplies `slotType` for the category-mismatch check and the `{Category} Class · …` reason prefix — both strings produced by the same expressions as today
    - Move `bookedSlots`, `parseSlotLabel`, `levelCovers`, `maxStudentsForProgram`, the joinable-class filter, the verdict ladder, the sort and the `filters`/`windowSources`/`configuredRules`/`total`/`availableCount` envelope across unchanged
    - Add envelope invariant tests: `total === data.length`, `availableCount === data.filter(r => r.available).length`, `windowSources ⊆ {plan, hours, standard}`, and no result on a day the branch is not open
    - Note the two documented consequences: `source` becomes `hours` where a rule has both hours and a plan (Req 2.6), and a rule-less deployment returns `data: []` (Req 2.5)
    - _Bug_Condition: isBugCondition(X) — hoursMismatch and closedDayLeak on the endpoint surface_
    - _Expected_Behavior: only configured open days emitted; grid from hours; no windows when closed or unruled_
    - _Preservation: Preservation Requirements Req 3.5, 3.6, 3.7, 3.8, 3.12_
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7, 3.5, 3.6, 3.7, 3.8, 3.12_

  - [ ] 4.5 Rewire `src/views/NewTrialAvailabilityPage.jsx`
    - Delete `FIXED_TRIAL_SLOTS` and call `buildTrialOverview` in the memo, keyed on rules, instructors, classes and the selected branch
    - Feed the branch selector from `useNewOperationals().branchNames` instead of `useSchedule().branches`, dropping the `useSchedule` dependency so `Default Branch` can no longer appear (fixes defect 2)
    - Take `rules` and `loading` from the hook; render the existing "Branch closed" treatment for closed cells
    - Keep the dialog, legend, chips and table markup exactly as they are
    - _Bug_Condition: isBugCondition(X) — hoursMismatch, closedDayLeak, phantomBranch_
    - _Expected_Behavior: rows recompute per selected branch; only New Operations branches listed_
    - _Preservation: Preservation Requirements Req 3.9, 3.11_
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.7, 3.9, 3.11_

  - [ ] 4.6 Reduce `src/app/api/new/trial-availability/route.js` to I/O plus the core
    - Keep `ensureTable`, the three queries, the existing try/catch and 500 shape
    - Call `buildTrialAvailability({ rules, instructors, classes, filters })` and return `NextResponse.json(...)`
    - Reword the `configuredRules === 0` note to say no rules are configured so no windows can be reported, instead of claiming standard windows were used
    - Do not touch `src/views/TrialPriorityPage.jsx`, `src/hooks/useNewOperationals.js`, `src/app/api/new/operationals/route.js`, `/api/slots`, `/api/crm` or `src/utils/constants.js`
    - _Bug_Condition: isBugCondition(X) — closedDayLeak via the all-seven-days fallback_
    - _Expected_Behavior: endpoint response derived entirely from buildTrialAvailability_
    - _Preservation: Preservation Requirements Req 3.12, 3.13_
    - _Requirements: 2.4, 2.5, 3.12, 3.13_

  - [ ] 4.7 Verify bug condition exploration test now passes
    - **Property 1: Bug Condition** - Trial windows follow the branch's configured operating hours
    - **IMPORTANT**: Re-run the SAME test from task 2 - do NOT write a new test
    - Repoint its assertions from the legacy fixtures to `buildTrialOverview` / `buildTrialAvailability` and `trialWindowGridFor`; the assertions themselves stay as written
    - Then broaden to the full property with fast-check: generate rules over arbitrary half-hour open/close pairs (including spans too narrow for one window), `is_open` both ways, absent days, and branch names outside the rule set — assert every window is 60 minutes, inside `[openMin, closeMin]`, spaced 30 minutes, the earliest starting exactly at `openMin`, and an empty grid for closed, unruled or unknown branch/days
    - Run with `npm run test`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ] 4.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Verdicts, reasons and response shape are unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 3 - do NOT write new tests
    - Point the fixed side at the new modules and keep the legacy fixtures as the reference: grid equality on `¬C(X)` (a branch open exactly 13:00–18:30), plus verdict, reason, free list, unavailable list and key-set equality on the intersection of the old and new grids
    - Confirm the `TrialPriorityPage.jsx` guard still holds
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13_

- [ ] 5. Checkpoint - Ensure all tests pass
  - Run `npm run test` and `npm run lint`; both clean
  - Confirm Gading Serpong reports 14 windows Monday to Friday, 13 on Saturday and none on Sunday, with the 12:00–13:00 break window unavailable for the documented reason
  - Confirm the two documented consequences of the fix are present and intentional: `source: 'hours'` where a rule has both hours and a plan, and `data: []` when no rules are configured
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks 1.2 and 1.3 must be completed before any edit to `NewTrialAvailabilityPage.jsx` or
  `src/app/api/new/trial-availability/route.js`. Once written, the fixtures in
  `tests/fixtures/legacyTrialReport.js` are frozen and never updated.
- Task 2 is expected to FAIL on unfixed code. Do not fix the test or the source when it fails —
  record the counterexamples. If an assertion unexpectedly passes, that hypothesised root cause is
  refuted and needs re-hypothesising before the fix proceeds.
- Task 3 is expected to PASS on unfixed code. It captures the baseline to preserve.
- Tasks 4.7 and 4.8 re-run the tests from tasks 2 and 3 against the fixed modules. No new tests.
- Use `npm run test` (`vitest --run`) — never watch mode.
- Out of scope and not to be touched: `src/views/TrialPriorityPage.jsx` (Req 3.13),
  `src/hooks/useNewOperationals.js`, `src/app/api/new/operationals/route.js`, `/api/slots`,
  `/api/crm`, `src/utils/constants.js`. This fix is read-side only.
