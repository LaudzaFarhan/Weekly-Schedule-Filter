# Implementation Plan: Old Operations Sunset Notice

## Overview

Implementation language is **JavaScript with JSDoc**, matching the rest of the repository and the
file paths the design names (`src/lib/opsSunset.js`, `src/components/ops/*.jsx`). Tests are Vitest
(`npm run test`) plus fast-check `4.9.0`, both already installed. No new dependency is added.

Order of work follows the dependency direction in the design: the pure module first (day counting,
then config precedence, then phase selection, then dismissal, then notice assembly), because every
other piece reads its output and none of it needs a browser. Then the `oldOpsSunset` config entry,
the hook that supplies the clock and the fetch, the banner and its stylesheet, the AppShell and
Sidebar wiring, the `ops-sunset` tour with the `TourProvider` precedence rule, and finally the
integration tests that assert what no unit test of the pure module can see.

Property-test run counts follow the repo convention: pure-function properties at `{ numRuns: 100 }`
(as in `src/lib/__tests__/wipeReporting.property.test.js`), DOM-driven properties that mount a tree
per example at `{ numRuns: 20 }` (as in `src/components/operations/__tests__/WipeStudentsDialog.property.test.jsx`).
Every property test carries the header comment `// Feature: old-operations-sunset-notice, Property N: <title>`
immediately above its `it`, with `Req x.y` references inside the assertions.

## Tasks

- [x] 1. Build the day-counting and date-resolution core of the pure module
  - [x] 1.1 Create `src/lib/opsSunset.js` with the constants and the three day-index functions
    - Export `WIB_OFFSET_MINUTES = 420`, `OLD_OPS_SUNSET_ISO = '2026-09-01'`, `SUNSET_PHASES = ['notice','warning','urgent','final','past']` and `DISMISS_KEY = 'opsSunset.dismissed'`
    - `wibDayIndex(instantMs)`: `Math.floor((instantMs + 420 * 60000) / 86400000)`; returns `null` for anything that is not a finite number, never `NaN`
    - `isoDayIndex(iso)`: match `^(\d{4})-(\d{2})-(\d{2})$`, read the three fields individually, build with `Date.UTC`, then round-trip the fields to reject the dates `Date.UTC` silently rolls forward (`2026-02-30`, `2026-13-01`, `2026-00-10`, `2026-04-31`, `2026-02-29`); return `utcMs / 86400000`, or `null`
    - `daysUntilSunset(sunsetISO, nowMs)`: `isoDayIndex(sunsetISO) - wibDayIndex(nowMs)`, or `null` when either side is `null`
    - No `Date.now()`, no `Date.parse`, no host-timezone getter (`getFullYear`, `getMonth`, `getDate`) anywhere in the module — the whole point of D7
    - No loops: the whole path is branch-only arithmetic
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.13, 2.14, 2.15, 10.9_

  - [x]* 1.2 Write property tests for day counting
    - **Property 1: The day count is always a whole number of days** — **Validates: Requirements 2.6, 2.7**
    - **Property 2: Every instant on the same WIB day gives the same count** — **Validates: Requirements 2.3, 2.8**
    - **Property 3: The count is non-increasing as time passes** — **Validates: Requirements 2.12**
    - **Property 4: The deadline's own WIB day is exactly zero, and its neighbours are exactly plus or minus one** — **Validates: Requirements 2.8, 2.9, 2.10**
    - **Property 6: Malformed dates yield null, not a wrong number** — **Validates: Requirements 2.5, 2.13, 2.14**
    - Pure function properties — `{ numRuns: 100 }`
    - New file `src/lib/__tests__/opsSunset.property.test.js`, with the `instant()`, `withinDay()`, `isoDate()`, `junk()` and `phase()` generators from the design at the top of the file
    - _Requirements: 2.3, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.12, 2.13, 2.14_

  - [x]* 1.3 Write the timezone-independence property test
    - **Property 5: The count is independent of the host timezone** — **Validates: Requirements 2.1, 2.11**
    - Run the same generated inputs under `process.env.TZ` set to `Pacific/Kiritimati`, `Pacific/Niue` and `Asia/Jakarta`, resetting the module registry between suites so the offset cannot be captured at import time
    - Its own file `src/lib/__tests__/opsSunset.timezone.property.test.js`, because `TZ` has to be set before any `Date` is constructed in the file and that cannot be done per-`describe` inside the main property file
    - Pure function property — `{ numRuns: 100 }`
    - _Requirements: 2.1, 2.11_

  - [x] 1.4 Add `resolveSunsetISO` and `formatSunsetDate` to `src/lib/opsSunset.js`
    - `resolveSunsetISO(fallbackISO, configuredISO)`: return `configuredISO` when `isoDayIndex` accepts it, else `fallbackISO` when `isoDayIndex` accepts that, else `null`; never throws for any argument type, and reads no Storage entry, no host timezone and no clock
    - `formatSunsetDate(iso)`: `"1 September 2026"` — day without a leading zero, one space, the full English month name from a local table, one space, the four-digit year; `''` for anything that is not a real `YYYY-MM-DD` date, and never a string containing `NaN`, `undefined` or `Invalid`
    - Month names come from a constant array, not `toLocaleDateString`, so the output does not vary with the host locale
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.8, 1.9, 1.11, 10.8, 10.11_

  - [x]* 1.5 Write the property test for config precedence
    - **Property 19: resolveSunsetISO cannot be sabotaged by config** — **Validates: Requirements 1.3, 1.4, 1.5, 1.8, 1.9**
    - Expressed as a biconditional over `junk()` and `isoDate()`: a valid `configuredISO` always wins, and every junk `configuredISO` falls through to the fallback rather than suppressing the notice
    - Pure function property — `{ numRuns: 100 }`, appended to `src/lib/__tests__/opsSunset.property.test.js`
    - _Requirements: 1.3, 1.4, 1.5, 1.8, 1.9_

  - [x]* 1.6 Write unit tests for the worked examples from the design
    - New file `src/lib/__tests__/opsSunset.test.js`: 4 August 2026 → 28 days; 18 August → 14; 29 August → 3; 1 September at 00:01 and at 23:59 WIB → 0 both times; 2 September → −1
    - The four `resolveSunsetISO` precedence cases, and `formatSunsetDate('2026-09-01') === '1 September 2026'`
    - Purpose is documentation: the properties prove the invariants, these show what the numbers are on the dates that matter
    - _Requirements: 1.11, 2.8, 2.9, 2.10, 10.8_

- [x] 2. Add phase selection and the phase copy table
  - [x] 2.1 Implement `sunsetPhase`, `phaseRank`, `isDismissible` and the copy table in `src/lib/opsSunset.js`
    - `sunsetPhase(days)`: `null` unless `Number.isInteger(days)`; then ordered most-past first — `< 0 → 'past'`, `=== 0 → 'final'`, `<= 3 → 'urgent'`, `<= 14 → 'warning'`, else `'notice'`, so the chain is total over the integers
    - `phaseRank(phase)`: the zero-based index in `SUNSET_PHASES`, `-1` for anything else including `'Warning'`, a padded string, or a non-string
    - `isDismissible(phase)`: `phase !== 'final' && phase !== 'past'`
    - One module-level copy table keyed by phase carrying `tone` (equal to the phase name), `icon` (`Info`, `AlertTriangle`, `AlertCircle`, `AlertCircle`, `Archive`), a headline template and a detail template; the five headlines differ from each other case- and whitespace-insensitively, every detail template renders to at most 240 characters, and none contains a colour word as its only signal
    - `badgeFor(phase, days)`: `"<n>d"` while the phase is live, `'retired'` in `past`; at most 8 characters
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 3.12, 3.14, 3.15, 5.10, 6.1, 6.2, 6.6_

  - [x]* 2.2 Write property tests for phase selection
    - **Property 7: sunsetPhase is total over the integers** — **Validates: Requirements 3.7, 3.8**
    - **Property 8: Severity never decreases as the deadline approaches** — **Validates: Requirements 3.9, 3.10**
    - **Property 9: The thresholds sit exactly where the table says** — **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6**
    - **Property 10: final and past are never dismissible, the other three always are** — **Validates: Requirements 5.10**
    - Boundary pairs in Property 9 are checked directly rather than generated: `(15,'notice')`, `(14,'warning')`, `(4,'warning')`, `(3,'urgent')`, `(1,'urgent')`, `(0,'final')`, `(-1,'past')`
    - Pure function properties — `{ numRuns: 100 }`, appended to `src/lib/__tests__/opsSunset.property.test.js`
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.14, 5.10_

  - [x]* 2.3 Write unit tests for the copy table
    - Appended to `src/lib/__tests__/opsSunset.test.js`: five phases each carry a distinct tone; the icon names are exactly the five the design lists; the five headlines are pairwise distinct with case ignored and whitespace collapsed; `urgent` and `final` share `AlertCircle` and are separated by headline and by `dismissible`
    - Every rendered `detail` is at most 240 characters and every rendered `headline` at most 120
    - _Requirements: 3.11, 3.12, 3.15, 10.2, 10.4_

- [x] 3. Add dismissal reading, writing and validation
  - [x] 3.1 Implement `readDismissal`, `recordDismissal`, `clearDismissal` and `isDismissed` in `src/lib/opsSunset.js`
    - Storage is passed in, never reached for, following the pattern in `src/lib/tour.js`; `null` storage is a normal case
    - `readDismissal(storage)`: `null` for absent storage, a throwing `getItem`, a missing key, unparseable JSON, a non-object, a `phase` outside `SUNSET_PHASES`, or a non-finite `at`; otherwise `{ phase, at }`
    - `recordDismissal(phase, nowMs, storage)`: write `{"phase":…,"at":…}` under `DISMISS_KEY`, replacing any existing record so exactly one remains; `true` on success, `false` when storage is absent or throws
    - `clearDismissal(storage)`: `removeItem` under `DISMISS_KEY`, `true` on success, `false` when storage is absent or throws
    - `isDismissed(phase, dismissal, nowMs)`: `true` only for a well-formed record whose `phase` matches and whose `at <= nowMs`; a record stamped in the future is discarded, so one machine with a fast clock cannot hide the deadline for good
    - No function in this group throws for any input, and none reads a clock
    - _Requirements: 5.1, 5.4, 5.6, 5.7, 5.8, 5.9, 5.12, 5.13, 5.14, 13.3_

  - [x]* 3.2 Write property tests for dismissal
    - **Property 11: Recording then reading round-trips** — **Validates: Requirements 5.4, 5.13**
    - **Property 12: A dismissal suppresses exactly one phase** — **Validates: Requirements 5.6**
    - **Property 13: A dismissal from the future is ignored** — **Validates: Requirements 5.8**
    - **Property 14: Junk in storage means not dismissed** — **Validates: Requirements 5.7, 5.9, 5.14, 13.3**
    - Property 14 covers both junk written raw into the key and a storage whose `getItem` throws, asserting `readDismissal` returns `null`, `isDismissed` returns `false`, and neither throws
    - Pure function properties — `{ numRuns: 100 }`, appended to `src/lib/__tests__/opsSunset.property.test.js`
    - _Requirements: 5.4, 5.6, 5.7, 5.8, 5.9, 5.13, 5.14, 13.3_

- [x] 4. Assemble the notice view model
  - [x] 4.1 Implement `sunsetNotice({ sunsetISO, nowMs, storage })` in `src/lib/opsSunset.js`
    - `{ visible: false }` and nothing else when `daysUntilSunset` returns `null` — a broken date shows nothing rather than "closes in NaN days"
    - `{ visible: false }` when the phase is dismissible and `isDismissed(phase, readDismissal(storage), nowMs)`; a record naming `final` or `past` is ignored, so those two phases stay visible
    - Otherwise the full model: `visible`, `phase`, `days`, `sunsetISO`, `dismissible`, `tone`, `icon`, `headline`, `detail`, `badge`, with `headline` and `detail` interpolated from the copy table using `days` and `formatSunsetDate(sunsetISO)`
    - `days` is always an integer; no field ever stringifies to include `NaN`, `undefined` or `Invalid`; the call never throws for any argument, including a storage that throws on `getItem` and an absent `storage` key
    - `dismissible` is exactly `isDismissible(phase)`
    - _Requirements: 3.16, 5.5, 5.15, 6.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.10, 10.12, 13.5_

  - [ ]* 4.2 Write property tests for the assembled notice
    - **Property 15: Dismissal never hides final or past** — **Validates: Requirements 5.15, 6.3**
    - **Property 16: A visible notice is always fully populated** — **Validates: Requirements 10.1, 10.2, 10.3, 10.12**
    - **Property 17: detail never exceeds 240 characters** — **Validates: Requirements 10.4**
    - **Property 18: A broken date shows nothing, and never NaN** — **Validates: Requirements 3.16, 10.5, 10.6, 10.10**
    - **Property 20: sunsetNotice never throws** — **Validates: Requirements 10.7, 13.5**
    - Property 20 runs the full cross-product of `junk()` dates, arbitrary instants, and storages that throw on `getItem`, wrapped in `expect(() => …).not.toThrow()`
    - Pure function properties — `{ numRuns: 100 }`, appended to `src/lib/__tests__/opsSunset.property.test.js`
    - _Requirements: 3.16, 5.15, 6.3, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.10, 10.12, 13.5_

- [ ] 5. Checkpoint - the pure module is complete and green
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add the configuration entry
  - [x] 6.1 Add `oldOpsSunset` to `src/app/api/new/config/route.js`
    - One `SETTINGS` entry: `oldOpsSunset: { default: null, describe: 'Retirement date for Old Operations, as "YYYY-MM-DD" in WIB.' }`, which puts the key into `KEYS` and so into the GET, PUT and DELETE allowlists with no other change to those handlers
    - One `validate` branch: `null` is valid; otherwise the value must be a string that `isoDayIndex` from `@/lib/opsSunset` accepts, so `"2028-02-29"` passes and `"2026-02-30"`, `"2026-13-01"`, `"2027-02-29"`, `"2026-9-1"`, `" 2026-09-01 "`, `"1 Sept"`, numbers, booleans, arrays and objects are refused with a message naming the expected `"YYYY-MM-DD"` format
    - No range check — a date in the past is a legitimate Admin action, and the existing 400 path already returns the message
    - Authentication, the Admin gate and `auditAccountAction` are the route's existing paths and are not touched
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11_

  - [x]* 6.2 Write unit tests for the `oldOpsSunset` validation
    - New file `src/app/api/new/config/__tests__/route.oldOpsSunset.test.js`, following the shape of the existing new-ops route tests: `validate` accepts `null` and every real calendar date including `2028-02-29`, and refuses each rejected value from Req 11.7 with a message naming `YYYY-MM-DD`
    - Assert the key is present in `SETTINGS` with default `null`, and that a past date is accepted
    - _Requirements: 11.1, 11.5, 11.6, 11.7, 11.8_

- [x] 7. Build the hook that supplies the clock and the configured date
  - [x] 7.1 Create `src/components/ops/useSunsetNotice.js`
    - `'use client'`; `useSunsetNotice(opsMode)` returns `{ notice, dismiss, refresh }` and delegates every day count, phase and dismissal decision to `@/lib/opsSunset`, computing none of its own
    - Seed `nowMs` from `Date.now()` on mount so the first render already carries a notice computed from `OLD_OPS_SUNSET_ISO`, with no loading state and no placeholder
    - Re-read `nowMs` on a 60-second interval and on `visibilitychange` when `document.visibilityState === 'visible'`; the interval is the only timer and it fires no fetch
    - One `GET /api/new/config?key=oldOpsSunset` per mount, guarded by a ref so a re-render, a dismissal, a page change or a visibility change cannot issue a second; abort it after 10 seconds through an `AbortController` and treat that as failure
    - Feed the response through `resolveSunsetISO(OLD_OPS_SUNSET_ISO, value)`, so a failed, unauthorised or malformed response silently leaves the constant in place with no toast and no retry control
    - Short-circuit when `opsMode !== 'old'`: return `{ visible: false }`, start no interval, add no listener and issue no request; when `opsMode` changes to `'old'`, re-read the clock and issue the one request if it has not already been issued during this mount
    - `dismiss()` calls `recordDismissal(notice.phase, nowMs, storage)` once and recomputes; a storage write that fails still hides the notice for the rest of the mount
    - Cleanup on unmount clears the interval, removes the listener, aborts any outstanding request and performs no further state update
    - _Requirements: 1.2, 1.6, 1.7, 1.10, 4.2, 6.9, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 13.1, 13.2, 13.4, 13.6, 13.7_

  - [x]* 7.2 Write unit tests for the hook
    - New file `src/components/ops/__tests__/useSunsetNotice.test.jsx` using `renderHook`, fake timers and a stubbed `fetch`: the first render carries a notice before any response; one request per mount across a re-read, a `visibilitychange`, a dismissal and a page change; the 60-second re-read recomputes across a WIB midnight; a failed and a timed-out response leave the constant in place with no error surfaced
    - `opsMode: 'new'` returns `{ visible: false }` with `fetch` never called and no interval started; unmount clears the interval and the listener and no state update follows
    - _Requirements: 1.2, 1.7, 4.2, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.10, 13.1, 13.2, 13.6, 13.7_

- [x] 8. Build the banner and its styles
  - [x] 8.1 Create `src/components/ops/OpsSunsetBanner.jsx`
    - `'use client'`; props `{ notice, onDismiss, onShowMe }`; returns `null` when `notice` is absent, is not an object, or `notice.visible !== true`, so an invalid model renders no wrapper, no border and no margin
    - Outermost element carries `data-tour="sunset-banner"`, `role="status"`, `aria-live="polite"` and a tone class from `notice.tone`; no `role="alert"` and no `aria-live="assertive"` in any phase
    - Renders, in order: the `lucide-react` icon named by `notice.icon` (`Info`, `AlertTriangle`, `AlertCircle`, `Archive`) marked `aria-hidden="true"`, the `headline` text, the `detail` text, and a native `<button>` whose accessible name is exactly "Show me New Operations"
    - A dismiss button only when `notice.dismissible`, with an `aria-label` naming both the action and the notice and matched by a case-insensitive search for "dismiss"; on activation it calls `onDismiss` once and moves focus to an element that survives the banner's removal
    - Reads only fields of the supplied model — no clock, no arithmetic, no `opsSunset` day-count or phase call, and no `dangerouslySetInnerHTML`
    - Calls no focus method on appearance and renders no `autofocus`, so the notice never takes focus from what the user was typing
    - Any `matchMedia` use is wrapped, so a host without it or one that throws still renders the text, the icon and the buttons
    - _Requirements: 4.5, 4.6, 4.7, 4.8, 4.11, 5.2, 5.3, 5.11, 6.1, 6.2, 6.11, 7.9, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.9, 9.10, 9.11, 10.10_

  - [x] 8.2 Add the sunset styles to `src/app/globals.css`
    - A new `/* ── Old Operations sunset ── */` section: `.ops-sunset-banner` with `var(--panel-bg)` as the surface (never `--card-bg`, which does not exist here and renders transparent), a `slide-down` entrance of 220ms once, and one tone class per phase
    - `.ops-sunset-banner-urgent` border pulse at 2400ms, matching the `tour-pulse` cadence so the two do not fight when the tour runs over the banner; applied in `urgent` and `final` only
    - `.ops-sunset-badge`: no animation and no transition at all, since movement inside a control the user clicks reads as a fault, and no layout change between renders at the same value
    - A `@media (prefers-reduced-motion: reduce)` branch setting `animation: none` on the banner, the icon and the badge while leaving position and size untouched
    - Each tone's text colour reaches at least 4.5:1 against `var(--panel-bg)` for headline, detail and button labels; the amber `warning` tone reuses `#b45309` from the severity map in `Header.jsx`
    - This task is the only writer of `globals.css` in this plan
    - _Requirements: 8.4, 9.7, 9.8_

  - [x]* 8.3 Write property tests for the banner
    - **Property 23: The day count reaches the accessibility tree** — **Validates: Requirements 9.1, 9.3**
    - **Property 24: The dismiss control exists exactly when the notice is dismissible** — **Validates: Requirements 5.2, 5.11, 9.5**
    - **Property 25: An invisible notice renders nothing** — **Validates: Requirements 4.6, 10.10**
    - **Property 26: Reduced motion removes the movement, not the message** — **Validates: Requirements 9.7, 9.11**
    - DOM-driven properties — each example mounts and tears down a tree, so `{ numRuns: 20 }` per the repo convention
    - New file `src/components/ops/__tests__/OpsSunsetBanner.property.test.jsx`, jsdom plus `@testing-library/react`; colour is never asserted on, because colour is never the only signal
    - _Requirements: 4.6, 5.2, 5.11, 9.1, 9.3, 9.5, 9.7, 9.11, 10.10_

  - [x]* 8.4 Write unit tests for the banner's accessibility details
    - New file `src/components/ops/__tests__/OpsSunsetBanner.test.jsx`: exactly one `role="status"` with `aria-live="polite"` and no `role="alert"` or `aria-live="assertive"` in any phase; the phase icon is hidden from assistive technology and the phase is stated in the live region's text
    - Focus stays on a text input that held it when the banner appears; after dismissing, focus is on neither the removed button nor `document.body`; the "Show me New Operations" control is a native button with no negative `tabindex`, activated by Enter and by Space
    - `past` renders the formatted date in day, month name, year order and no dismiss button; a `matchMedia` that throws still renders text, icon and buttons
    - _Requirements: 6.2, 9.1, 9.2, 9.4, 9.6, 9.9, 9.10, 9.11_

  - [x]* 8.5 Write static assertions over the sunset stylesheet
    - New file `src/app/__tests__/sunsetStylesheet.test.js`, following `printStylesheet.test.js`: parse the sunset section of `globals.css` and assert the `prefers-reduced-motion` branch sets `animation: none` for the banner and the icon, that `.ops-sunset-badge` declares no animation or transition, and that every tone's text colour computes at least 4.5:1 against the `--panel-bg` value
    - _Requirements: 8.4, 9.7, 9.8_

- [ ] 9. Checkpoint - the banner renders in isolation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Wire the banner and the badge into the shell
  - [x] 10.1 Mount the banner in `src/components/layout/AppShell.jsx`
    - Call `useSunsetNotice(opsMode)` and render `{opsMode === 'old' && <OpsSunsetBanner … />}` inside `main.dashboard-container`, between `<Header …/>` and `<div className="dashboard-views">`, so the document order is Header, banner, views, with the banner outside both and outside `PageComponent` — one mount whichever page is active, and it cannot scroll away with the views
    - Add `showMeNewOps`: expand the sidebar when `sidebarCollapsed`, then `requestAnimationFrame(() => start('ops-sunset'))`, so the switcher is laid out before `GuidedTour` measures it; wire it to `onShowMe`, and `dismiss` to `onDismiss`
    - Pass `sunsetLive={notice.phase !== 'past'}` and `sidebarCollapsed` to `TourProvider`, and `sunsetBadge` to `Sidebar`
    - No redirect, no `opsMode` change and no read-only behaviour in any phase — nothing about the shell varies with the phase except the model fields the banner renders
    - `useTour()` is consumed inside the tree `TourProvider` wraps, so the callback lives in a child of the provider rather than in `AppShell`'s own body if the current nesting requires it
    - _Requirements: 3.13, 4.1, 4.3, 4.4, 4.9, 4.10, 4.11, 6.5, 6.10, 6.11, 7.9, 13.6, 13.8_

  - [x] 10.2 Add the Switcher_Badge to `src/components/layout/Sidebar.jsx`
    - Accept a `sunsetBadge` prop and render `<span className="ops-sunset-badge" aria-hidden="true">{sunsetBadge}</span>` inside the existing Old Operations `switcher-tab` button, in both `opsMode` values and both collapsed states
    - Render nothing when the value is absent, not a string, or empty, leaving the tab and its label unchanged and surfacing no error
    - Display the supplied string exactly — no truncation, no ellipsis, no added text, no date, no headline and no control of its own; a press anywhere on it, badge included, still sets `opsMode` to `'old'` on one press
    - The badge is decoration: every fact it carries is also in the banner, hence `aria-hidden`
    - _Requirements: 6.4, 6.6, 8.1, 8.2, 8.3, 8.5, 8.6, 8.7, 13.9_

  - [x]* 10.3 Write unit tests for the badge
    - New file `src/components/layout/__tests__/Sidebar.sunsetBadge.test.jsx`: exactly one badge on the Old Operations tab in both `opsMode` values; it carries `aria-hidden="true"` and contributes nothing to the tab's accessible name; the string renders verbatim; an absent, non-string or empty value renders no badge element
    - Clicking the badge calls `setOpsMode('old')` once; the `past` value `retired` renders with no digits
    - _Requirements: 6.6, 8.1, 8.2, 8.3, 8.5, 8.6, 8.7_

- [x] 11. Register the tour and add the precedence rule
  - [x] 11.1 Add the `ops-sunset` entry to `src/lib/tourSteps.js`
    - One `TOURS['ops-sunset']` entry, `version: 1`, title "Moving to New Operations", three steps in order targeting `[data-tour="sunset-banner"]`, `[data-tour="ops-switcher"]` and `[data-tour="sidebar-nav"]`, with the copy from the design
    - Every `title` 1–80 characters and every `body` 1–240 characters, so the existing `tourSteps.test.js` guards cover it without a new test file
    - Not added to `TOUR_ORDER` and not mapped by `tourForPage`: it is not a page tour, it is offered by the D6 rule and by the banner's button
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 11.2 Add `chooseAutoTour` to `src/lib/tour.js` and apply it in `TourProvider.jsx`
    - `chooseAutoTour({ welcomeSeen, sunsetSeen, opsMode, sidebarCollapsed, sunsetLive })` in `src/lib/tour.js`, pure and DOM-free like the rest of that module: `'welcome'` whenever `welcomeSeen` is false regardless of every other field, then `null` for `sunsetSeen`, `opsMode !== 'old'`, `!sunsetLive` or `sidebarCollapsed`, else `'ops-sunset'`
    - `TourProvider` accepts `sunsetLive` and `sidebarCollapsed`, and its existing settle effect calls `chooseAutoTour` instead of testing `welcome` inline — one place decides, so two tours cannot race
    - The existing `autoStarted` ref still caps automatic starts at one per session; a manual `start('ops-sunset')` from the banner does not touch it and runs whatever the seen state
    - Unreadable tour storage means no automatic tour, while the manual start still works; leaving early keeps the existing `dismiss` path, which marks the tour seen at its version; a `page` or `opsMode` change while it runs keeps the existing stop-and-leave-seen-state behaviour
    - _Requirements: 6.7, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.12, 7.13, 7.14_

  - [x]* 11.3 Write property tests for tour precedence
    - **Property 21: The welcome tour always wins** — **Validates: Requirements 7.4**
    - **Property 22: The sunset tour is offered only under all four conditions** — **Validates: Requirements 6.7, 7.5, 7.6, 7.7**
    - Property 22 is one biconditional over generated state, so a later change to the rule cannot quietly loosen it
    - Pure function properties — `{ numRuns: 100 }`, appended to the existing `src/lib/__tests__/tour.property.test.js`, because `chooseAutoTour` lives in `tour.js` alongside the functions that file already covers
    - _Requirements: 6.7, 7.4, 7.5, 7.6, 7.7_

  - [x]* 11.4 Write unit tests for `TourProvider`'s sunset behaviour
    - New file `src/components/tour/__tests__/TourProvider.sunset.test.jsx`: with `welcome` seen, the sunset tour unseen, `opsMode: 'old'`, a live phase and the sidebar expanded, the tour starts after the 900ms settle and only once per session even after `page`, `opsMode`, sidebar and phase changes
    - A collapsed sidebar, a seen sunset tour, `opsMode: 'new'` and a `past` phase each yield no automatic tour with the sidebar and seen state untouched; storage that throws yields no automatic tour but the manual start still runs
    - Leaving at any step marks the tour seen at version 1 and removes the overlay with `opsMode` and the sidebar unchanged; a `page` change mid-tour stops it, leaves the seen state alone and starts no replacement; with one or two anchors absent the tour runs and counts only the present steps, and with none present it renders no overlay and leaves the seen state alone
    - _Requirements: 6.7, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15_

- [ ] 12. Integration tests across the shell
  - [ ]* 12.1 Write the layout integration suite for the notice
    - New file `src/components/layout/__tests__/AppShell.sunset.test.jsx`, with `fetch` stubbed and the clock controlled: exactly one `[data-tour="sunset-banner"]` in `opsMode: 'old'`, positioned between the header and `.dashboard-views` and outside both, and zero such elements in `opsMode: 'new'` with no config request issued and no date arithmetic performed
    - Phase escalation: advancing the controlled clock across the 14→3 and 1→0 boundaries replaces headline, icon and tone on the next render with no reload, and crossing out of the deadline's own WIB day replaces the `final` copy with the `past` copy
    - Dismissal round trip: dismissing in `warning` hides the banner, a reload at a later `warning` day keeps it hidden, and the same reload once the phase is `urgent` shows it again
    - Final and past: no dismiss button, the banner survives navigation between Old Operations pages and a reload whatever record is in storage, both halves of the switcher still change `opsMode` on one press with no prompt, and the badge reads `retired`
    - The banner stays mounted across a change of active page, so exactly one banner element exists on every page
    - _Requirements: 3.13, 4.1, 4.3, 4.9, 4.10, 5.5, 5.6, 5.11, 6.3, 6.4, 6.5, 6.9, 6.10, 8.1, 13.6, 13.8_

- [ ] 13. Final checkpoint - full suite green
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Pure-function property tests run at `{ numRuns: 100 }`; the banner properties (23–26) run at `{ numRuns: 20 }` because each example mounts a component tree, matching `WipeStudentsDialog.property.test.jsx` and `NewStudentsPage.wipe.property.test.jsx`.
- Every property test carries `// Feature: old-operations-sunset-notice, Property N: <title>` above its `it`, with `Req x.y` references inside the assertions.
- `src/lib/opsSunset.js` has five writers (1.1, 1.4, 2.1, 3.1, 4.1) and `src/lib/__tests__/opsSunset.property.test.js` has five (1.2, 1.5, 2.2, 3.2, 4.2); both sets sit in different waves throughout. `src/lib/__tests__/opsSunset.test.js` has two (1.6, 2.3), also in different waves. `globals.css` has exactly one writer (8.2).
- Property 5 lives in its own file because `process.env.TZ` has to be set before the first `Date` in a file, which cannot be done per-`describe` inside the main property file.
- Properties 21 and 22 go into the existing `src/lib/__tests__/tour.property.test.js` rather than the sunset property file, because `chooseAutoTour` belongs in `src/lib/tour.js` with the other pure tour mechanics.
- No new test file is added for the tour content: `src/lib/__tests__/tourSteps.test.js` already iterates every entry in `TOURS`, so registering `ops-sunset` brings it under the `data-tour` selector and 240-character body guards for free.
- Nothing is removed by this plan. No Old Operations view, route or service is deleted, no page is made read-only, and the switcher keeps switching in both directions in every phase.
- The host clock is deliberately not corrected against server time (design, Error Handling): a badly wrong clock yields a real phase and never a `NaN`, and that is the whole mitigation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "11.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "6.1", "11.2"] },
    { "id": 2, "tasks": ["1.3", "1.5", "2.1", "6.2", "11.3"] },
    { "id": 3, "tasks": ["1.6", "2.2", "3.1", "11.4"] },
    { "id": 4, "tasks": ["2.3", "3.2", "4.1"] },
    { "id": 5, "tasks": ["4.2", "7.1", "8.1", "8.2", "10.2"] },
    { "id": 6, "tasks": ["7.2", "8.3", "8.5", "10.3"] },
    { "id": 7, "tasks": ["8.4", "10.1"] },
    { "id": 8, "tasks": ["12.1"] }
  ]
}
```
