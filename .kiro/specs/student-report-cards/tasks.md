# Implementation Plan: Student Report Cards / Learning Journey Evaluator

## Overview

Implementation language is **JavaScript with JSDoc** (decision E in the design) — no TypeScript,
matching the rest of the repository. Tests are Vitest (`npm run test`) plus fast-check `4.9.0`,
with integration tests under `npm run test:integration`.

Order of work follows the dependency direction in the design: dependencies and schema first,
then the pure modules (`reportCardRubric.js`, `reportCard.js`, `evaluationValidation.js`,
`reportCardBranding.js`, `studentFilter.js`) which are testable with no React and no database,
then the two API routes, the client services, the chart components, the UI, the print stylesheet,
the navigation wiring, and finally the documentation and verification passes.

Property-test run counts follow the convention already in the repo: pure-function properties run
at `{ numRuns: 100 }` (as in `src/lib/__tests__/wipeReporting.property.test.js`), DOM-driven
properties that mount a component tree per example run at `{ numRuns: 20 }` (as in
`src/views/__tests__/NewStudentsPage.wipe.property.test.jsx` and
`src/components/operations/__tests__/WipeStudentsDialog.property.test.jsx`). Every property test
carries the header comment `// Feature: student-report-cards, Property N: <title>` immediately
above its `it`, with `Req x.y` references inside the assertions.

## Tasks

- [x] 1. Add the charting dependencies
  - [x] 1.1 Install `chart.js` and `react-chartjs-2` pinned exactly
    - Add `"chart.js": "4.5.0"` and `"react-chartjs-2": "5.3.1"` to `dependencies` in `package.json`
    - Pin without `^`, matching how this repo already pins (`next: 16.2.5`, `fast-check: 4.9.0`, `vitest: 4.1.10`)
    - Run `npm install` and confirm the resolved tree has no peer-dependency error against `react`/`react-dom` `19.2.4`; `react-chartjs-2` 5.3.0 is the release that added React 19 support
    - Confirm `npm run build` still succeeds and record the actually resolved versions — the design chose them from release notes, not from an installed tree
    - _Requirements: 3.8, 5.10_

- [x] 2. Provision the two new tables
  - [x] 2.1 Add the `DEFINITIONS` entries to `src/lib/ensureSchema.js`
    - `internal_student_evaluations`: `SERIAL` id, `student_id INTEGER NOT NULL`, `eval_date DATE NOT NULL DEFAULT CURRENT_DATE`, `lesson_topic TEXT`, the five score columns `NOT NULL CHECK (… BETWEEN 1 AND 5)`, `instructor_notes TEXT`, `instructor_name VARCHAR(255)`, timestamps, `UNIQUE (student_id, eval_date)`, the `(student_id, eval_date)` index and the changetimestamp trigger step
    - `internal_student_terms`: `SERIAL` id, `student_id INTEGER NOT NULL`, `term_year INTEGER NOT NULL CHECK (BETWEEN 2000 AND 2100)`, `term_number INTEGER NOT NULL CHECK (BETWEEN 1 AND 4)`, `paid BOOLEAN NOT NULL DEFAULT FALSE`, `paid_at DATE`, `note TEXT`, timestamps, `UNIQUE (student_id, term_year, term_number)`, index and trigger step
    - No foreign key on `student_id` (the app's DB user does not own `internal_students`); no `is_current` and no `is_start` column, and no price, currency or invoice column
    - Column names are `eval_date` and `term_year`, never `date` or `year`
    - _Requirements: 1.6, 2.13, 4.4, 4.10_

  - [x]* 2.2 Write unit tests for the two schema definitions
    - Assert each of the five score columns is `NOT NULL` and carries a `BETWEEN 1 AND 5` check
    - Assert both unique constraints are present and that neither definition declares a current-term or start-term column, nor a price/currency/invoice column
    - _Requirements: 1.6, 4.4, 4.10_

  - [x] 2.3 Mirror both tables in `init_db.sql`
    - Add the two `CREATE TABLE IF NOT EXISTS` statements and their indexes so a hand-initialised database matches what `ensureTable()` creates
    - _Requirements: 1.6, 4.4_

- [x] 3. Build the rubric module
  - [x] 3.1 Create `src/lib/reportCardRubric.js`
    - Export `COMPETENCIES` (the five `{ key, column, label, color }` entries) and `RUBRIC_LEVELS` with all 25 descriptors
    - Levels 1 and 5 verbatim from the brief; levels 2–4 as the provisional wording, with a comment stating they need the rubric owner's sign-off
    - Export `descriptorFor(competencyKey, rating)`: returns the descriptor for a known key and an integer rating in `[1,5]`, `''` for anything else, never `undefined`, never throws
    - This module is the only place rubric text lives — no descriptor string in any component
    - _Requirements: 1.14, 1.15, 1.16_

  - [x]* 3.2 Write property test for the rubric
    - **Property 14: The rubric is complete and lookup is total**
    - **Validates: Requirements 1.14, 1.16, 1.17**
    - Pure function property — `{ numRuns: 100 }`
    - File: `src/lib/__tests__/reportCardRubric.property.test.js`

  - [x]* 3.3 Write unit tests for the rubric wording
    - 25 cells present and non-empty; the five descriptors within a competency are distinct
    - Level 1 and level 5 wording matches the brief character for character
    - _Requirements: 1.14, 1.15_

- [x] 4. Build the derivation module `src/lib/reportCard.js`
  - [x] 4.1 Implement `competencyAverages` and `overallGrade`
    - `competencyAverages(evaluations)`: `null` for an empty list, otherwise the five unrounded means, order-independent, input not mutated
    - `GRADE_BANDS` descending table, `NOT_ASSESSED = { score: null, label: 'NOT YET ASSESSED', rank: 0 }`
    - `overallGrade(averages)`: round the mean to one decimal **first**, then band the rounded score, so the printed number and the printed label cannot contradict each other
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x]* 4.2 Create the shared fast-check arbitraries
    - `src/lib/__tests__/helpers/reportCardArbitraries.js`: a valid evaluation (five `fc.integer({ min: 1, max: 5 })` plus an ISO date), a deliberately invalid score, and a term row (`year` 2024–2030, `termNumber` 1–4, `paid` boolean)
    - _Requirements: 3.1, 4.1_

  - [x]* 4.3 Write property tests for averages and the overall grade
    - **Property 1: Averages are in range and total** — **Validates: Requirements 3.1, 3.4**
    - **Property 2: Averages are order-independent** — **Validates: Requirements 3.1**
    - **Property 3: The overall score is the grand mean** — **Validates: Requirements 3.2**
    - **Property 4: Banding is total and monotone** — **Validates: Requirements 3.3**
    - **Property 5: The printed number and the printed label agree** — **Validates: Requirements 3.3, 3.7**
    - **Property 6: No evaluations means no number** — **Validates: Requirements 3.4, 5.12**
    - Pure function properties — `{ numRuns: 100 }`
    - File: `src/lib/__tests__/reportCard.property.test.js`

  - [x] 4.4 Implement `lessonSeries`
    - Sort ascending by `(date, id)`; window from `LESSONS_PER_LEVEL` imported from `src/lib/programRules.js`, never a new literal
    - Emit the last `min(n, window)` records with their **true** ordinals (`L7`…`L16`), equal-length `labels`, `values` and `dates`; input not mutated
    - _Requirements: 2.7, 3.5, 3.6_

  - [x]* 4.5 Write property tests for the lesson series
    - **Property 7: Lesson labels are contiguous true ordinals** — **Validates: Requirements 3.5, 3.6**
    - **Property 8: Series order is date order** — **Validates: Requirements 2.7, 3.5**
    - Pure function properties — `{ numRuns: 100 }`

  - [x] 4.6 Implement `termSummary`
    - Selected year defaults to the greatest year present, else the current calendar year
    - `startTerm` = `(year, termNumber)` minimum over all rows; `currentTerm` = maximum over paid rows only, else `null`
    - Exactly four badges `T1`…`T4` from rows in the selected year, states `paid`/`unpaid`/`absent`, `current` true only when `currentTerm.year` is the selected year
    - _Requirements: 4.1, 4.2, 4.3, 4.7, 4.8_

  - [x]* 4.7 Write property tests for the term summary
    - **Property 12: Four badges, at most one current** — **Validates: Requirements 4.1, 4.2, 4.6, 4.8**
    - **Property 13: The current term never precedes the start term** — **Validates: Requirements 4.3, 4.4, 4.7**
    - Pure function properties — `{ numRuns: 100 }`

  - [x]* 4.8 Write unit tests for the worked examples
    - `src/lib/__tests__/reportCard.test.js`: the screenshot's `EXCELLENT (4.8/5)`, each band boundary at `4.5 / 3.5 / 2.5 / 1.5`, and `n = 0`, `n = 1`, `n = 10`, `n = 11`
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

- [x] 5. Checkpoint - pure derivations green
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Build the payload validator
  - [x] 6.1 Create `src/lib/evaluationValidation.js`
    - `validateEvaluationPayload(body)` returns exactly one of `{ value }` or `{ error }`
    - `studentId` a positive integer; a missing or blank `date` defaults to the server's current `YYYY-MM-DD`; a malformed or unreal date is an error naming the field and carrying the received value
    - Each of the five scores must be an integer in `[1,5]` — a missing score errors naming that competency, an out-of-range score errors naming the competency and the received value, and nothing is ever clamped or defaulted
    - `lessonTopic`/`instructorNotes`/`instructorName` optional; `instructorName` trimmed and at most 255 characters; `body` not mutated
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9_

  - [x]* 6.2 Write property test for validation
    - **Property 9: Validation accepts exactly the valid payloads**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.8, 1.9**
    - Pure function property — `{ numRuns: 100 }`
    - File: `src/lib/__tests__/evaluationValidation.property.test.js`

  - [x]* 6.3 Write unit tests for each rejection message
    - One case per `400` row of the design's error table, asserting the message names the offending field
    - _Requirements: 1.3, 1.4, 1.8, 1.9_

- [x] 7. Build the branding and shared-filter modules
  - [x] 7.1 Create `src/lib/reportCardBranding.js`
    - Export the printed academy header text, the report title, the Academic Director name and the default Lead Instructor name as configuration
    - The prototype values are placeholders from a mock and live only here — no academy name and no person's name written into a component
    - _Requirements: 5.2, 5.3_

  - [x] 7.2 Create `src/lib/studentFilter.js`
    - Extract the filter predicate from `NewStudentsPage`: case-insensitive `search` across name, parent name and contact, plus branch and status equality, applying `normaliseCoderLevel` when comparing levels
    - Also export the program-category resolver used to partition students into `Kinder`/`Junior`/`Coder` via `parseProgram(...).category`
    - Result is a subset of the input in the input's order
    - _Requirements: 6.7, 6.8_

  - [x]* 7.3 Write property tests for the shared filter
    - **Property 19: The program tabs partition the student list** — **Validates: Requirements 6.7**
    - **Property 20: The shared filter predicate is a filter** — **Validates: Requirements 6.8**
    - Pure function properties — `{ numRuns: 100 }`
    - File: `src/lib/__tests__/studentFilter.property.test.js`

  - [x] 7.4 Refactor `NewStudentsPage.jsx` to import the shared predicate
    - Replace the in-page filter expression with `studentFilter.js` so the two screens cannot filter differently; behaviour must be unchanged
    - This task touches `NewStudentsPage.jsx`; the Report button in task 16.3 touches the same file, so the two must not run concurrently
    - _Requirements: 6.8_

- [x] 8. Build the two API routes
  - [x] 8.1 Create `src/app/api/new/student-evaluations/route.js`
    - Module-level `mapRow` whitelist returning exactly the documented `Evaluation` keys (`date` from `eval_date`), omitting every other column including snake-case keys
    - `const ready = () => ensureTable('internal_student_evaluations')` awaited before the first query of every request
    - `POST`: validate through `validateEvaluationPayload`, then `INSERT … ON CONFLICT (student_id, eval_date) DO UPDATE … RETURNING *`
    - `buildEvaluationListQuery(searchParams)`: delegate `search`, the `studentId`/`instructorName` filters and `limit` to `buildListQuery`, then append `eval_date >= $n::date` / `eval_date <= $n::date`. `src/lib/listQuery.js` has **no** range-comparison support, so this is a documented local extension — every value stays a bind parameter and the `$n` count must equal `params.length`
    - `GET`: reject a `from`/`to` that is not `YYYY-MM-DD` with `400` naming the parameter and no records; order `eval_date ASC, id ASC`
    - `PUT`: `404 { error: 'Evaluation not found' }` on `rowCount === 0`; map PostgreSQL `23505` to `409` naming the clashing date and stating the existing day can be opened to edit it, leaving both rows unchanged
    - `DELETE`: `?id=` only, exactly one row, no bulk form
    - `catch (error)` → `500 { error: error.message }`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.13, 2.14_

  - [x]* 8.2 Write property tests for the evaluations route helpers
    - **Property 11: `mapRow` is a whitelist** — **Validates: Requirements 2.1, 4.10**
    - **Property 15: The list query stays parameterised** — **Validates: Requirements 2.4, 2.5**
    - Pure function properties over the exported helpers — `{ numRuns: 100 }`
    - File: `src/app/api/new/student-evaluations/__tests__/route.property.test.js`

  - [x] 8.3 Create `src/app/api/new/student-terms/route.js`
    - `mapRow` whitelist returning exactly the documented `StudentTerm` keys (`year` from `term_year`), with no price, currency or invoice key
    - `ensureTable('internal_student_terms')` before the first query; `POST` upserts on `(student_id, term_year, term_number)`
    - `400` naming the field and its bounds for a `termNumber` outside `1..4` or a `year` outside `2000..2100`, writing no record
    - `GET` accepts `studentId` and `year`; `404` and `500` handling as in the evaluations route
    - _Requirements: 2.1, 2.11, 2.12, 2.13, 2.14, 4.10_

  - [x]* 8.4 Write unit tests for the terms route bounds
    - Each out-of-bounds `termNumber` and `year` returns `400` naming the field and its permitted bounds and writes nothing
    - _Requirements: 2.11, 2.12_

- [x] 9. Checkpoint - API contracts green
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Build the client services
  - [x] 10.1 Create `src/services/studentEvaluationService.js`
    - Follow `internalStudentService.js`: a `const API_PATH`, one `fetch` per verb, `if (!res.ok) throw new Error(errData.error || …)` so the API's message reaches the form
    - `getEvaluations({ studentId, from, to })`, `saveEvaluation(payload)`, `updateEvaluation(payload)`, `deleteEvaluation(id)`; no polling — evaluations change only through this page's own save
    - _Requirements: 2.5, 2.14, 3.11_

  - [x] 10.2 Create `src/services/studentTermService.js`
    - `getTerms({ studentId, year })`, `saveTerm(payload)`, `deleteTerm(id)`, same error contract
    - _Requirements: 2.11, 2.14_

  - [x]* 10.3 Write unit tests for the two services
    - A rejected request throws carrying the API's `error` message verbatim; a successful request returns the mapped record
    - _Requirements: 1.13, 2.14_

- [x] 11. Build the chart components
  - [x] 11.1 Create `src/components/reportcards/CompetencyRadarChart.jsx`
    - `'use client'`; the only modules importing `chart.js` are these two — register just the scales and elements the radar needs
    - `animation: false`, `responsive: false`, explicit pixel width and height, `devicePixelRatio: 2`; memoise `data` and `options` on the derived arrays
    - Accept `averages === null` and render a stated "No evaluations yet" empty state rather than an empty axis
    - _Requirements: 3.8, 3.10, 5.10_

  - [x] 11.2 Create `src/components/reportcards/ProgressTrendChart.jsx`
    - Same client-only boundary and same chart options; plots `lessonSeries` labels, values and dates, with the date in the tooltip
    - Accepts an empty series and renders the same stated empty state
    - _Requirements: 3.8, 3.10, 5.10_

  - [x]* 11.3 Write unit tests for the chart components
    - With `chart.js` mocked: the empty state renders for `null`/empty data, and the options passed carry `animation: false`, `responsive: false` and `devicePixelRatio: 2`
    - _Requirements: 3.10, 5.10_

- [x] 12. Build the report card UI components
  - [x] 12.1 Create `src/components/reportcards/StudentSelectorPanel.jsx`
    - Three program tabs from the category resolver, plus the search, branch and status controls filtering through `studentFilter.js`
    - Branch options from `useSchedule()`; renders a stated prompt when the selected category holds no student
    - _Requirements: 6.6, 6.7, 6.8_

  - [x] 12.2 Create `src/components/reportcards/EvaluationForm.jsx`
    - Date, lesson topic, instructor `<select>`, five rating rows, instructor remarks, Save
    - Instructor options from `/api/new/instructors` **plus** the name already on the record when absent from that list; default in order: the instructor on this student's most recent evaluation → the signed-in user's matching instructor name (trim + case-fold) → empty
    - Each rating row is a keyboard-reachable `radiogroup` of five options whose accessible name states the score together with its `descriptorFor` descriptor, and the live italic descriptor line reads from the same call
    - Save disabled while any of the five scores is unrated or no instructor is chosen; on a rejected save show the API's message and retain every entered value
    - _Requirements: 1.10, 1.11, 1.12, 1.13, 1.17, 1.18_

  - [x]* 12.3 Write unit tests for the evaluation form
    - Save stays disabled until all five scores and an instructor are set; each option's accessible name carries the score and descriptor; a rejected save keeps the form values; the departed-instructor name stays selectable
    - _Requirements: 1.10, 1.12, 1.13, 1.18_

  - [x] 12.4 Create `src/components/reportcards/ScoringGuidelinesPanel.jsx`
    - One component with a `variant` prop serving both the compact reference beside the form and the full Standardized Scoring Table Guidelines view, rendering `RUBRIC_LEVELS` directly as a 5 × 5 grid
    - _Requirements: 1.16_

  - [x] 12.5 Create `src/components/reportcards/ReportCardDocument.jsx`
    - Root element id `report-card-print`; blocks in order: academy header, student row (name / instructor / current term / overall grade), Performance Breakdown radar, Competency Mastery Summary, Instructor Remarks, the `Lead Instructor` and `Academic Director` signature lines with a name beneath each
    - Header text and both signatory names read from `reportCardBranding.js`; the Lead Instructor line prints the evaluation's instructor name, falling back to the configured default
    - Competency Mastery Summary prints the same five values handed to the radar, each to one decimal followed by ` / 5.0`
    - Zero evaluations prints `NOT YET ASSESSED` with no numeric score and no `/5` text anywhere, the empty-state message in place of the radar, and stays printable
    - All free text rendered as React children — no `dangerouslySetInnerHTML`
    - _Requirements: 3.4, 3.7, 5.1, 5.2, 5.3, 5.12, 5.13_

  - [x]* 12.6 Write property tests for the report document
    - **Property 16: The chart and the printed summary carry the same numbers** — **Validates: Requirements 3.7**
    - **Property 18: Free text is rendered as text** — **Validates: Requirements 5.13**
    - DOM-driven properties — each example mounts a component tree, so `{ numRuns: 20 }` per the repo convention
    - File: `src/views/__tests__/NewStudentReportCardsPage.property.test.jsx`

- [x] 13. Build the page and wire the pieces together
  - [x] 13.1 Create `src/views/NewStudentReportCardsPage.jsx`
    - Props `{ onNavigate, params }`; owns selection, data loading and the `evaluate` | `preview` | `rubric` mode and nothing else derivable
    - Subscribe to students with the existing 3 s polling helper; load evaluations and terms once per student selection, not on a poll
    - Honour `params?.studentId` on first render and on each change, following the `LeavePage` precedent; otherwise select the first student of the current category
    - Load both charts through `next/dynamic` with `ssr: false`, and render the numeric Competency Mastery Summary in a chart slot whose dynamic import fails
    - Render the four term badges in visually distinct `paid`/`unpaid`/`absent` styles with an extra indicator on the current badge, and an em dash for a missing start or current term
    - On save: merge the returned record into the local list, recompute averages, grade, series and term summary, and write one `logActivity` entry with source `students`, treating a failed log write as a successful save
    - On a query failure keep the last successfully loaded data and show a retry toast
    - Preview mode lays the document out on screen at print proportions with a Back control and opens no OS dialog; Print / Export calls `window.print()`, first mounting the document off-screen-but-laid-out (`position: absolute; left: -10000px`, never `display: none`) when in evaluate mode
    - _Requirements: 2.14, 2.17, 3.8, 3.9, 3.11, 4.5, 4.6, 4.9, 5.4, 5.5, 5.6, 6.5, 6.6, 6.9, 6.10_

  - [x]* 13.2 Write property test for the save merge
    - **Property 17: Saving merges without duplicating a day**
    - **Validates: Requirements 3.11**
    - DOM-driven property — `{ numRuns: 20 }`
    - Same file as task 12.6, so the two must not run concurrently

  - [x]* 13.3 Write unit tests for the page
    - `params.studentId` pre-selects that student; the program tabs partition the student list; saving calls the service once; a student with no evaluations renders the empty state with no numeric score
    - Chart components mocked, so no canvas is needed in jsdom
    - _Requirements: 3.4, 6.5, 6.7, 6.10_

- [x] 14. Add the print stylesheet
  - [x] 14.1 Add the `@media print` block and report styles to `src/app/globals.css`
    - `display: none` on the app chrome itself — `.sidebar`, the header, `.panel-header` action rows, nav, toast container, `.no-print` — and on **no** ancestor of `#report-card-print` or of a chart canvas inside it
    - Clear `height`/`overflow` on `.dashboard-container` and `.dashboard-views`; `#report-card-print` gets `position: static; width: 100%; margin: 0`
    - `@page { size: A4; margin: 12mm; }`, `break-inside: avoid` on each report block, and `print-color-adjust: exact` (plus `-webkit-` prefix) on the report root
    - A stated "select a student" notice prints when no student is selected, rather than a blank page
    - No print stylesheet exists in the repo today, so nothing conflicts. This task is the only writer of `globals.css`
    - _Requirements: 5.7, 5.8, 5.9, 5.11_

  - [x]* 14.2 Write a static assertion test over the print rules
    - Parse the `@media print` block from `globals.css` and assert no `display: none` selector matches an ancestor of `#report-card-print`, that the page size is A4 with 12mm margins, and that `print-color-adjust: exact` is set on the report root
    - _Requirements: 5.7, 5.9_

- [x] 15. Checkpoint - page renders and prints in preview
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Wire the entry points
  - [x] 16.1 Add the Sidebar navigation entry
    - `'report-cards'` into `NEW_OPS_PAGES`, and a nav `<button>` with `<ClipboardList size={20} />` inserted **between** the Students and Instructors buttons, matching the surrounding hand-written markup exactly (`ClipboardList` is already imported)
    - _Requirements: 6.1_

  - [x] 16.2 Register the page in `AppShell.jsx`
    - Import `NewStudentReportCardsPage` and add `else if (currentPage === 'report-cards')` to the new-ops chain before the `api` branch, passing `onNavigate` and `params`
    - The existing `handleNavigate` already pushes `/new/report-cards`
    - _Requirements: 6.1, 6.2_

  - [x] 16.3 Add the Report button to `NewStudentsPage.jsx`
    - **This page currently takes no props** (`export default function NewStudentsPage()`), so it must be changed to `function NewStudentsPage({ onNavigate })`. Do not add the button without that signature change, or the existing page breaks on click
    - Add a third icon button (`FileText`, accessible name identifying the report card for that row's student) to the ACTIONS cell beside the existing edit and delete buttons, calling `onNavigate('report-cards', { studentId: st.id, studentName: st.name })`
    - Widen the Actions column from `100px` to `140px`
    - Same file as task 7.4, so the two must not run concurrently
    - _Requirements: 6.3, 6.4_

  - [x]* 16.4 Write unit tests for the navigation path
    - Activating a row's report control calls `onNavigate` once with `'report-cards'` and that row's `studentId` and `studentName`; the control exposes an accessible name naming the student
    - _Requirements: 6.3, 6.4_

- [x] 17. Update the API documentation
  - [x] 17.1 Add both endpoints to `src/app/api/new/openapi.json/route.js`
    - Two `crud()` entries covering list, create, update and delete, with `extraListParams` for `studentId`, `instructorName`, `search`, `from`, `to`, `limit` on evaluations and `studentId`, `year` on terms
    - _Requirements: 2.18_

  - [x] 17.2 Update `docs/new-operations-api.md`
    - Two rows in the §4 endpoint table, two `### Record shape` blocks in §6
    - Record in §7 that deleting a student leaves orphaned evaluation and term rows, and that `bulkWipeStudents()` keeps its existing three counts and data sets unchanged by this feature
    - _Requirements: 2.15, 2.16, 2.18_

- [x] 18. Integration tests against a real database
  - [x]* 18.1 Write the integration suite for the evaluations table
    - **Property 10: Upsert is idempotent in row count** — **Validates: Requirements 1.1, 2.2, 2.3**
    - Also: the `23505 → 409` path on `PUT`; the `(student_id, eval_date)` unique constraint rejecting a direct duplicate insert; the `CHECK` constraints rejecting `0` and `6`; `ensureTable` idempotent across two calls and not caching a failed provision
    - Run with `npm run test:integration`
    - _Requirements: 1.1, 1.6, 2.2, 2.3, 2.8, 2.13_

- [ ] 19. Manual verification that cannot be automated
  - [ ] 19.1 Verify print fidelity in Chrome, Edge and Firefox
    - Canvas rasterisation into a print job cannot be verified by reading code, so run the print preview in all three browsers and confirm, in each: the sidebar and header are absent; **both** canvases are present as images; colours are retained (term badges and rating colours, not stripped); the report fits **one** A4 page; the signature lines are not orphaned onto a second page
    - Then Save-as-PDF from the same dialog and confirm the PDF matches the preview page for page
    - Also confirm a student with 11+ evaluations shows `L2…L12` on the trend axis
    - Record the result per browser; a failure here sends work back to task 14.1 or 11.1
    - _Requirements: 5.5, 5.7, 5.9, 5.10, 5.12_

  - [ ] 19.2 Verify no canvas is left bound after repeated student switches
    - Switch the selected student roughly 20 times, and enter and leave the rubric view between switches, with the console open
    - Confirm no "Canvas is already in use" warning appears — this is the Chart.js `destroy()` path that React 19 Strict Mode's double-invoked effects expose, and the reason `react-chartjs-2` owns the lifecycle rather than hand-rolled canvas code
    - _Requirements: 3.8, 5.10_

- [x] 20. Final checkpoint - full suite green
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Pure-function property tests run at `{ numRuns: 100 }`; the DOM-driven properties (16, 17, 18) run at `{ numRuns: 20 }` because each example mounts a component tree, matching the existing `NewStudentsPage.wipe.property.test.jsx` and `WipeStudentsDialog.property.test.jsx` files.
- Every property test carries `// Feature: student-report-cards, Property N: <title>` above its `it`, with `Req x.y` references inside the assertions.
- Two files have two writers each and their tasks are deliberately in different waves: `NewStudentsPage.jsx` (7.4 then 16.3) and `src/lib/reportCard.js` (4.1, 4.4, 4.6) with its property test file (4.3, 4.5, 4.7). `globals.css` has exactly one writer (14.1).
- `src/lib/listQuery.js` is not modified. The date-range comparison is a local, documented extension inside the evaluations route, still fully parameterised (Property 15 / Req 2.4).
- `bulkWipeStudents()` is untouched — orphaned evaluation and term rows are a documented limitation (Req 2.15, 2.16).
- Rubric levels 2–4 remain provisional pending the rubric owner's sign-off; changing them is one edit in `reportCardRubric.js`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "7.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "3.2", "3.3", "4.1", "4.2", "6.1", "7.2"] },
    { "id": 2, "tasks": ["4.3", "4.4", "6.2", "6.3", "7.3", "7.4", "8.1", "8.3", "11.1", "11.2"] },
    { "id": 3, "tasks": ["4.5", "4.6", "8.2", "8.4", "10.1", "10.2", "12.4", "14.1"] },
    { "id": 4, "tasks": ["4.7", "4.8", "10.3", "11.3", "12.1", "12.2", "12.5", "14.2", "17.1", "17.2"] },
    { "id": 5, "tasks": ["12.3", "13.1", "16.1", "16.2", "16.3"] },
    { "id": 6, "tasks": ["12.6", "13.3", "16.4", "18.1"] },
    { "id": 7, "tasks": ["13.2"] },
    { "id": 8, "tasks": ["19.1", "19.2"] }
  ]
}
```
