# Bugfix Requirements Document

## Introduction

The New Operations "Trial Availability Overview" reports which weekly windows can still take a
trial student. It is meant to answer that question from New Operations data alone, and the
bookable windows are meant to follow each branch's configured operating hours.

Neither holds today. The grid is a fixed ten-row list of 60-minute windows running 1:00pm to
6:30pm that never changes — not per branch, not per day. The live database now holds 42
operational rules across 7 branches, with real hours (weekdays 11:00–18:30, Saturday 10:00–17:00,
and for Bekasi and Bintaro a Sunday 08:00–16:00), none of which reach the grid. The branch
selector is also populated from the Old Operations Google Sheets configuration rather than from
New Operations, so it offers "Default Branch" — an entry with no New Operations rules,
instructors or classes.

The `/api/new/trial-availability` endpoint, which is supposed to be the machine-readable form of
the same report, is wrong in a different way. It never applies the configured open days, so it
emits every one of the seven weekdays including days a branch is closed. And because it prefers
the slot plan whenever one exists, and every live rule carries a 12:00–13:00 break, it returns
only blocked windows for the six configured days: Gading Serpong currently reports 11 windows for
Monday to Saturday, every one of them unavailable, and 10 available windows for Sunday — the one
day the branch is actually closed.

Both effects mean an operator reading the page or the endpoint cannot tell when a trial may
actually be booked, and would offer times the branch is shut while missing the hours it is open.

**Scope note — subject of the report.** The report describes this as "trial priority", which is
the name of the Old Operations sidebar page. The attached screenshot is unambiguously the New
Operations "Trial Availability" page (sidebar id `trial-availability`), and the details in the
report — the New Operations subtitle, the Kinder/Junior/Coder legend, the "Branch closed" cell —
match only that page. This spec therefore treats the New Operations Trial Availability page and
its endpoint as the subject. The Old Operations Trial Priority page is out of scope and must not
change.

**Scope note — slot plan.** Confirmed with the user: this fix re-anchors the existing 60-minute
window grid to each branch's operating hours. It does not add slot-plan awareness to the page, so
a window overlapping a break, training or meeting is not newly marked unavailable. The endpoint's
existing slot-plan reporting is preserved as-is.

## Bug Analysis

### Bug Condition

X is a cell coordinate the trial report evaluates: a branch, a weekday, and the New Operations
data behind them.

```pascal
FUNCTION isBugCondition(X)
  INPUT: X = { branch, day }
  OUTPUT: boolean

  rule ← operationalRuleFor(X.branch, X.day)   // internal_operationals

  // (a) The branch is open on this day, but its hours are not the
  //     hardcoded 13:00-18:30 the fixed grid assumes.
  hoursMismatch ← rule ≠ NULL
                  AND rule.is_open = TRUE
                  AND (toMin(rule.open_time) ≠ 13*60
                       OR toMin(rule.close_time) ≠ 18*60 + 30)

  // (b) The branch is closed on this day, yet windows are still offered.
  closedDayLeak ← rule = NULL OR rule.is_open = FALSE

  // (c) The branch is not a New Operations branch at all.
  phantomBranch ← X.branch ∉ newOpsBranchNames()

  RETURN hoursMismatch OR closedDayLeak OR phantomBranch
END FUNCTION
```

In the live database every configured branch/day satisfies (a) — no branch runs 13:00–18:30 —
so the bug is presently total: no cell in the grid reflects real hours.

`¬isBugCondition(X)` holds for a branch/day that is open with hours exactly 13:00–18:30. For
those the fixed grid happens to be correct, and the rendered rows must come out identical after
the fix.

### Current Behavior (Defect)

1.1 WHEN a branch/day is open with operating hours other than 13:00–18:30 THEN the system renders
the same ten fixed 60-minute rows (1.00–2.00 pm through 5.30–6.30 pm) regardless of branch or
day, so windows inside the branch's real hours are missing (Gading Serpong weekday 11:00–13:00,
Saturday 10:00–13:00) and windows past closing are offered (Saturday 17:00–18:30).

1.2 WHEN the user changes the branch selector THEN the system leaves the time rows unchanged,
because the rows are not derived from the selected branch's operating hours at all.

1.3 WHEN the branch selector is populated THEN the system lists branches from the Old Operations
Google Sheets configuration, so it offers "Default Branch", which has no New Operations
operational rule, instructor or class, and yields an all-zero grid.

1.4 WHEN `/api/new/trial-availability` decides which days a branch is open THEN the system reads
the rule's open flag under a name the database row does not carry, so the value is always absent,
the configured-open-day list is always empty, and the endpoint falls back to emitting all seven
weekdays.

1.5 WHEN a branch/day has no operational rule, or has one marked closed THEN
`/api/new/trial-availability` emits the standard 13:00–18:30 windows and reports them available —
Gading Serpong Sunday, which has no rule, currently returns 10 available windows.

1.6 WHEN a branch/day rule carries a slot plan consisting only of blocking slots THEN
`/api/new/trial-availability` emits only those blocked windows and no bookable window at all —
Gading Serpong Monday to Saturday currently returns 11 windows, all unavailable, and the
hours-derived window source is never reached even though `open_time` and `close_time` are set.

1.7 WHEN a branch is selected and an instructor is assigned to "All Branches" THEN the page
excludes that instructor from the branch's counts, because the branch filter tests for the branch
name only.

### Expected Behavior (Correct)

2.1 WHEN a branch/day is open with operating hours other than 13:00–18:30 THEN the system SHALL
derive the time rows from that branch/day's `open_time` and `close_time`, as 60-minute windows
stepping every 30 minutes, the first starting at `open_time` and the last ending at or before
`close_time` — Gading Serpong weekdays yielding 11:00–12:00 through 17:30–18:30, and Saturday
10:00–11:00 through 16:00–17:00.

2.2 WHEN the user changes the branch selector THEN the system SHALL recompute the time rows from
the newly selected branch's operating hours; and WHEN "All Branches" is selected THEN the system
SHALL render the union of all open branches' windows and count an instructor in a cell only where
that instructor's branch is open on that day and its hours contain the window.

2.3 WHEN the branch selector is populated THEN the system SHALL list only New Operations
branches, taken from PostgreSQL, so "Default Branch" and any other Sheets-only entry SHALL NOT
appear.

2.4 WHEN `/api/new/trial-availability` decides which days a branch is open THEN the system SHALL
read the operational rule's open flag as the database row actually carries it, so configured open
days SHALL take effect.

2.5 WHEN a branch/day has no operational rule, or has one marked closed THEN the system SHALL
report no bookable trial window for that branch/day — the page SHALL show the day as closed and
the endpoint SHALL NOT emit standard windows for it.

2.6 WHEN a branch/day is open and has both operating hours and a slot plan THEN
`/api/new/trial-availability` SHALL derive its bookable window grid from `open_time` and
`close_time`, so a plan made up only of blocking slots no longer suppresses every bookable
window, and the branch reports the windows its hours allow.

2.7 WHEN a branch is selected and an instructor is assigned to "All Branches" THEN the system
SHALL include that instructor in the branch's counts.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a branch/day is open with operating hours of exactly 13:00–18:30 THEN the system SHALL
CONTINUE TO render the same ten rows, 1.00–2.00 pm through 5.30–6.30 pm, with the same counts.

3.2 WHEN an instructor teaches a class overlapping a window THEN the system SHALL CONTINUE TO
count them unavailable for that window, with the same reason text naming the program, time and
originating branch, including when the clashing class is at another branch.

3.3 WHEN an instructor's level is "Kinder and Junior" THEN the system SHALL CONTINUE TO exclude
them from Coder counts; and WHEN their level is "Junior and Coder" THEN the system SHALL CONTINUE
TO exclude them from Kinder counts. No level SHALL count towards all three categories.

3.4 WHEN seat capacity is evaluated THEN the system SHALL CONTINUE TO allow 4 students in a
Kinder class and 6 in a Junior or Coder class.

3.5 WHEN `/api/new/trial-availability` reports classes a trial student could join THEN the system
SHALL CONTINUE TO list only classes with at least one seat left whose category matches the
requested category.

3.6 WHEN a window overlaps a break, training or meeting slot in the branch's plan THEN
`/api/new/trial-availability` SHALL CONTINUE TO report that window unavailable with the same
reserved-for reason; and the page SHALL CONTINUE TO ignore the slot plan, per the agreed scope.

3.7 WHEN a slot is typed for one category and the requested category differs THEN
`/api/new/trial-availability` SHALL CONTINUE TO report the window unavailable with the same
category-mismatch reason.

3.8 WHEN a window exists under both the old fixed grid and the new hours-derived grid, and the
branch/day is open THEN the system SHALL CONTINUE TO produce the same verdict, the same free and
unavailable instructor lists, and the same reason text for that window.

3.9 WHEN the report needs instructors, classes or branch rules THEN the system SHALL CONTINUE TO
read them from PostgreSQL only, and SHALL NOT consult the Google Sheets configuration or the Old
Operations class data.

3.10 WHEN an instructor's status is not Active THEN the system SHALL CONTINUE TO exclude them
from all counts.

3.11 WHEN a cell is clicked THEN the page SHALL CONTINUE TO open the detail dialog listing
available and unavailable instructors with their level and, for unavailable ones, the reason.

3.12 WHEN a caller reads `/api/new/trial-availability` THEN the system SHALL CONTINUE TO return
the same response shape, including the per-result window source, the top-level window-source
list, the configured-rule count, the totals and the branch/day/category filters.

3.13 WHEN the Old Operations Trial Priority page is used THEN the system SHALL CONTINUE TO behave
exactly as it does today; this fix SHALL NOT change it.

### Fix and Preservation Properties

```pascal
// Property: Fix Checking - windows follow branch operating hours
FOR ALL X WHERE isBugCondition(X) DO
  windows ← trialWindows'(X)
  rule    ← operationalRuleFor(X.branch, X.day)

  IF rule = NULL OR rule.is_open = FALSE OR X.branch ∉ newOpsBranchNames() THEN
    ASSERT windows = ∅
  ELSE
    ASSERT windows ≠ ∅
    ASSERT FOR ALL w IN windows:
             w.start ≥ toMin(rule.open_time)
             AND w.end ≤ toMin(rule.close_time)
             AND w.end - w.start = 60
    ASSERT MIN(w.start FOR w IN windows) = toMin(rule.open_time)
  END IF
END FOR
```

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT trialWindows(X) = trialWindows'(X)
  ASSERT FOR ALL w IN trialWindows(X):
           verdict(X, w) = verdict'(X, w)
END FOR
```

Where `trialWindows` and `verdict` are the report as it behaves today, and `trialWindows'` and
`verdict'` the same report after the fix.
