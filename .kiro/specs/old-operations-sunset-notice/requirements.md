# Requirements Document

## Introduction

Old Operations is being retired on a fixed date. This feature announces that fact
inside the app, counts the days down to the date, escalates the wording as the
date approaches, keeps standing after the date has passed, and runs a short
guided tour that points at the New Operations half of the sidebar switcher.

Nothing is removed by this feature. Old Operations keeps rendering, its routes
keep answering, and the switcher keeps switching in both directions before,
on and after the retirement date. The whole of the change is the announcement,
the countdown, and the nudge across.

Three surfaces carry it: a banner strip at the top of the content area shown only
while the user is in Old Operations, a compact day-count badge on the Old
Operations switcher tab, and a registered guided tour named `ops-sunset`. Every
decision about what the notice says lives in one pure module,
`src/lib/opsSunset.js`, which takes the current instant as a parameter and
touches neither the DOM nor the network.

Out of scope, and stated so the boundary is explicit: deleting any Old Operations
view, route or service; making Old Operations read-only; blocking the switcher;
migrating data; redirecting `/home`; and notifying anyone outside the app.

## Glossary

- **Old_Operations**: the original operations experience, active when `opsMode` is `'old'`, which reads the Google Sheet.
- **New_Operations**: the replacement operations experience, active when `opsMode` is `'new'`, which reads the database.
- **Ops_Sunset_Module**: the pure module `src/lib/opsSunset.js`, holding all arithmetic, phase selection, dismissal validation and copy assembly for the notice.
- **Sunset_Notice_Model**: the view model object returned by `sunsetNotice`, consumed by the Sunset_Banner and the Switcher_Badge.
- **Sunset_Banner**: the component `src/components/ops/OpsSunsetBanner.jsx`, which renders the Sunset_Notice_Model and contains no arithmetic.
- **Sunset_Notice_Hook**: the hook `src/components/ops/useSunsetNotice.js`, which supplies the current instant and the configured date to the Ops_Sunset_Module.
- **App_Shell**: the component `src/components/layout/AppShell.jsx`, which owns `opsMode` and `sidebarCollapsed` and mounts the Sunset_Banner.
- **Sidebar**: the component `src/components/layout/Sidebar.jsx`, which holds the ops switcher pill and the navigation list.
- **Switcher_Badge**: the compact day-count element rendered on the Old Operations switcher tab.
- **Tour_Registry**: the `TOURS` table in `src/lib/tourSteps.js`.
- **Tour_Provider**: the component `src/components/tour/TourProvider.jsx`, which decides which tour is offered automatically and starts it.
- **Sunset_Tour**: the Tour_Registry entry with id `ops-sunset`.
- **Config_Service**: the route `src/app/api/new/config/route.js` and its `SETTINGS` allowlist.
- **Retirement_Date**: the calendar date, in WIB, after which Old_Operations is unsupported.
- **WIB**: Asia/Jakarta time, a fixed UTC+7 offset with no daylight saving.
- **WIB_Day_Index**: an integer count of whole days from the epoch to a given instant, measured on the WIB calendar.
- **Sunset_Phase**: one member of `SUNSET_PHASES`, which is the ordered list `['notice', 'warning', 'urgent', 'final', 'past']`.
- **Live_Phase**: any Sunset_Phase other than `past`.
- **Dismissible_Phase**: the phases `notice`, `warning` and `urgent`.
- **Dismissal_Record**: the JSON object `{ phase, at }` stored under the localStorage key `opsSunset.dismissed`.
- **Days_Remaining**: the integer returned by `daysUntilSunset`, being the Retirement_Date's WIB_Day_Index minus the current instant's WIB_Day_Index.
- **Storage**: a `localStorage`-like object passed into the Ops_Sunset_Module, or `null`.

## Requirements

### Requirement 1: Retirement date source and precedence

**User Story:** As a school administrator, I want the retirement date to be one organisational fact that I can move without a deploy, so that every user is shown the same deadline and the displayed date stays correct when the plan changes.

#### Acceptance Criteria

1. THE Ops_Sunset_Module SHALL export a shipped default Retirement_Date constant named `OLD_OPS_SUNSET_ISO` whose value is the string `"2026-09-01"` in `"YYYY-MM-DD"` form, read as a WIB calendar date.
2. WHEN the Sunset_Banner renders before any Config_Service response has arrived, THE Sunset_Notice_Hook SHALL compute the Sunset_Notice_Model from `OLD_OPS_SUNSET_ISO` on that first render, treating no Config_Service response as a precondition of rendering.
3. WHEN `resolveSunsetISO` receives a `configuredISO` argument that is a string matching `^\d{4}-\d{2}-\d{2}$` whose month field is `01` through `12` and whose day field is `01` through the number of days in that month of that year, THE Ops_Sunset_Module SHALL return that `configuredISO` value as the Retirement_Date in preference to the `fallbackISO` argument, including when `fallbackISO` also names a real calendar date.
4. WHILE the `fallbackISO` argument names a real calendar date, IF the `configuredISO` argument is absent, `undefined`, `null`, of a type other than string, an empty string, a string that does not match `^\d{4}-\d{2}-\d{2}$`, or a string whose fields name a date that does not exist such as `"2026-02-30"`, `"2026-13-01"` or `"2027-02-29"`, THEN THE Ops_Sunset_Module SHALL return the `fallbackISO` argument as the Retirement_Date.
5. IF neither the `configuredISO` argument nor the `fallbackISO` argument names a real calendar date, THEN THE Ops_Sunset_Module SHALL return `null` as the Retirement_Date.
6. WHEN a Config_Service response supplies a Retirement_Date that differs from the one currently displayed, THE Sunset_Banner SHALL re-render on the next render after that response, with no page reload, displaying the day count and Sunset_Phase recomputed from the newly supplied date.
7. WHILE a Config_Service response is outstanding, THE Sunset_Banner SHALL display the notice computed from `OLD_OPS_SUNSET_ISO`, rendering no loading indicator, no placeholder day count and no empty container for as long as that response is outstanding.
8. THE Ops_Sunset_Module SHALL compute the same Retirement_Date for every browser that supplies the same `configuredISO` and `fallbackISO` arguments, deriving the result from those two arguments only and from no per-browser value such as a stored first-view instant, a Storage entry, the host timezone setting or the host clock.
9. THE Ops_Sunset_Module SHALL complete every `resolveSunsetISO` call without throwing and SHALL return either a `"YYYY-MM-DD"` string naming a real calendar date or `null`, for every combination of argument values including `null`, `undefined`, numbers, booleans, arrays, objects and malformed strings.
10. WHEN a Config_Service response supplies a Retirement_Date equal to the one currently displayed, THE Sunset_Banner SHALL continue to display the same day count, headline and Sunset_Phase, with no intermediate empty or loading render.
11. WHEN `resolveSunsetISO` receives a `configuredISO` naming 29 February of a leap year, such as `"2028-02-29"`, THE Ops_Sunset_Module SHALL return that value as the Retirement_Date.

### Requirement 2: WIB day counting

**User Story:** As a user in any timezone, I want the day count to be the school's own count of calendar days, so that the number I see matches the number my colleagues see and it changes once per day rather than drifting with the clock.

#### Acceptance Criteria

1. THE Ops_Sunset_Module SHALL export `WIB_OFFSET_MINUTES` with the value `420`, SHALL apply exactly that 420-minute offset for every WIB conversion, and SHALL apply no host timezone offset and no daylight-saving adjustment in any WIB conversion.
2. WHEN `wibDayIndex` receives a finite instant in epoch milliseconds within the range -8,640,000,000,000,000 through 8,640,000,000,000,000 inclusive, THE Ops_Sunset_Module SHALL return the integer WIB_Day_Index of that instant, obtained by shifting the instant forward by 420 minutes and flooring to whole days.
3. WHEN `wibDayIndex` receives two instants that both fall within the same WIB calendar day, being the interval from 00:00:00.000 WIB through 23:59:59.999 WIB inclusive, THE Ops_Sunset_Module SHALL return an identical WIB_Day_Index for both instants, and SHALL return a WIB_Day_Index exactly 1 greater for the instant at the next 00:00:00.000 WIB.
4. WHEN `isoDayIndex` receives a well-formed `"YYYY-MM-DD"` string naming a real calendar date, with a year field from `0000` through `9999`, a month field from `01` through `12`, and a day field from `01` through the number of days in that month of that year under the Gregorian leap-year rule so that `"2024-02-29"` is a real date, THE Ops_Sunset_Module SHALL return the integer day index of that date derived from the year, month and day fields read individually, equal to the WIB_Day_Index that `wibDayIndex` returns for every instant within that date's WIB calendar day.
5. IF `isoDayIndex` receives a non-string, a string that does not match `^\d{4}-\d{2}-\d{2}$`, or a string naming a date that does not exist such as `"2026-02-30"`, `"2026-13-01"`, `"2026-00-10"`, `"2026-04-31"` or `"2026-02-29"`, THEN THE Ops_Sunset_Module SHALL return `null` and SHALL complete the call without throwing.
6. WHEN `daysUntilSunset` receives a Retirement_Date that names a real calendar date and a finite instant, THE Ops_Sunset_Module SHALL return the integer Days_Remaining equal to the Retirement_Date's day index minus the instant's WIB_Day_Index.
7. THE Ops_Sunset_Module SHALL return either an integer or `null` from `wibDayIndex`, `isoDayIndex` and `daysUntilSunset`, and SHALL return no fractional number, no `NaN`, no `undefined` and no string from those three functions.
8. WHILE the current instant falls within the Retirement_Date's own WIB calendar day, from 00:00:00.000 WIB through 23:59:59.999 WIB inclusive, THE Ops_Sunset_Module SHALL return `0` as Days_Remaining.
9. WHILE the current instant falls within the WIB calendar day immediately before the Retirement_Date, from 00:00:00.000 WIB through 23:59:59.999 WIB inclusive, THE Ops_Sunset_Module SHALL return `1` as Days_Remaining.
10. WHILE the current instant falls within the WIB calendar day immediately after the Retirement_Date, from 00:00:00.000 WIB through 23:59:59.999 WIB inclusive, THE Ops_Sunset_Module SHALL return `-1` as Days_Remaining.
11. WHEN the host timezone setting differs between two evaluations of the same instant and the same Retirement_Date, for any host offsets from UTC-12:00 through UTC+14:00 inclusive and including hosts whose offset changes with daylight saving, THE Ops_Sunset_Module SHALL return an identical Days_Remaining for both evaluations.
12. WHEN the current instant advances by any amount from 1 millisecond through 3,650 days, THE Ops_Sunset_Module SHALL return a Days_Remaining that is less than or equal to the value returned for the earlier instant, and SHALL return a Days_Remaining exactly 1 lower for each whole WIB calendar day boundary crossed.
13. IF `daysUntilSunset` receives a Retirement_Date that does not name a real calendar date, or an instant that is not a finite number, THEN THE Ops_Sunset_Module SHALL return `null` and complete without throwing.
14. IF `wibDayIndex` receives a value that is not a finite number, including `NaN`, `Infinity`, `-Infinity`, `null`, `undefined`, a string, a boolean, an array or an object, THEN THE Ops_Sunset_Module SHALL return `null` and complete without throwing.
15. WHEN the current instant is up to 3,650 days behind or ahead of the Retirement_Date's WIB calendar day, THE Ops_Sunset_Module SHALL return an integer Days_Remaining in the range -3,650 through 3,650 inclusive rather than `null`.

### Requirement 3: Phase escalation

**User Story:** As a user of Old Operations, I want the notice to change tone as the date approaches, so that I can tell a distant deadline from an imminent one at a glance.

#### Acceptance Criteria

1. THE Ops_Sunset_Module SHALL export `SUNSET_PHASES` as an ordered list of exactly five strings, `['notice', 'warning', 'urgent', 'final', 'past']`, occupying zero-based positions 0 through 4 in that order.
2. WHEN `sunsetPhase` receives an integer Days_Remaining from 15 through 9,007,199,254,740,991 inclusive, THE Ops_Sunset_Module SHALL return `'notice'`, including at the boundary values 15 and 16.
3. WHEN `sunsetPhase` receives an integer Days_Remaining from 4 through 14 inclusive, THE Ops_Sunset_Module SHALL return `'warning'`, including at both boundary values 4 and 14.
4. WHEN `sunsetPhase` receives an integer Days_Remaining from 1 through 3 inclusive, THE Ops_Sunset_Module SHALL return `'urgent'`, including at both boundary values 1 and 3.
5. WHEN `sunsetPhase` receives an integer Days_Remaining of exactly 0, THE Ops_Sunset_Module SHALL return `'final'`.
6. WHEN `sunsetPhase` receives an integer Days_Remaining from -1 through -9,007,199,254,740,991 inclusive, THE Ops_Sunset_Module SHALL return `'past'`, including at the boundary value -1.
7. WHEN `sunsetPhase` receives any integer in the range -9,007,199,254,740,991 through 9,007,199,254,740,991 inclusive, THE Ops_Sunset_Module SHALL return exactly one member of `SUNSET_PHASES` and SHALL complete the call without throwing, deriving that member from the Days_Remaining argument only and reading no clock value, no Storage entry and no configuration value, including for every Days_Remaining from -3,650 through 3,650 produced by a host clock set up to ten years behind or ahead of the Retirement_Date.
8. IF `sunsetPhase` receives `null`, `undefined`, `NaN`, `Infinity`, `-Infinity`, a fractional number such as `2.5`, a numeric string such as `"3"`, a boolean, an array or an object, THEN THE Ops_Sunset_Module SHALL return `null` and SHALL complete the call without throwing.
9. WHEN `phaseRank` receives a string exactly equal to a member of `SUNSET_PHASES`, THE Ops_Sunset_Module SHALL return that member's zero-based position, being `0` for `notice`, `1` for `warning`, `2` for `urgent`, `3` for `final` and `4` for `past`.
10. WHEN `phaseRank(sunsetPhase(a))` and `phaseRank(sunsetPhase(b))` are evaluated for any two integers `a` and `b` in the range -3,650 through 3,650 inclusive where `a` is less than or equal to `b`, THE Ops_Sunset_Module SHALL return a value for `a` that is greater than or equal to the value returned for `b`.
11. THE Ops_Sunset_Module SHALL assign the icon name `Info` to `notice`, `AlertTriangle` to `warning`, `AlertCircle` to `urgent`, `AlertCircle` to `final` and `Archive` to `past`, so that `notice`, `warning` and `past` each carry an icon name carried by no other Sunset_Phase, and so that `urgent` and `final`, which share the icon name `AlertCircle`, are distinguished from each other by their headline wording and by their `dismissible` value rather than by icon.
12. THE Ops_Sunset_Module SHALL assign each Sunset_Phase a headline that is a non-empty string of at most 240 characters, and SHALL assign five headlines that are pairwise unequal when compared with letter case ignored and runs of whitespace collapsed to a single space.
13. WHILE any Sunset_Phase is current, THE App_Shell SHALL render the same set of enabled navigation controls, switcher controls and Old_Operations page controls that it renders while the Sunset_Phase is `notice`, and SHALL vary between Sunset_Phases only the Sunset_Notice_Model fields `phase`, `days`, `dismissible`, `tone`, `icon`, `headline`, `detail` and `badge`.
14. IF `phaseRank` receives any value that is not a string exactly equal to a member of `SUNSET_PHASES`, including a member differing in letter case such as `'Warning'`, a member with leading or trailing whitespace, an empty string, `null`, `undefined`, `NaN`, a number, a boolean, an array or an object, THEN THE Ops_Sunset_Module SHALL return `-1` and SHALL complete the call without throwing.
15. THE Ops_Sunset_Module SHALL assign the tone value `notice` to the `notice` phase, `warning` to `warning`, `urgent` to `urgent`, `final` to `final` and `past` to `past`, so that each of the five tone values is carried by exactly one Sunset_Phase and each Sunset_Phase is identifiable from the pairing of its icon name and its headline wording without any colour perception.
16. IF the Days_Remaining supplied to `sunsetNotice` is `null`, or `sunsetPhase` returns `null` for that Days_Remaining, THEN THE Ops_Sunset_Module SHALL return a Sunset_Notice_Model with `visible` set to `false` and carrying no `phase`, `tone`, `icon`, `headline`, `detail` or `badge` value, and THE Sunset_Banner SHALL render no element and display no day count.

### Requirement 4: Banner placement and Old Operations scoping

**User Story:** As a user who already works in New Operations, I want the countdown to stay out of my way, and as a user still in Old Operations I want the countdown where I cannot miss it, so that the notice reaches the people it is for.

#### Acceptance Criteria

1. WHILE `opsMode` is `'old'` and the Sunset_Notice_Model has `visible` set to `true`, THE App_Shell SHALL render the Sunset_Banner inside `main.dashboard-container` in the document order Header, Sunset_Banner, `div.dashboard-views`, with the Sunset_Banner outside both the Header element and `div.dashboard-views`.
2. WHILE `opsMode` is `'new'`, THE Sunset_Notice_Hook SHALL return a Sunset_Notice_Model with `visible` set to `false`.
3. WHILE `opsMode` is `'old'` and the Sunset_Notice_Model has `visible` set to `true`, THE App_Shell SHALL keep the Sunset_Banner mounted outside the active page component, so that the document contains exactly one element carrying `data-tour="sunset-banner"` whichever page is active and across every change of active page.
4. WHILE `div.dashboard-views` is scrolled to any offset between 0 and its maximum scroll offset, THE App_Shell SHALL keep the Sunset_Banner's top edge at the same offset relative to `main.dashboard-container` as the offset measured at scroll offset 0, because the banner sits outside the scrolling `div.dashboard-views` region.
5. WHEN the Sunset_Notice_Model has `visible` set to `true`, THE Sunset_Banner SHALL render, in this document order, the icon named by the model's `icon` field, text equal to the model's `headline` field, text equal to the model's `detail` field, and a button whose accessible label is exactly "Show me New Operations".
6. WHEN the Sunset_Notice_Model has `visible` set to `false`, THE Sunset_Banner SHALL render no element, adding zero pixels of height, zero border and zero margin between the Header and `div.dashboard-views`.
7. WHILE the Sunset_Notice_Model has `visible` set to `true`, THE Sunset_Banner SHALL carry the attribute `data-tour="sunset-banner"` on its outermost rendered element.
8. THE Sunset_Banner SHALL display only values read from the fields of the supplied Sunset_Notice_Model, calling no Ops_Sunset_Module day-counting or phase-selection function and reading no clock value.
9. WHILE `opsMode` is `'new'`, THE App_Shell SHALL render zero elements carrying `data-tour="sunset-banner"`, on every page.
10. WHEN `opsMode` changes from `'new'` to `'old'` and the Sunset_Notice_Model has `visible` set to `true`, THE App_Shell SHALL mount the Sunset_Banner in the position stated in criterion 1 without a page reload and without unmounting the active page component.
11. IF the Sunset_Notice_Model supplied to the Sunset_Banner is absent, is not an object, or carries a `visible` value that is not a boolean, THEN THE Sunset_Banner SHALL render no element, THE App_Shell SHALL continue rendering the Header and `div.dashboard-views` unchanged, and THE App_Shell SHALL surface no error indication to the user.

### Requirement 5: Phase-scoped dismissal

**User Story:** As a user who has read the notice, I want to close it and have it stay closed until there is something new to say, so that the banner is neither permanent furniture nor a deadline I can switch off.

#### Acceptance Criteria

1. THE Ops_Sunset_Module SHALL export `DISMISS_KEY` with the value `'opsSunset.dismissed'`, and SHALL read and write the Dismissal_Record under `DISMISS_KEY` and under no other Storage key.
2. WHILE the current Sunset_Phase is a Dismissible_Phase, THE Sunset_Banner SHALL render exactly one dismiss button whose accessible name identifies it as dismissing the notice.
3. WHEN the user presses the dismiss button, THE Sunset_Banner SHALL call `recordDismissal` exactly once, passing the current Sunset_Phase and the current instant as a finite epoch millisecond value.
4. WHEN a Dismissal_Record has been written for a Dismissible_Phase and `readDismissal` is called at the same instant or at any later instant, THE Ops_Sunset_Module SHALL return a Dismissal_Record whose `phase` equals the phase written and whose `at` equals the epoch millisecond value written, and SHALL return `true` from `isDismissed` for that phase at that instant.
5. WHILE the current Sunset_Phase is a Dismissible_Phase and the stored Dismissal_Record names that same Sunset_Phase and carries an `at` value that is a finite number of epoch milliseconds no greater than the current instant, THE Ops_Sunset_Module SHALL return a Sunset_Notice_Model with `visible` set to `false`.
6. IF the stored Dismissal_Record names a Sunset_Phase other than the current Sunset_Phase, THEN THE Ops_Sunset_Module SHALL return `false` from `isDismissed` for the current Sunset_Phase and SHALL return a Sunset_Notice_Model with `visible` set to `true`, whether the named phase is less urgent or more urgent than the current one, so that escalation re-surfaces the notice.
7. IF the value stored under `DISMISS_KEY` is absent, is not parseable as JSON, parses to a value that is not an object, names a `phase` that is not one of the five members of `SUNSET_PHASES`, or carries an `at` value that is not a finite number, THEN THE Ops_Sunset_Module SHALL return `null` from `readDismissal`, SHALL treat the current Sunset_Phase as not dismissed, and SHALL return a Sunset_Notice_Model with `visible` set to `true`.
8. IF the stored Dismissal_Record carries an `at` value greater than the current instant by any margin, including by 1 millisecond, THEN THE Ops_Sunset_Module SHALL treat the current Sunset_Phase as not dismissed and SHALL return a Sunset_Notice_Model with `visible` set to `true`.
9. IF Storage is `null`, or Storage throws on `getItem`, THEN THE Ops_Sunset_Module SHALL return `null` from `readDismissal`, SHALL treat the current Sunset_Phase as not dismissed, and SHALL complete the call without throwing.
10. WHEN `isDismissible` receives a Sunset_Phase, THE Ops_Sunset_Module SHALL return `true` for each of `notice`, `warning` and `urgent`, and `false` for `final` and `past`.
11. WHILE the current Sunset_Phase is `final` or `past`, THE Sunset_Banner SHALL render no dismiss button.
12. WHEN `clearDismissal` is called with a Storage that accepts the removal, THE Ops_Sunset_Module SHALL remove the value stored under `DISMISS_KEY`, SHALL return `true`, and SHALL cause the next `readDismissal` call to return `null`.
13. WHEN `recordDismissal` is called with a Dismissible_Phase, a finite current instant and a Storage that accepts the write, THE Ops_Sunset_Module SHALL write the JSON Dismissal_Record `{ "phase": <that phase>, "at": <that instant> }` under `DISMISS_KEY`, replacing any Dismissal_Record already stored so that exactly one Dismissal_Record remains, and SHALL return `true`.
14. IF Storage is `null`, or Storage throws when the Ops_Sunset_Module writes or removes the Dismissal_Record, THEN THE Ops_Sunset_Module SHALL return `false` from that call, SHALL complete that call without throwing, and SHALL report the current Sunset_Phase as not dismissed.
15. WHILE the current Sunset_Phase is `final` or `past`, THE Ops_Sunset_Module SHALL return a Sunset_Notice_Model with `visible` set to `true` and `dismissible` set to `false`, including when a Dismissal_Record names that phase with an `at` value no greater than the current instant.

### Requirement 6: Behaviour on and after the retirement date

**User Story:** As a user with unfinished work in Old Operations, I want the app to tell me plainly that Old Operations is closed without locking me out of it, so that a date does not strand work that has not been migrated.

#### Acceptance Criteria

1. WHILE the Sunset_Phase is `final`, THE Sunset_Banner SHALL display a headline naming the current WIB calendar day as the last day of Old_Operations, the `AlertCircle` icon, the tone value `final`, and no dismiss button.
2. WHILE the Sunset_Phase is `past`, THE Sunset_Banner SHALL display a past-tense headline containing the Retirement_Date rendered in day, month name, year order such as `"1 September 2026"`, the `Archive` icon, the neutral tone value `past`, and no dismiss button.
3. WHILE the Sunset_Phase is `final` or `past` and `opsMode` is `'old'`, THE Sunset_Banner SHALL render with `visible` set to `true` on every Old_Operations page, after every navigation between Old_Operations pages within the session, and after every page reload, whatever Dismissal_Record is present in Storage.
4. WHEN the user presses either half of the Sidebar switcher pill while the Sunset_Phase is `final` or `past`, THE Sidebar SHALL change `opsMode` to the pressed value on that single press, in the Old_Operations to New_Operations direction and in the New_Operations to Old_Operations direction, presenting no confirmation prompt, no disabled control and no error indication.
5. WHILE the Sunset_Phase is `final` or `past`, THE Old_Operations views SHALL accept the same creations, edits and deletions that they accept in the `notice` phase, rendering no disabled control, no read-only state and no additional confirmation step that the `notice` phase does not render.
6. WHILE the Sunset_Phase is `past`, THE Switcher_Badge SHALL display the word "retired" and no digit characters, in both `opsMode` values.
7. WHILE the Sunset_Phase is `past`, THE Tour_Provider SHALL select no automatic Sunset_Tour at any point in the session, including when the `welcome` tour has been seen, the Sunset_Tour is unseen, `opsMode` is `'old'` and the sidebar is expanded.
8. THE Sunset_Notice_Model for the `past` phase SHALL be computed from the resolved Retirement_Date and the current instant parameter used for every other Sunset_Phase, through the same Days_Remaining and Sunset_Phase functions, requiring no value that exists only after Old_Operations has been removed.
9. WHEN a re-read of the current instant crosses from the Retirement_Date's own WIB calendar day into the following WIB calendar day, THE Sunset_Banner SHALL replace the `final` headline, icon and tone with the `past` headline, icon and tone on the next render, with no page reload.
10. WHEN the user opens or navigates to any Old_Operations page while the Sunset_Phase is `final` or `past`, THE App_Shell SHALL render that Old_Operations page and SHALL perform no redirect and no change of `opsMode`.
11. WHEN the user presses the "Show me New Operations" button while the Sunset_Phase is `past`, THE Sunset_Banner SHALL expand the sidebar if the sidebar is collapsed and SHALL start the Sunset_Tour on the following animation frame.

### Requirement 7: Guided tour and tour precedence

**User Story:** As a user being asked to move, I want a short guided animation that points at the New Operations switcher, so that I know exactly where to go and why.

#### Acceptance Criteria

1. THE Tour_Registry SHALL contain exactly one entry keyed `ops-sunset` whose `id` is `ops-sunset`, whose `version` is the integer `1`, and whose `steps` list holds exactly three steps in the order banner step, ops switcher step, sidebar navigation step, each step carrying a non-empty `title` string and a non-empty `body` string.
2. THE Sunset_Tour SHALL target its first step with the selector `[data-tour="sunset-banner"]`, its second step with the selector `[data-tour="ops-switcher"]`, and its third step with the selector `[data-tour="sidebar-nav"]`, using a `[data-tour="..."]` selector for every step and no selector of any other form.
3. THE Sunset_Tour SHALL keep every step `body` between 1 and 240 characters inclusive, and every step `title` between 1 and 80 characters inclusive.
4. IF the `welcome` tour has not been recorded as seen at the `welcome` entry's registered version, THEN THE Tour_Provider SHALL select `'welcome'` as the automatic tour and SHALL evaluate no Sunset_Tour condition, for every combination of `opsMode`, sidebar state, Sunset_Phase and Sunset_Tour seen state.
5. WHILE the `welcome` tour has been recorded as seen at its registered version, the Sunset_Tour has not been recorded as seen at version `1`, `opsMode` is `'old'`, the Sunset_Phase is a Live_Phase, and the sidebar is expanded, WHEN the Tour_Provider evaluates the automatic tour selection, THE Tour_Provider SHALL select `'ops-sunset'` as the automatic tour and SHALL start it once the existing `SETTLE_MS` delay of 900 milliseconds, measured from that evaluation, has elapsed.
6. WHILE the sidebar is collapsed, THE Tour_Provider SHALL select no automatic Sunset_Tour.
7. IF the Sunset_Tour has already been recorded as seen at version `1`, `opsMode` is `'new'`, or the Sunset_Phase is `past`, THEN THE Tour_Provider SHALL select no automatic tour, SHALL leave the sidebar state unchanged, SHALL leave the Sunset_Tour seen state unchanged, and SHALL surface no error indication.
8. THE Tour_Provider SHALL start at most one automatic tour per session, a session being the interval from one load of the App_Shell to its unload, starting no second automatic tour in that session after the first automatic start, including when the automatic selection is evaluated again following a change of active page, `opsMode`, sidebar state or Sunset_Phase.
9. WHEN the user presses the "Show me New Operations" button, THE App_Shell SHALL expand the sidebar if the sidebar is collapsed, and THE Sunset_Banner SHALL start the Sunset_Tour on the animation frame following that press, with no `SETTLE_MS` delay applied, whatever the Sunset_Tour seen state and whatever the `welcome` tour seen state, and this manual start SHALL not count towards the one automatic tour permitted per session.
10. WHEN the user leaves the Sunset_Tour at any step before its last present step, THE Tour_Provider SHALL mark the Sunset_Tour as seen at version `1`, SHALL remove the tour overlay from the document, and SHALL leave `opsMode` and the sidebar state unchanged.
11. IF one or two Sunset_Tour step targets are absent from the document at the moment the tour starts, a selector that raises an error counting as absent, THEN THE Tour_Provider SHALL run the tour with only the steps whose targets are present, in their registered relative order, and SHALL report the step count and step positions to the user as the count of present steps.
12. IF the active page or `opsMode` changes while the Sunset_Tour is running, THEN THE Tour_Provider SHALL stop the running tour, SHALL remove the tour overlay from the document, SHALL leave the Sunset_Tour seen state unchanged, and SHALL start no replacement tour in that session.
13. IF the Storage that records tour seen state is unavailable or raises an error when read, THEN THE Tour_Provider SHALL select no automatic tour and SHALL still start the Sunset_Tour when the user presses the "Show me New Operations" button.
14. WHEN the user completes the last present step of the Sunset_Tour, THE Tour_Provider SHALL mark the Sunset_Tour as seen at version `1` and SHALL remove the tour overlay from the document.
15. IF no Sunset_Tour step target is present in the document at the moment the tour starts, THEN THE Tour_Provider SHALL render no tour overlay, SHALL leave the Sunset_Tour seen state unchanged, and SHALL surface no error indication to the user.

### Requirement 8: Switcher badge

**User Story:** As a user looking at the sidebar, I want the Old Operations tab itself to carry the day count, so that the thing being retired is labelled where I choose between the two systems.

#### Acceptance Criteria

1. WHILE `opsMode` is `'old'`, the Sunset_Phase is a Live_Phase, and the Sunset_Notice_Model has `visible` set to `true`, THE Sidebar SHALL render exactly one Switcher_Badge element on the Old_Operations switcher tab, for both `sidebarCollapsed` values, deriving the badge's presence from the supplied `badge` string. The badge is decoration on a notice that is on screen: it is absent while `opsMode` is `'new'`, because Requirement 13.6 forbids the shell computing a day count there, and absent once the notice has been dismissed, because the banner it decorates has gone.
2. THE Switcher_Badge SHALL display the `badge` string supplied on the Sunset_Notice_Model exactly as supplied, at most 8 characters, with no truncation, no ellipsis and no text added by the Sidebar, and SHALL contain the Days_Remaining digits while the Sunset_Phase is a Live_Phase.
3. THE Switcher_Badge SHALL carry `aria-hidden="true"` and SHALL contribute no text to the accessible name of the Old_Operations switcher tab, because the Sunset_Banner already announces the same day count.
4. THE Switcher_Badge SHALL render with no CSS animation and no CSS transition, so that its computed `animation-name` is `none`, and SHALL leave the rendered position and size of the Old_Operations switcher tab label unchanged between successive renders at the same `badge` value.
5. THE Switcher_Badge SHALL display no text other than the `badge` string read from the same Sunset_Notice_Model that the Sunset_Banner renders, and SHALL display no Retirement_Date, no headline, no detail text and no control of its own.
6. IF the supplied `badge` value is absent, is not a string, or is an empty string, THEN THE Sidebar SHALL render no Switcher_Badge element, SHALL render the Old_Operations switcher tab and its label unchanged, and SHALL surface no error indication to the user.
7. WHEN the user presses the Switcher_Badge, THE Sidebar SHALL change `opsMode` to `'old'` on that single press, exactly as a press on any other part of the Old_Operations switcher tab, presenting no separate control, no confirmation prompt and no error indication.

### Requirement 9: Accessibility

**User Story:** As a user relying on a screen reader, on high-contrast vision, or on reduced motion, I want the deadline conveyed in text I can perceive, so that time-sensitive information reaches me the same way it reaches everyone else.

#### Acceptance Criteria

1. THE Sunset_Banner SHALL render its message inside exactly one element carrying `role="status"` and `aria-live="polite"`, and SHALL render no element carrying `role="alert"` and no element carrying `aria-live="assertive"` in any Sunset_Phase.
2. WHEN the Sunset_Banner appears, THE Sunset_Banner SHALL leave keyboard focus on the element that held focus before the banner appeared, calling no focus method and rendering no element carrying `autofocus`, in every Sunset_Phase and whether the previously focused element is a text input, a button or the document body.
3. THE Sunset_Banner SHALL include within the text content of the `role="status"` element the Days_Remaining value as digits while the Sunset_Phase is a Live_Phase, and the Retirement_Date in day, month name, year order while the Sunset_Phase is `past`, conveying that value through no bar length, no colour and not through the Switcher_Badge alone.
4. THE Sunset_Banner SHALL distinguish each Sunset_Phase by the icon named in the Sunset_Notice_Model and by headline wording that differs from the headline of every other Sunset_Phase, so that the Sunset_Phase is identifiable from the rendered icon and text alone when all colour information is removed.
5. WHILE the Sunset_Notice_Model carries `dismissible` set to `true`, THE Sunset_Banner SHALL render exactly one dismiss button whose `aria-label` names both the dismiss action and the notice being dismissed, and whose accessible name is matched by a case-insensitive search for "dismiss".
6. THE Sunset_Banner SHALL render the "Show me New Operations" control as a native `button` element carrying no negative `tabindex`, reachable by Tab in document order after the Header, and activatable by both the Enter key and the Space key.
7. WHILE the media query `prefers-reduced-motion: reduce` matches, THE Sunset_Banner SHALL render its `role="status"` text and its icon with a computed `animation-name` of `none` for both the entrance animation and the pulse animation, and with the same rendered position and size as when that media query does not match.
8. THE Sunset_Banner SHALL use, for each of the tone values `notice`, `warning`, `urgent`, `final` and `past`, a text colour measuring at least 4.5:1 contrast against `var(--panel-bg)`, for the headline text, the detail text and every button label it renders.
9. WHEN the user activates the dismiss button, THE Sunset_Banner SHALL place keyboard focus on an element that remains in the document after the banner is removed, and SHALL leave keyboard focus on neither the removed dismiss button nor the document body.
10. THE Sunset_Banner SHALL mark the Sunset_Phase icon as hidden from assistive technology, so that the Sunset_Phase is stated in the text content of the `role="status"` element rather than by the icon alone.
11. IF the host provides no `matchMedia` function, or `matchMedia` throws when the reduced-motion query is evaluated, THEN THE Sunset_Banner SHALL render its `role="status"` text, its icon and every button it renders, SHALL complete the render without throwing, and SHALL surface no error indication to the user.

### Requirement 10: Notice view model validation

**User Story:** As a developer rendering the notice, I want one view model that is either complete or explicitly invisible, so that the banner needs no defensive logic and no user ever sees a placeholder value.

#### Acceptance Criteria

1. WHEN `sunsetNotice` is called with any `sunsetISO` value, any current instant value and any Storage value, THE Ops_Sunset_Module SHALL return an object whose `visible` field is of boolean type and is either `true` or `false`.
2. WHILE the returned Sunset_Notice_Model has `visible` set to `true`, THE Sunset_Notice_Model SHALL carry a `phase` equal to one of the five members of `SUNSET_PHASES`, a `days` value that is an integer in the range -3,650 through 3,650 inclusive, a `sunsetISO` equal to the resolved Retirement_Date in `"YYYY-MM-DD"` form, a `headline` string of 1 through 120 characters, a `detail` string of 1 through 240 characters, a `badge` string of 1 through 12 characters, a `tone` string equal to the model's `phase` value, and an `icon` string equal to one of `Info`, `AlertTriangle`, `AlertCircle` and `Archive`.
3. WHILE the returned Sunset_Notice_Model has `visible` set to `true`, THE Sunset_Notice_Model SHALL carry a `dismissible` value of boolean type equal to the result of `isDismissible` for the model's `phase`, being `true` for `notice`, `warning` and `urgent` and `false` for `final` and `past`.
4. WHILE the returned Sunset_Notice_Model has `visible` set to `true`, THE Sunset_Notice_Model SHALL carry a `detail` string of at most 240 characters, matching the limit enforced on tour step bodies, so that the same copy can be reused as a Sunset_Tour step body.
5. IF the resolved Retirement_Date is absent, `null`, of a type other than string, a string that does not match `^\d{4}-\d{2}-\d{2}$`, or a string naming a date that does not exist such as `"2026-02-30"`, `"2026-13-01"` or `"2027-02-29"`, or the supplied current instant is not a finite number, THEN THE Ops_Sunset_Module SHALL return a Sunset_Notice_Model with `visible` set to `false` and SHALL complete the call without throwing.
6. WHILE the returned Sunset_Notice_Model has `visible` set to `true`, THE Sunset_Notice_Model SHALL carry `headline`, `detail`, `badge`, `sunsetISO`, `tone` and `icon` values that contain none of the case-sensitive substrings `NaN`, `undefined` and `Invalid`.
7. THE Ops_Sunset_Module SHALL complete every `sunsetNotice` call without throwing and SHALL return an object carrying a boolean `visible`, for every combination of Retirement_Date value, current instant value including `NaN`, `Infinity`, `-Infinity`, `null`, `undefined`, strings, booleans, arrays and objects, and Storage value including `null`, an absent Storage argument, a Storage that throws on `getItem`, and a Storage holding a value that is not parseable as JSON.
8. WHEN `formatSunsetDate` receives a Retirement_Date naming a real calendar date, THE Ops_Sunset_Module SHALL return that date as the day field without a leading zero, one space, the full English month name, one space, and the four-digit year, in that order, such as `"1 September 2026"`, reading the year, month and day fields individually as a WIB calendar date, applying no host timezone shift and including no weekday name.
9. THE Ops_Sunset_Module SHALL accept the current instant as an explicit epoch-millisecond parameter on `wibDayIndex`, `daysUntilSunset`, `isDismissed`, `recordDismissal` and `sunsetNotice`, and SHALL read no host clock value in any exported function.
10. WHILE the returned Sunset_Notice_Model has `visible` set to `false`, THE Ops_Sunset_Module SHALL return an object whose only field is `visible`, and THE Sunset_Banner SHALL read no field of that object other than `visible`.
11. IF `formatSunsetDate` receives a value that is not a string naming a real calendar date in `"YYYY-MM-DD"` form, including `null`, `undefined`, a number, a boolean, an array, an object, an empty string and `"2026-02-30"`, THEN THE Ops_Sunset_Module SHALL return an empty string, SHALL complete the call without throwing, and SHALL return no text containing the substrings `NaN`, `undefined` or `Invalid`.
12. WHILE the returned Sunset_Notice_Model has `visible` set to `true`, THE Sunset_Notice_Model SHALL carry a `days` value equal to the `daysUntilSunset` result for the model's `sunsetISO` and the supplied current instant, and a `phase` equal to the `sunsetPhase` result for that same `days` value.

### Requirement 11: Configuration entry

**User Story:** As an administrator, I want to move the retirement date through the existing configuration screen, so that the change is authorised, audited, and effective without a deploy.

#### Acceptance Criteria

1. THE Config_Service SHALL include a `oldOpsSunset` entry in the `SETTINGS` allowlist whose default is `null` and whose description names the expected `"YYYY-MM-DD"` WIB format, and SHALL treat `oldOpsSunset` as a known key on read and write requests rather than rejecting it as an unknown setting.
2. WHEN an authenticated caller requests the `oldOpsSunset` value and a value has been stored, THE Config_Service SHALL return that stored value character for character, together with the identity that last wrote it and the instant of that write.
3. WHEN an Admin caller writes an accepted `oldOpsSunset` value, THE Config_Service SHALL persist that value as the stored value, SHALL record exactly one audit entry naming the `oldOpsSunset` key through the existing audit path, and SHALL return the persisted value in the same response.
4. IF a caller without the Admin role attempts to write the `oldOpsSunset` value, THEN THE Config_Service SHALL reject the request through the existing authorisation path, SHALL leave the stored value unchanged, and SHALL record no audit entry for that attempt.
5. WHEN a write supplies `null` as the `oldOpsSunset` value, THE Config_Service SHALL accept the write and store `null`, and THE Ops_Sunset_Module SHALL then resolve the Retirement_Date to the shipped default constant `OLD_OPS_SUNSET_ISO`.
6. WHEN a write supplies a 10-character string matching `^\d{4}-\d{2}-\d{2}$` whose year field is `0000` through `9999`, whose month field is `01` through `12`, and whose day field is `01` through the number of days in that month of that year under the Gregorian leap-year rule so that `"2028-02-29"` is accepted, THE Config_Service SHALL accept the write.
7. IF a write supplies a value that is neither `null` nor a string naming a real calendar date in `"YYYY-MM-DD"` form, including an absent value, an empty string, a number, a boolean, an array, an object, a string carrying leading or trailing whitespace, `"1 Sept"`, `"2026-9-1"`, `"2026-02-30"`, `"2026-13-01"` and `"2027-02-29"`, THEN THE Config_Service SHALL respond with status 400 and a message naming the expected `"YYYY-MM-DD"` format.
8. WHEN a write supplies an `oldOpsSunset` value naming a real calendar date that falls before the current WIB calendar day, by any margin from 1 day through 3,650 days, THE Config_Service SHALL accept the write and SHALL apply no range check, because moving the deadline into the past is a valid administrative action.
9. WHEN an authenticated caller requests the `oldOpsSunset` value and no value has been stored, THE Config_Service SHALL return `null` as the value together with an indication that the returned value is the entry's default.
10. IF an unauthenticated caller requests the `oldOpsSunset` value, THEN THE Config_Service SHALL reject the request through the existing authentication path and SHALL return no `oldOpsSunset` value.
11. IF a write of the `oldOpsSunset` value is rejected for any reason, THEN THE Config_Service SHALL leave the previously stored value unchanged, so that the next read returns the value that was stored before the rejected write.

### Requirement 12: Current instant and configuration handling in the hook

**User Story:** As a user who leaves a tab open for days, I want the count to be current when I come back to it, so that the banner never shows yesterday's number.

#### Acceptance Criteria

1. WHEN the Sunset_Notice_Hook mounts, THE Sunset_Notice_Hook SHALL seed the current instant from the host clock as a finite epoch millisecond value and SHALL supply that value to the Ops_Sunset_Module on the first render, before any Config_Service response has arrived.
2. WHILE the Sunset_Notice_Hook remains mounted and `opsMode` is `'old'`, THE Sunset_Notice_Hook SHALL re-read the current instant from the host clock at intervals of 60 seconds, with each successive re-read occurring no earlier than 55 seconds and no later than 65 seconds after the previous re-read, and SHALL recompute the Sunset_Notice_Model from each re-read value.
3. WHEN a `visibilitychange` event fires and the document visibility state is `visible`, THE Sunset_Notice_Hook SHALL re-read the current instant and recompute the Sunset_Notice_Model within 1 second of that event, and SHALL issue no Config_Service request on that event.
4. WHILE the Sunset_Notice_Hook remains mounted and the document visibility state is `visible`, WHEN a re-read of the current instant crosses into a new WIB calendar day, THE Sunset_Banner SHALL display the Days_Remaining value for the new WIB calendar day no later than 65 seconds after that 00:00:00.000 WIB boundary, with no page reload and no Config_Service request.
5. THE Sunset_Notice_Hook SHALL issue at most one Config_Service request for the `oldOpsSunset` value per mount, and SHALL issue no additional request on a re-render caused by a current-instant re-read, a `visibilitychange` event, a dismissal, or a change of the active page.
6. WHILE `opsMode` is not `'old'`, THE Sunset_Notice_Hook SHALL return a Sunset_Notice_Model with `visible` set to `false`, SHALL issue no Config_Service request for the `oldOpsSunset` value, and SHALL start no current-instant re-read interval.
7. WHEN the user dismisses the notice, THE Sunset_Notice_Hook SHALL record the dismissal exactly once for the Sunset_Phase of the currently displayed Sunset_Notice_Model using the most recently read current instant, SHALL recompute the Sunset_Notice_Model on the next render, and SHALL issue no Config_Service request.
8. THE Sunset_Notice_Hook SHALL return an object carrying the current Sunset_Notice_Model, a dismiss function and a refresh function, and SHALL delegate every day count, Sunset_Phase and dismissal decision to the Ops_Sunset_Module, performing no such computation of its own.
9. WHEN `opsMode` changes from `'new'` to `'old'` while the Sunset_Notice_Hook remains mounted, THE Sunset_Notice_Hook SHALL re-read the current instant, SHALL issue exactly one Config_Service request for the `oldOpsSunset` value if no such request has been issued during that mount, and SHALL recompute the Sunset_Notice_Model.
10. WHEN the component holding the Sunset_Notice_Hook unmounts, THE Sunset_Notice_Hook SHALL stop the 60-second re-read, SHALL remove its `visibilitychange` listener, and SHALL perform no further current-instant re-read, no further Config_Service request and no further state update.

### Requirement 13: Resilience

**User Story:** As a user on a locked-down browser, a flaky connection, or a machine with a wrong clock, I want the notice to degrade towards showing the deadline rather than hiding it, so that a technical failure never conceals an organisational one.

#### Acceptance Criteria

1. IF a Config_Service request for the `oldOpsSunset` value does not complete, completes with a status other than success including an unauthorised status, or returns a value that `resolveSunsetISO` rejects, THEN THE Sunset_Notice_Hook SHALL continue to supply `OLD_OPS_SUNSET_ISO` as the Retirement_Date, THE Sunset_Banner SHALL continue to display the same Days_Remaining and Sunset_Phase it displayed before that response, and THE Sunset_Banner SHALL render no error message, no toast and no retry control.
2. WHEN the Sunset_Banner is next mounted after a Config_Service request that failed, THE Sunset_Notice_Hook SHALL issue exactly one further Config_Service request for the `oldOpsSunset` value during that mount, having issued no repeated request within the mount in which the request failed.
3. IF Storage throws on read, or Storage is `null`, THEN THE Ops_Sunset_Module SHALL return the same Sunset_Notice_Model it returns for a Storage holding no value under `DISMISS_KEY`, with `visible` set to `true` for every Live_Phase, and SHALL complete the call without throwing.
4. IF Storage throws when the dismissal is written, THEN THE Sunset_Banner SHALL hide the notice for the remainder of the current mount, SHALL surface no error indication to the user, and THE Sunset_Banner SHALL display the notice again for the same Sunset_Phase on the next mount.
5. IF the host clock is set up to 3,650 days behind or ahead of the Retirement_Date, THEN THE Ops_Sunset_Module SHALL return a Sunset_Notice_Model whose `phase` is a member of `SUNSET_PHASES`, being `notice` for a clock behind the Retirement_Date by 15 days or more and `past` for a clock ahead of it by 1 day or more, whose `days` is an integer, and whose displayed strings contain none of the substrings `NaN`, `undefined` and `Invalid`.
6. WHILE `opsMode` is `'new'`, THE App_Shell SHALL perform no sunset date arithmetic, SHALL issue no Config_Service request for the `oldOpsSunset` value, and SHALL render no Sunset_Banner element in the document.
7. IF a Config_Service request for the `oldOpsSunset` value has not completed within 10 seconds of being issued, THEN THE Sunset_Notice_Hook SHALL treat that request as failed, SHALL continue to supply `OLD_OPS_SUNSET_ISO` as the Retirement_Date, and SHALL issue no further request for that value during that mount.
8. THE App_Shell SHALL keep the rest of the interface rendered and navigable for every Config_Service failure, every Storage failure on read or write, and every host clock value, surfacing no error message, no toast and no error fallback in place of the page content.
9. WHILE a Config_Service request for the `oldOpsSunset` value has failed and the Sunset_Phase is a Live_Phase, THE Switcher_Badge SHALL continue to display the day count computed from `OLD_OPS_SUNSET_ISO` and the current instant.
