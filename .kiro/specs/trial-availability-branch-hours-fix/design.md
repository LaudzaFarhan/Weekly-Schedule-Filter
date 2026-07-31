# Trial Availability Branch Hours Bugfix Design

## Overview

The New Operations Trial Availability report answers one question — when can this branch still take
a trial student — in two places: the page (`src/views/NewTrialAvailabilityPage.jsx`) and the
endpoint (`src/app/api/new/trial-availability/route.js`). Neither derives its window grid from the
branch's configured operating hours today. The page renders a module-level constant
(`FIXED_TRIAL_SLOTS`, ten 60-minute windows from 13:00 to 18:30) for every branch and every day.
The endpoint reads the open flag under a key its Postgres rows do not carry (`row.isOpen` on a
`SELECT *` row whose column is `is_open`), so its configured-open-day list is always empty and it
emits all seven days; and it prefers the slot plan over operating hours whenever a plan exists, so
the live plans — each carrying a 12:00–13:00 break and little else — leave it reporting only
blocked windows.

The fix re-anchors both surfaces to one derivation: a branch/day's `open_time` and `close_time`
produce 60-minute windows stepping every 30 minutes, and a branch/day with no rule or a rule marked
closed produces no bookable window at all. The window grid becomes a single shared pure function so
the page and the endpoint cannot drift apart again, the page's branch selector is fed from
PostgreSQL instead of the Old Operations Sheets config, and the endpoint's rule reads go through a
normaliser that accepts either the raw snake_case row or the camelCase mapped row.

Per the scope note in the requirements, the page still ignores the slot plan. The endpoint keeps its
plan awareness, but as an overlay on the hours-derived grid rather than as the grid itself. The Old
Operations Trial Priority page (`src/views/TrialPriorityPage.jsx`) has its own copy of the fixed
grid and is explicitly out of scope — it must not be touched.

## Glossary

- **Bug_Condition (C)**: The branch/day coordinates where the report is wrong — open with hours
  other than 13:00–18:30, closed or unruled yet still offering windows, or not a New Operations
  branch at all.
- **Property (P)**: The desired outcome for those coordinates — windows derived from `open_time`
  and `close_time`, or no windows when the branch/day is not open.
- **Preservation**: Everything the report already gets right — per-window verdicts, reason text,
  level gating, seat capacity, the endpoint's response shape, the Old Operations page.
- **Window**: A candidate 60-minute trial booking slot, held internally as
  `{ start, end }` in minutes from midnight.
- **Window grid**: The ordered set of windows a branch/day offers. The page renders it as table
  rows; the endpoint emits one result object per window.
- **Operational rule**: One row of `internal_operationals` — `(branch_name, day)` unique, carrying
  `is_open`, `open_time`, `close_time` and a `slots` JSONB plan.
- **Slot plan**: The `slots` array on a rule. Slot types are `kinder | junior | coder | any |
  break | training | meeting`; the last three are blocking.
- **`NewTrialAvailabilityPage`**: The New Operations page in `src/views/NewTrialAvailabilityPage.jsx`
  that renders the weekly grid and the per-cell instructor dialog.
- **`GET /api/new/trial-availability`**: The endpoint in
  `src/app/api/new/trial-availability/route.js` that reports the same information as JSON.
- **`useNewOperationals`**: The hook in `src/hooks/useNewOperationals.js` that polls
  `/api/new/operationals` and exposes `branchNames`, `openDaysFor`, `hoursFor`, `slotsFor`,
  `ruleFor` over the camelCase mapped rows.
- **Window source**: The endpoint's `source` field on each result, reporting where the grid came
  from: `plan`, `hours` or `standard`.

## Bug Details

### Bug Condition

The bug manifests at any branch/day coordinate the report evaluates. Three disjuncts cover it: the
branch is open on hours the fixed grid does not match, the branch is closed (or has no rule) yet
windows are still offered, or the branch is not a New Operations branch and should never have been
offered in the selector at all.

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X = { branch, day }
  OUTPUT: boolean

  rule ← operationalRuleFor(X.branch, X.day)     // internal_operationals

  hoursMismatch  ← rule ≠ NULL
                   AND isOpen(rule) = TRUE
                   AND (hhmmToMin(rule.open_time) ≠ 13*60
                        OR hhmmToMin(rule.close_time) ≠ 18*60 + 30)

  closedDayLeak  ← rule = NULL OR isOpen(rule) = FALSE

  phantomBranch  ← X.branch ∉ newOpsBranchNames()

  RETURN hoursMismatch OR closedDayLeak OR phantomBranch
END FUNCTION
```

`¬isBugCondition(X)` holds only for a branch/day that is open with hours exactly 13:00–18:30. Every
branch/day in the live database satisfies `hoursMismatch` — weekdays run 11:00–18:30, Saturday
10:00–17:00, Sunday (Bekasi and Bintaro only) 08:00–16:00 — so the bug is presently total.

### Examples

- **Gading Serpong, Monday** (rule open, 11:00–18:30). Expected 11:00–12:00 through 17:30–18:30
  (14 windows). Page renders 13:00–14:00 through 17:30–18:30 — the 11:00 and 12:00 windows are
  missing. Endpoint takes the `plan` branch, and because the plan is only a 12:00–13:00 break plus
  blocking entries it returns 11 windows, every one `available: false`.
- **Gading Serpong, Saturday** (rule open, 10:00–17:00). Expected 10:00–11:00 through 16:00–17:00.
  Page renders 13:00–18:30, so it offers 17:00–18:00 and 17:30–18:30 after the branch has closed
  and hides the whole 10:00–13:00 morning.
- **Gading Serpong, Sunday** (no rule — the branch is shut). Expected no bookable window and a
  "Branch closed" cell. Endpoint reports 10 windows, all `available: true`; the page renders the
  same ten rows as every other day.
- **Branch selector.** Expected the seven New Operations branches from PostgreSQL. Renders the Old
  Operations Sheets list, which includes `Default Branch` (`DEFAULT_BRANCHES` in
  `src/contexts/ScheduleContext.jsx`) — a branch with no rule, no instructor and no class, so
  selecting it yields an all-zero grid.
- **Instructor on "All Branches", branch selected.** Expected to be counted at the selected branch.
  The page drops them, because the filter tests `inst.branches.includes(overviewBranch)` only. The
  endpoint's `staffAt` already handles this correctly, so this is a page-only defect.
- **Edge case — a branch/day open exactly 13:00–18:30.** `¬C(X)`. The fixed grid happens to be
  right; the page must render the same ten rows with the same counts after the fix.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A branch/day open exactly 13:00–18:30 renders the same ten page rows, `1.00 - 2.00 pm` through
  `5.30 - 6.30 pm`, with the same counts (Req 3.1).
- An instructor teaching a class overlapping a window stays unavailable for it, with the same
  reason text naming program, time and originating branch — including when the clash is at another
  branch (Req 3.2).
- Level gating is unchanged: "Kinder and Junior" never counts towards Coder, "Junior and Coder"
  never towards Kinder (Req 3.3).
- Seat capacity is unchanged: 4 for Kinder, 6 for Junior and Coder (Req 3.4).
- The endpoint's joinable-class rule is unchanged: at least one seat left and a matching category
  (Req 3.5).
- The endpoint still reports a window overlapping a break, training or meeting as unavailable with
  the same `Reserved for {type} — {label}` reason; the page still ignores the plan (Req 3.6).
- The endpoint's category-mismatch reason on a typed slot is unchanged (Req 3.7).
- For a window present in both the old and the new grid at an open branch/day, the verdict, the
  free and unavailable instructor lists, and the reason text are unchanged (Req 3.8).
- Data still comes from PostgreSQL only — never the Sheets config, never Old Operations classes
  (Req 3.9).
- Non-Active instructors stay excluded (Req 3.10).
- The cell dialog still lists available and unavailable instructors with level and reason
  (Req 3.11).
- The endpoint's response shape is unchanged: `filters`, `windowSources`, `configuredRules`,
  `total`, `availableCount`, `data`, and per-result `source`, `start`, `end`, `slotType`, `note`,
  `available`, `reason`, `freeInstructors`, `joinableClasses`, `existingSlots` (Req 3.12).
- The Old Operations Trial Priority page behaves exactly as it does today (Req 3.13).

**Scope:**
Any input that does not turn on a branch/day operating rule is untouched by this fix:
- The Old Operations Trial Priority page and its own fixed grid.
- `/api/slots` and `/api/crm`, which use `generateTrialSlots` from `src/utils/timeUtils.js`.
- Instructor capability, status, class overlap, seat capacity and joinable-class logic.
- Writes to `internal_operationals` via `/api/new/operationals` — this fix is read-side only.

**Two documented consequences of the fix.** Both follow from the requirements rather than from
choice, and are called out so they are not mistaken for regressions:
1. The endpoint's per-result `source` becomes `hours` for an open branch/day that has both hours
   and a plan, where today it is `plan`. The field, its type and its enumerable values are
   unchanged (Req 3.12 is about shape); only which of them applies changes, and that is exactly
   what Req 2.6 asks for. `slotType` and `note` continue to carry the plan detail.
2. A branch/day with no rule now yields no results, so a deployment with an empty
   `internal_operationals` table returns `data: []`. That is Req 2.5 applied uniformly. The
   `configuredRules === 0` hint text is reworded to say so instead of claiming the standard
   windows were used.

## Hypothesized Root Cause

Seven concrete defects across two files, each mapped to the current-behaviour clause it produces.

1. **Hardcoded page grid** (Req 1.1, 1.2). `NewTrialAvailabilityPage.jsx` declares
   `FIXED_TRIAL_SLOTS` at module scope and the overview memo is
   `FIXED_TRIAL_SLOTS.map((timeSlot) => …)`. Operating hours are never consulted: the hook is
   destructured as `const { openDaysFor } = useNewOperationals()`, so `hoursFor` — which already
   exists and already works — is never called. The row set therefore cannot vary by branch or day,
   and `overviewBranch` only ever filters instructors, never rows.

2. **Branch selector fed from the wrong system** (Req 1.3). The page builds `branchList` from
   `useSchedule().branches`, the Sheets/localStorage config, whose seed value is
   `DEFAULT_BRANCHES = [{ id: 'default', name: 'Default Branch', … }]`. `useNewOperationals`
   already exposes `branchNames` derived from PostgreSQL; it is simply not used.

3. **snake_case/camelCase mismatch on the raw row** (Req 1.4). The endpoint queries
   `SELECT * FROM internal_operationals`, so rows carry `is_open`, `open_time`, `close_time`. The
   open-day filter reads `ruleFor.get(...)?.isOpen`, the shape produced by `mapRow` in
   `/api/new/operationals` — always `undefined` here. `configuredDays` is therefore always `[]` and
   `const days = (configuredDays.length ? configuredDays : DAY_NAMES)` falls through to all seven
   days. Note the same route reads `rule?.open_time` correctly two lines later, which is why the
   hours are found but the open flag is not.

4. **Window-source precedence puts the plan first** (Req 1.6). `if (plan.length) { source =
   'plan'; windows = plan.map(...) }` short-circuits before the `rule?.open_time && rule?.close_time`
   branch. Every live rule carries a 12:00–13:00 break, so `plan.length` is truthy everywhere, the
   window set is the blocking slots, and the `['break','training','meeting'].includes(w.type)` guard
   marks each of them unavailable. The hours branch is unreachable for every configured day.

5. **No closed-day gate before the standard fallback** (Req 1.5). The `else` branch emits
   `standardTrialWindows()` whenever a day reaches it, with no test for a missing or closed rule.
   Combined with defect 3, a day the branch is shut gets ten windows reported available.

6. **Page branch filter misses "All Branches"** (Req 1.7).
   `if (overviewBranch !== 'all' && !(inst.branches || []).includes(overviewBranch)) return;`
   tests the branch name only. The endpoint's `staffAt` already does
   `i.branches.includes(branchName) || i.branches.includes('All Branches')`.

7. **Page treats "no rules" as "open every day"** (Req 1.5 on the page side). `workingDaysFor`
   ends with `if (days.size === 0) DAY_NAMES.forEach((d) => days.add(d))`, so an unconfigured
   instructor is counted every day of the week, masking closed days rather than showing them.

Defects 1, 2, 6 and 7 are the page; 3, 4 and 5 are the endpoint. They are independent, so each can
be confirmed on its own by the exploratory tests below.

## Correctness Properties

Property 1: Bug Condition - Trial windows follow the branch's configured operating hours

_For any_ branch/day coordinate where the bug condition holds (`isBugCondition` returns true), the
fixed report SHALL produce no window when the branch/day has no operational rule, is marked closed,
or is not a New Operations branch; and otherwise SHALL produce a non-empty grid of 60-minute
windows stepping every 30 minutes, each contained in `[open_time, close_time]`, the earliest
starting exactly at `open_time` and the latest ending at or before `close_time`. The page's branch
selector SHALL offer exactly the New Operations branch names, and the endpoint SHALL emit only the
branch's configured open days.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

Property 2: Preservation - Verdicts, reasons and response shape are unchanged

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed
report SHALL produce the same window grid and the same per-window verdict as the original; and _for
any_ window present in both the original and the fixed grid at an open branch/day, the fixed report
SHALL produce the same availability verdict, the same free and unavailable instructor lists, the
same reason text, and the same response fields — preserving level gating, seat capacity,
cross-branch class clashes, the endpoint's reserved-for and category-mismatch reasons, and the
endpoint's response shape.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.10, 3.12**

**Quantification note.** Preservation of the *grid* is checkable only where the two grids agree by
construction: `¬C(X)` on the page (open 13:00–18:30 yields the same ten rows — see the algebraic
identity below), and window-wise on the endpoint, whose grid changes for every configured day by
design. Property 2 is therefore checked as grid equality on `¬C(X)` plus verdict-and-reason equality
on the intersection of the old and new grids, which is exactly what Req 3.8 states.

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct, five files change. The window derivation lands in one
shared pure module so page and endpoint cannot diverge again, and the two surfaces get their report
logic extracted out of React and out of the route handler so both are testable without a browser or
a database.

**File**: `src/lib/newOpsAnalytics.js`

1. **Add `trialWindowsFromHours(openMin, closeMin, { duration = 60, step = 30 })`**: returns
   `[{ start, end }]` for `start = openMin; start + duration <= closeMin; start += step`. Returns
   `[]` when either bound is null or `closeMin - openMin < duration`.
2. **Re-express `standardTrialWindows()`** as `trialWindowsFromHours(13 * 60, 18 * 60 + 30)`. The
   two are already equal element-for-element — the existing loop is the same bounds, duration and
   step — so this is a refactor that makes Req 3.1 hold by construction rather than by coincidence.
3. **Add `readRule(row)`**: normalises either row shape to
   `{ isOpen, openMin, closeMin, slots }`, reading `row.is_open ?? row.isOpen` and
   `row.open_time ?? row.openTime`. This is the direct fix for defect 3, and prevents the same class
   of mistake in future callers.
4. **Add `trialWindowGridFor(row)`**: the shared precedence, returning `{ source, windows }`:
   - no row, or `isOpen === false` → `{ source: 'closed', windows: [] }`
   - `openMin` and `closeMin` present → `{ source: 'hours', windows: trialWindowsFromHours(...) }`
     — **before** any plan check, which is defect 4
   - else a non-empty plan → `{ source: 'plan', windows: planWindows }` (kept so a rule with a plan
     but no hours still reports)
   - else → `{ source: 'standard', windows: standardTrialWindows() }`
5. **Leave `hourlyWindows` in place** but stop calling it from the trial route. The endpoint's
   category-dependent 90/120-minute windows give way to the uniform 60-minute trial window the
   properties require.

**File**: `src/utils/timeUtils.js`

6. **Add `formatTrialWindowLabel(startMin, endMin)`**: produces the page's existing label style —
   `1.00 - 2.00 pm` when both ends share a meridiem, `11.00 am - 12.00 pm` when they do not,
   `10.00 - 11.00 am` in the morning. Must reproduce `FIXED_TRIAL_SLOTS` exactly for the ten
   13:00–18:30 windows, and must round-trip through the existing `parseTimeSlot`, since the label is
   what `doTimeSlotsOverlap` compares class times against. `parseTimeSlot` and
   `doTimeSlotsOverlap` themselves are not touched.

**File**: `src/lib/trialOverview.js` (new, pure)

7. **Add `buildTrialOverview({ rules, instructors, classes, branch })`**: the page's memo, lifted
   out of the component and given hours awareness.
   - Window rows: union of `trialWindowGridFor(rule).windows` over the days in scope — the selected
     branch's rules, or every branch's when `branch === 'all'` (Req 2.1, 2.2) — sorted by start,
     de-duplicated on `start-end`.
   - Per cell `(day, window)`: a rule that is missing or closed gives `closed: true` and the
     existing `Branch closed` reason (Req 2.5); a window outside that day's hours gives the same
     (Req 2.2); otherwise instructors are evaluated exactly as today — Active only, branch scope,
     class-overlap reason string built from `busy.branchName`, `busy.program`, `busy.time`
     (Req 3.2, 3.10).
   - Branch scope: `inst.branches.includes(branch) || inst.branches.includes('All Branches')`,
     matching the endpoint's `staffAt` (Req 2.7, defect 6).
   - Working days come from the rules only. The `days.size === 0 → all days` fallback is removed
     (defect 7).
   - Level counting (`canKinder`/`canJunior`/`canCoder`) and the empty-cell reason strings
     (`No instructors`, `All N teaching`, `N teaching, M closed`) move across unchanged
     (Req 3.3, 3.11).

**File**: `src/views/NewTrialAvailabilityPage.jsx`

8. **Delete `FIXED_TRIAL_SLOTS`** and call `buildTrialOverview` in the memo, keyed on rules,
   instructors, classes and the selected branch.
9. **Feed the selector from `useNewOperationals().branchNames`** instead of `useSchedule().branches`
   (Req 2.3, defect 2). `useSchedule` is no longer needed by this page; the `rules` array and
   `loading` flag come from the hook. Render the existing "Branch closed" treatment for closed
   cells, and keep the dialog, legend, chips and table markup as they are (Req 3.11).

**File**: `src/lib/trialAvailabilityCore.js` (new, pure)

10. **Add `buildTrialAvailability({ rules, instructors, classes, filters })`**: the endpoint's body
    with the I/O removed, returning the same response object it does today.
    - Days: `DAY_NAMES.filter((d) => readRule(ruleFor(branch, d)).isOpen)`, with no
      all-seven-days fallback (Req 2.4, 2.5 — defects 3 and 5).
    - Windows: `trialWindowGridFor(rule)`; `source: 'closed'` means the branch/day contributes no
      results at all.
    - **Plan overlay** — the part that keeps Req 3.6 and 3.7 alive now that the plan no longer
      supplies the grid. For each hours-derived window, find the overlapping plan slots via the
      existing `rangesOverlap`: a `break`, `training` or `meeting` overlap yields the current
      `Reserved for {type}{ — label}` result with the slot's own type and label; otherwise a typed
      class slot overlap supplies `slotType` for the category-mismatch check and the
      `{Category} Class · …` reason prefix. Both reason strings are produced by the same expressions
      as today.
    - Everything downstream — `bookedSlots`, `parseSlotLabel`, `levelCovers`,
      `maxStudentsForProgram`, the joinable-class filter, the verdict ladder, the sort, the
      `filters`/`windowSources`/`configuredRules`/`total`/`availableCount` envelope — moves across
      unchanged (Req 3.5, 3.8, 3.12).

**File**: `src/app/api/new/trial-availability/route.js`

11. **Reduce the handler** to `ensureTable`, the three queries, `buildTrialAvailability(...)` and
    `NextResponse.json(...)`, keeping the existing try/catch and 500 shape. Reword the
    `configuredRules === 0` note to say no rules are configured so no windows can be reported.

**Not changed**: `src/views/TrialPriorityPage.jsx` (Req 3.13), `src/hooks/useNewOperationals.js`
(already correct — it maps through camelCase rows, so `openDaysFor` and `hoursFor` work as
written), `src/app/api/new/operationals/route.js`, `/api/slots`, `/api/crm`,
`src/utils/constants.js`.

## Testing Strategy

### Validation Approach

Two phases. First, tests that fail on the unfixed code, one per hypothesised defect, so the root
cause analysis is confirmed or refuted before anything is edited. Then fix checking against
Property 1 and preservation checking against Property 2.

The repository has no test runner today (`package.json` exposes only `dev`, `build`, `start`,
`lint`). Set up **Vitest** with **fast-check** as devDependencies and add `"test": "vitest --run"`,
so tests execute once rather than in watch mode. Tests live in `tests/`, importing the pure modules
directly — `newOpsAnalytics.js`, `trialOverview.js` and `trialAvailabilityCore.js` have no React and
no `pg` dependency after the extraction, so no database or browser is needed.

Preservation checking needs the original behaviour to compare against. Copy the current page memo
and the current route body, unmodified, into `tests/fixtures/legacyTrialReport.js` as
`legacyTrialOverview` and `legacyTrialAvailability` before editing either file. These are the `F` to
the fixed modules' `F'`, and they never change again.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples on the UNFIXED code that demonstrate each hypothesised defect. If
a test unexpectedly passes, that root cause is refuted and needs re-hypothesising before the fix
proceeds.

**Test Plan**: Drive the legacy fixtures with a small hand-built dataset mirroring the live
database — Gading Serpong open 11:00–18:30 Monday to Friday, 10:00–17:00 Saturday, no Sunday rule,
each rule carrying a 12:00–13:00 break — and assert the behaviour the requirements demand.

**Test Cases**:
1. **Weekday morning windows exist** (defect 1): Gading Serpong Monday, expect a window starting at
   11:00 in the page grid (will fail on unfixed code — the grid starts at 13:00).
2. **Saturday grid ends at closing** (defect 1): expect no window ending after 17:00 (will fail —
   17:00–18:00 and 17:30–18:30 are offered).
3. **Grid changes with the branch** (defect 1, 2): build the grid for two branches with different
   hours and expect different row sets (will fail — identical).
4. **Selector lists New Ops branches only** (defect 2): expect `Default Branch` absent from the
   selector source (will fail — present).
5. **Open flag is read** (defect 3): call the legacy route body and expect Gading Serpong Sunday
   absent from the results (will fail — all seven days emitted).
6. **Closed day offers nothing** (defect 5): expect zero results for Gading Serpong Sunday (will
   fail — 10 windows, all `available: true`).
7. **A blocking-only plan does not suppress every window** (defect 4): expect at least one
   `available: true` result for Gading Serpong Monday (will fail — 11 results, all unavailable,
   all `source: 'plan'`).
8. **"All Branches" instructor is counted** (defect 6): one instructor with
   `branches: ['All Branches']`, branch filter set to a named branch, expect a non-zero count
   (will fail on the page fixture, and pass on the route fixture — confirming this is page-only).
9. **Edge case — unruled branch is not treated as open all week** (defect 7): an instructor at a
   branch with no rules, expect closed cells rather than seven open days (will fail).

**Expected Counterexamples**:
- Page rows are byte-identical across branches and days regardless of hours.
- Endpoint returns Sunday for a branch with no Sunday rule, and returns it as available.
- Endpoint returns `source: 'plan'` with `availableCount: 0` for every configured day.
- Possible causes: hardcoded grid constant, `isOpen` read on a snake_case row, plan-before-hours
  precedence, missing closed-day gate, branch-name-only instructor filter.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed report produces the
expected behaviour.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  { source, windows } := trialWindowGridFor(ruleFor(X.branch, X.day))
  rule := readRule(ruleFor(X.branch, X.day))

  IF rule = NULL OR rule.isOpen = FALSE OR X.branch ∉ newOpsBranchNames() THEN
    ASSERT windows = ∅
  ELSE
    ASSERT windows ≠ ∅
    ASSERT FOR ALL w IN windows:
             w.start >= rule.openMin
             AND w.end <= rule.closeMin
             AND w.end - w.start = 60
    ASSERT MIN(w.start FOR w IN windows) = rule.openMin
    ASSERT FOR ALL consecutive (w_i, w_i+1): w_i+1.start - w_i.start = 30
  END IF
END FOR
```

**Test Plan**: Property-based, generating rules over arbitrary open/close pairs on the half hour
(including bounds too narrow for a single 60-minute window, closed rules, missing rules, and
branch names not present in the rule set) and asserting the invariants above on the fixed grid, the
fixed page overview and the fixed endpoint core.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed report
produces the same result as the original — and that where the grids overlap, verdicts and reasons
match.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT legacyTrialOverview(X).rows = buildTrialOverview(X).rows
END FOR

FOR ALL X, FOR ALL w IN legacyWindows(X) ∩ fixedWindows(X) WHERE isOpen(X) DO
  ASSERT legacyVerdict(X, w) = fixedVerdict(X, w)
  ASSERT legacyReason(X, w)  = fixedReason(X, w)
  ASSERT legacyFree(X, w)    = fixedFree(X, w)
END FOR
```

**Testing Approach**: Property-based testing is the right tool here because:
- It generates many branch/day/instructor/class combinations automatically across the input domain.
- It catches the edge cases a handful of unit tests would miss — a class clash straddling a window
  boundary, an instructor whose level covers two categories, a plan slot that ends exactly when a
  window starts.
- It gives a strong guarantee that behaviour is unchanged for every non-buggy input, not just the
  ones anyone thought to write down.

**Test Plan**: Observe the UNFIXED behaviour first via the legacy fixtures, then assert the fixed
modules agree with them on `¬C(X)` and on the shared-window intersection.

**Test Cases**:
1. **The ten standard rows** (Req 3.1): a branch open exactly 13:00–18:30 on every day — the one
   `¬C(X)` shape — must yield row labels equal to the old `FIXED_TRIAL_SLOTS`, in order, with equal
   per-cell counts.
2. **Cross-branch class clash** (Req 3.2): an instructor at branch A teaching at branch B during a
   window stays unavailable with the same `Teaching [B] Program (time)` string.
3. **Level gating** (Req 3.3): "Kinder and Junior" never appears in a Coder count, "Junior and
   Coder" never in a Kinder count, no level counts towards all three.
4. **Seat capacity and joinable classes** (Req 3.4, 3.5): 4 for Kinder, 6 for Junior/Coder; only
   seats-left, category-matching classes are joinable.
5. **Reserved-for reasons survive the overlay** (Req 3.6): a window overlapping a break, training
   or meeting is unavailable with the identical reason text the plan-sourced path produced.
6. **Category-mismatch reason** (Req 3.7): a typed slot against a differing `category` filter yields
   the same string.
7. **Response shape** (Req 3.12): the fixed envelope has exactly the same keys as the legacy one,
   and each result object exactly the same keys, for a dataset covering all reachable window
   sources.
8. **Old Operations untouched** (Req 3.13): `TrialPriorityPage.jsx` has no import from the new
   modules and its own fixed grid is unchanged.

### Unit Tests

- `trialWindowsFromHours`: 11:00–18:30 → 14 windows starting 11:00, ending 18:30; 10:00–17:00 → 13
  windows; 13:00–18:30 → the ten standard windows; 08:00–16:00 → 15 windows; a 30-minute span → no
  window; null bounds → no window.
- `standardTrialWindows()` equals `trialWindowsFromHours(780, 1110)`, element for element.
- `readRule`: snake_case row, camelCase row, null row, and a row with `is_open: false`.
- `trialWindowGridFor`: closed rule, missing rule, hours-and-plan (source `hours`), plan-only
  (source `plan`), rule with neither (source `standard`).
- `formatTrialWindowLabel`: the ten 13:00–18:30 windows reproduce `FIXED_TRIAL_SLOTS` exactly;
  10:00–11:00 → `10.00 - 11.00 am`; 11:00–12:00 → `11.00 am - 12.00 pm`; every generated label
  round-trips through `parseTimeSlot`.
- Endpoint days: a branch with `is_open` true on three days emits exactly those three, before and
  after a `day` filter.

### Property-Based Tests

- **Property 1 (fix)**: over generated rules — arbitrary half-hour open/close pairs, `is_open`
  either way, some days absent, some branch names outside the rule set — every window in the fixed
  grid is 60 minutes, inside `[open, close]`, spaced 30 minutes apart, starting at `open`; and a
  closed, unruled or unknown branch/day yields an empty grid.
- **Property 2 (preservation)**: over generated instructors, classes and plans — for a branch/day
  open exactly 13:00–18:30 the fixed page overview equals the legacy one; and for every window in
  both grids at an open branch/day, verdict, reason, free list and unavailable list are equal.
- **Label round-trip**: for every window the fixed grid can produce,
  `parseTimeSlot(formatTrialWindowLabel(w.start, w.end))` returns `{ start: w.start, end: w.end }`,
  so `doTimeSlotsOverlap` keeps agreeing with minute arithmetic (this is what makes Req 3.2 hold
  across the new labels).
- **Envelope invariants**: for any generated dataset, `total === data.length`,
  `availableCount === data.filter(r => r.available).length`, `windowSources ⊆ {plan, hours,
  standard}`, and no result carries a day the branch is not open on.

### Integration Tests

- Full page flow: render with a rules fixture covering all seven live branches, switch the selector
  from `All Branches` to Gading Serpong to Bekasi, and assert the row set changes with each branch's
  hours and that Sunday shows closed for Gading Serpong but open for Bekasi.
- Endpoint flow: call `GET /api/new/trial-availability` against a seeded database and assert Gading
  Serpong returns 14 windows Monday to Friday, 13 on Saturday, none on Sunday, with the 12:00–13:00
  break window unavailable for the documented reason and the rest evaluated on instructor
  availability.
- Filter flow: `?branch=`, `?day=` and `?category=` each narrow the results without reintroducing
  closed days.
- Cell dialog flow: click a cell with a mixed available/unavailable population and assert the dialog
  still lists both groups with level and reason.
