# Implementation Plan: Student Data Bulk Wipe

## Overview

Implementation follows the design's dependency order: test tooling first (the repo has none), then the
pure shared modules in `src/lib/`, then the transaction helper, then the bulk wipe service, then the
API route and client service, then the dialog and the page wiring, and finally the API spec and docs.

Language is JavaScript / JSX, matching the existing Next.js 16 + React 19 codebase. Entry point is a
`Delete All` button rendered in the New Operations Student Database `.panel-header`, immediately after
the `Add Student` button.

Property tests use `fast-check` with `numRuns: 100` minimum, one test per design property (sixteen
total), each carrying a tag comment of the form
`// Feature: student-data-bulk-wipe, Property N: <title>`.

## Tasks

- [x] 1. Set up test tooling
  - [x] 1.1 Install and configure the test runner and property library
    - Add dev dependencies: `vitest`, `jsdom`, `fast-check`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@vitejs/plugin-react`
    - Create `vitest.config.js` with `environment: 'jsdom'`, `globals: true`, the React plugin, and a `setupFiles` entry
    - Create `vitest.setup.js` importing `@testing-library/jest-dom` and registering cleanup between tests
    - Add `"test": "vitest --run"` to `package.json` scripts (single execution, never watch mode)
    - Confirm `jsconfig.json` path resolution works from test files
    - _Requirements: supports all_

- [x] 2. Implement the pure shared modules
  - [x] 2.1 Create `src/lib/wipeConfirmation.js`
    - Export `WIPE_CONFIRMATION_PHRASE = 'DELETE ALL STUDENTS'`
    - Export `matchesConfirmationPhrase(value)` — trim-then-exact, case-sensitive, `false` for non-strings
    - _Requirements: 3.4, 3.5, 5.1, 5.3_

  - [x]* 2.2 Write property test for the confirmation phrase gate
    - **Property 1: The confirmation phrase gate opens only for the exact trimmed phrase**
    - File: `src/lib/__tests__/wipeConfirmation.property.test.js`
    - Generators must include whitespace-padded phrases, case variants, inner-whitespace variants, near misses, empty strings and non-string values
    - **Validates: Requirements 3.5, 5.1, 5.3**

  - [x] 2.3 Create `src/lib/studentExport.js`
    - Export `STUDENT_EXPORT_HEADERS` in the fixed order: ID, Name, Level, Branch, Parent Name, Contact, Status, Remarks
    - Export pure `buildStudentExportRows(students)` using array-of-arrays, `''` for absent or null values, no truncation
    - Export pure `studentExportFileName(date)` returning `students-export-YYYY-MM-DD.xlsx` with zero-padded month and day
    - Export `downloadStudentExport(students, date)` — `book_new` → `aoa_to_sheet` → `book_append_sheet` (sheet name `Students`) → `XLSX.writeFile`, returning elapsed milliseconds and throwing on failure
    - _Requirements: 2.2, 2.3, 2.4, 2.9_

  - [x]* 2.4 Write property test for the export sheet contents
    - **Property 2: The export sheet reproduces the whole registry in the fixed column order**
    - File: `src/lib/__tests__/studentExport.property.test.js`
    - Generators must include an empty array and records with absent, null, empty, very long and non-ASCII field values; assert output is unchanged by any filter argument combination
    - **Validates: Requirements 2.3, 2.4, 2.9**

  - [x]* 2.5 Write property test for the export file name
    - **Property 3: The export file name carries the fixed prefix and the export date**
    - Same file as 2.4
    - **Validates: Requirements 2.2**

  - [x] 2.6 Create `src/utils/roles.js`
    - Export `ADMIN_ROLE`, `DEFAULT_ROLE`, `resolveUserRole(users, email)` with lowercase email lookup and `Instructor` fallback, and `isAdmin(users, email)`
    - Match the fallback behaviour already used by `Sidebar.jsx` and `Header.jsx`
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.7 Create `src/lib/wipeReporting.js` for the audit summary and toast wording
    - Export `buildWipeSuccessMessage({ deletedStudents })` — contains the server count, singular wording at exactly 1, plural otherwise, and no other record count
    - Export `buildWipeAuditSummary({ deletedStudents, deletedHistory, deletedProgress })` — names student records, branch history and live lesson progress with their counts, clamped to 500 characters
    - Export `buildWipeFailureAuditSummary()` and `WIPE_ACTIVITY = { action: 'bulk', source: 'students' }`
    - Export `resolveAuditUser(email)` returning the recorded email unchanged or the `Unknown user` placeholder
    - _Requirements: 7.2, 7.3, 8.1, 8.2, 8.3, 8.4, 8.6, 8.7_

  - [x]* 2.8 Write property test for the success message
    - **Property 11: The success message reports the server's count, correctly numbered**
    - File: `src/lib/__tests__/wipeReporting.property.test.js`
    - Generators must include counts of 0, 1 and very large values, paired with differing dialog snapshot counts
    - **Validates: Requirements 7.2, 7.3**

  - [x]* 2.9 Write property test for the audit entry
    - **Property 12: One audit entry describes the wipe completely**
    - Same file as 2.8
    - Generators must include count triples containing 0, and a recorded email that is present, absent, empty and mixed-case
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.6**

- [x] 3. Checkpoint - pure modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add the transaction helper
  - [x] 4.1 Extend `src/lib/db.js` with `withTransaction` and `WipeTimeoutError`
    - Acquire one pooled client, `BEGIN`, `SET LOCAL statement_timeout`, run the callback, `COMMIT`
    - Race the callback against a 30-second deadline that rejects with `WipeTimeoutError`
    - `ROLLBACK` inside its own `try/catch` on any rejection, and always `client.release()` in `finally`
    - Leave the existing `query(text, params)` export untouched
    - _Requirements: 6.1, 6.2, 6.3, 6.8_

  - [x]* 4.2 Write unit tests for the transaction helper
    - Statement ordering `BEGIN → SET LOCAL statement_timeout → callback → COMMIT`, and no `COMMIT` on a failure path
    - Rollback on callback rejection, on a rejecting `COMMIT`, and on the deadline firing under fake timers
    - Client released on every path
    - _Requirements: 6.1, 6.2, 6.3, 6.8_

- [x] 5. Implement the bulk wipe service
  - [x] 5.1 Create `src/lib/bulkWipeStudents.js`
    - Call `ensureTable` for `internal_student_history` and `internal_live_progress` on the pool, before `BEGIN`
    - Inside `withTransaction`: `SELECT pg_advisory_xact_lock($1)` on the fixed key as the first statement
    - Then the three ordered deletes: `internal_live_progress` by `lower(btrim(student_name))` membership excluding blank names, `internal_student_history` by `student_id IN (SELECT id FROM internal_students)`, then `DELETE FROM internal_students`
    - Reference no protected table and accept no filter parameter
    - Return `{ deletedStudents, deletedHistory, deletedProgress }` from the statement row counts
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 6.1, 6.5, 9.1, 9.2, 9.6_

  - [x]* 5.2 Write property test for the wipe's deletion scope
    - **Property 7: A wipe deletes the registry and exactly its keyed side data**
    - File: `src/lib/__tests__/bulkWipeStudents.property.test.js`, running against an in-memory fake `pg` client holding the seven tables as arrays and applying the same predicates the SQL expresses
    - Generators must include names that are empty, whitespace-only, duplicated, case-varying and padded; history rows with matching and non-matching identifiers; progress rows with matching, folded-matching and unmatched names; and arbitrary protected-table rows
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 4.9, 4.10, 4.11, 4.13, 9.2**

  - [x]* 5.3 Write property test for rollback
    - **Property 8: A failed wipe changes nothing**
    - Same file as 5.2, injecting a failure at each of the three deletions in turn
    - **Validates: Requirements 6.2, 6.3**

  - [x]* 5.4 Write property test for idempotence
    - **Property 9: Wiping is idempotent**
    - Same file as 5.2
    - **Validates: Requirements 6.5, 9.1**

  - [x]* 5.5 Write property test for the response counts
    - **Property 10: Every success response carries three non-negative integer counts**
    - Same file as 5.2
    - **Validates: Requirements 7.1**

  - [x]* 5.6 Write unit tests for statement ordering and blank-name exclusion
    - Assert the exact sequence `BEGIN → pg_advisory_xact_lock → live progress → history → students → COMMIT`
    - Assert a student record with a blank or whitespace-only name selects no live progress record
    - _Requirements: 4.12, 6.1, 9.6_

- [x] 6. Checkpoint - server-side wipe
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Wire the API route and the client service
  - [x] 7.1 Extend the DELETE handler in `src/app/api/new/students/route.js`
    - Keep the existing single-record path byte for byte when `?id=` is present, including the 404 for an unknown id, and ignore the body in that branch
    - With no `?id=`: read the body in a `try/catch`, treat unparseable, non-object, missing, empty and whitespace-only confirmation values as a 400 naming both the id alternative and the required phrase
    - Return 400 with a mismatch message when the confirmation is present but `matchesConfirmationPhrase` is false, making no database call
    - On a match, call `bulkWipeStudents()` and return `{ success: true, deletedStudents, deletedHistory, deletedProgress }`
    - Map `WipeTimeoutError` to a 500 naming the 30-second limit, and any other error to a 500 carrying the failure reason
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.2, 6.5, 6.8, 7.1, 9.1_

  - [x]* 7.2 Write property test for endpoint dispatch
    - **Property 6: The delete endpoint dispatches by identifier first and by confirmation second**
    - File: `src/app/api/new/students/__tests__/delete.property.test.js`
    - Generators must include bodies that are `undefined`, `null`, `''`, whitespace, non-objects and invalid JSON, crossed with an id present and absent
    - **Validates: Requirements 5.2, 5.4, 5.5, 5.6**

  - [x]* 7.3 Write unit tests for the route's example branches
    - Unknown `?id=` returns 404 with a not-found message and deletes nothing
    - A `PUT` for a record deleted by a completed wipe returns 404 and leaves the registry at zero records
    - _Requirements: 5.7, 9.7_

  - [x] 7.4 Add `bulkDeleteAllStudents` to `src/services/internalStudentService.js`
    - `DELETE` to the students path with no `?id=`, JSON body `{ confirm }`, and a 30-second `AbortController`
    - Throw an `Error` carrying the server `error` string on a non-ok response; clear the timer in `finally`
    - Surface an `AbortError` distinctly so the caller can report an unconfirmed outcome rather than a failure
    - _Requirements: 6.9_

  - [x]* 7.5 Write unit tests for the client service
    - Server error string is propagated; the 30-second abort produces the unconfirmed-outcome signal under fake timers
    - _Requirements: 6.9_

- [x] 8. Build the confirmation dialog
  - [x] 8.1 Create `src/components/operations/WipeStudentsDialog.jsx`
    - Props `studentCount`, `filtersActive`, `students`, `onCancel`, `onConfirm`; local state `exportDone`, `exportError`, `text`, `phase`, `wipeError`
    - Render the frozen snapshot count, the will-be-deleted and will-be-kept lists wired as `aria-describedby`, the class-schedule consequence sentence, the literal phrase, and the every-record disclosure when `filtersActive`
    - Export action enabled at open with initial keyboard focus; call `downloadStudentExport`, treat a throw or an over-budget elapsed time as a failure with a message, and keep export retryable with no attempt cap
    - Confirmation input disabled until `exportDone`, with the accompanying message; derive `canWipe` from `exportDone && matchesConfirmationPhrase(text) && phase !== 'running'` on every render
    - `role="dialog"` with `aria-modal`, `aria-labelledby`, `aria-describedby`; Tab and Shift+Tab cycling across the dialog's focusable controls; Escape and backdrop `mousedown` call `onCancel`
    - While `phase === 'running'`, disable wipe and cancel, show `.loading-spinner`, and return early on repeat activation; on failure keep `text` and `exportDone` and re-arm
    - _Requirements: 2.1, 2.5, 2.6, 2.7, 2.8, 2.10, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 3.11, 3.12, 6.4, 6.6, 6.7_

  - [x]* 8.2 Write property test for dialog enablement
    - **Property 4: The dialog arms only when an export has completed and the phrase matches**
    - File: `src/components/operations/__tests__/WipeStudentsDialog.property.test.jsx`
    - **Validates: Requirements 2.5, 2.7, 2.8, 3.5, 6.6**

  - [x]* 8.3 Write property test for the frozen count
    - **Property 13: The dialog's record count is frozen at open time**
    - Same file as 8.2, driving arbitrary sequences of list refreshes and filter changes while the dialog stays open
    - **Validates: Requirements 3.1, 3.10, 9.5**

  - [x]* 8.4 Write property test for reopening after cancel
    - **Property 14: A cancelled dialog reopens clean**
    - Same file as 8.2, covering all three cancel routes
    - **Validates: Requirements 3.8**

  - [x]* 8.5 Write property test for the focus trap
    - **Property 15: Keyboard focus cannot leave an open dialog**
    - Same file as 8.2, over arbitrary sequences of forward and backward tab movements
    - **Validates: Requirements 3.12**

  - [x]* 8.6 Write unit tests for dialog content and edge branches
    - Deleted and kept lists wired to `aria-describedby`, class-schedule consequence sentence, literal phrase text, initial focus on Export
    - Export failure and over-budget messaging; three consecutive failures keep the export enabled
    - Paste and programmatic value replacement update enablement; each cancel route closes and sends nothing
    - _Requirements: 2.6, 2.10, 3.2, 3.3, 3.4, 3.6, 3.7, 3.11_

- [x] 9. Wire the page header and the post-wipe orchestration
  - [x] 9.1 Add the `Delete All` control to the `NewStudentsPage` panel header
    - Render it immediately after `Add Student` inside `.panel-header`, only when `isAdmin(users, user?.email)`, with the row delete control's styling tokens and `<Trash2 size={16} />` and no extra overrides
    - Set the accessible name to state that the action deletes all student records and cannot be undone; set a `title` for hover and focus
    - Render `disabled` with the already-empty tooltip when `students.length === 0`
    - Hold a `wipeControlRef` and open `WipeStudentsDialog` with the snapshot count, `filtersActive` and the unfiltered `students` array
    - Close the dialog through an effect when the role stops being `Admin`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 7.8_

  - [x]* 9.2 Write property test for header gating
    - **Property 5: The header exposes the wipe control only to Admin, and only usably when records exist**
    - File: `src/views/__tests__/NewStudentsPage.wipe.property.test.jsx`
    - Generators must include user-to-role maps, an absent email, an email missing from the map, differing letter case, and registry sizes including 0
    - **Validates: Requirements 1.1, 1.2, 1.3, 7.8**

  - [x] 9.3 Implement `handleWipeConfirm` in `src/views/NewStudentsPage.jsx`
    - Re-check the role before dispatch; on a non-Admin role send no request and show an error toast naming the required role
    - Call `bulkDeleteAllStudents(WIPE_CONFIRMATION_PHRASE)`, then show the success toast built from the server counts with a duration of at least 5 seconds
    - `localStorage.removeItem('newOpsStudentBranchHistory')` in a `try/catch` that logs and still reports success
    - `logActivity` with the `bulk`/`students` entry and one retry after about 1 second; a second failure is console-only and changes no reported count
    - Close the dialog, return focus to `wipeControlRef`, `setPage(1)`, leave the four filter values untouched, then reload students and add a retry toast if the reload fails
    - On failure: error toast with the server reason, one failure activity entry with count 0, dialog left open and re-armed
    - On an unconfirmed outcome from the 30-second abort: show the unconfirmed notification with the reload advice instead of a success or failure toast
    - _Requirements: 1.8, 4.6, 4.7, 6.4, 6.7, 6.9, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.3, 9.4_

  - [x]* 9.4 Write property test for filter preservation and disclosure
    - **Property 16: Filters survive a wipe, and a narrowed view is disclosed**
    - Same file as 9.2
    - **Validates: Requirements 3.9, 9.4**

  - [x]* 9.5 Write unit tests for the page orchestration branches
    - Role change while the dialog is open closes it and discards the typed text; non-Admin dispatch sends no request
    - `localStorage` cleared on success, and a throwing `removeItem` still reports success
    - Activity log retried once then abandoned; a failed wipe writes one entry with count 0
    - Post-success sequence: dialog closes, focus returns, list reloads, empty state renders, page resets to 1, reload failure adds a retry toast
    - Repeated wipe activation while running issues one request
    - _Requirements: 1.4, 1.8, 4.6, 4.7, 6.7, 7.4, 7.5, 7.6, 7.7, 8.5, 8.7, 9.3_

- [x] 10. Checkpoint - full client and server path
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Update the API contract and documentation
  - [x] 11.1 Override the students `delete` operation in `src/app/api/new/openapi.json/route.js`
    - After the `crud()` spread, mark `id` as optional for the students path and add a `requestBody` describing `{ confirm }`
    - Write a summary that spells out the destructive scope and the confirmation requirement for agent callers
    - _Requirements: 5.1, 5.2, 5.5_

  - [x] 11.2 Document the bulk form in `docs/new-operations-api.md`
    - Add the bulk delete request and response shapes to the students endpoint section
    - Extend the "Block every DELETE" guidance to cover the bodied bulk form for both same-origin and API-key callers
    - _Requirements: 5.1, 5.2, 5.8_

- [ ] 12. Integration and performance verification
  - [ ]* 12.1 Write integration tests against a disposable PostgreSQL database
    - Run separately from the unit suite, 1–3 examples each, never 100 iterations
    - Seeded confirmed wipe: registry empty, keyed side data gone, orphan history and unmatched progress intact, all five protected tables unchanged — validates the in-memory model used by Property 7
    - Two concurrent confirmed wipes: the second starts only after the first transaction ends, the deleted student counts sum to the initial registry size, and the later response reports zero
    - The same unconfirmed request admitted as `Sec-Fetch-Site: same-origin` and as `x-api-key`, both returning 400
    - A forced mid-transaction failure leaving the three tables at their pre-wipe counts and values
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.13, 5.8, 6.2, 6.3, 9.6_

  - [ ]* 12.2 Write the export performance check
    - Generate 10,000 student records, stub `XLSX.writeFile` to a no-op writer, and assert row building plus sheet construction completes within 10 seconds
    - One example-based test, not a property
    - _Requirements: 2.2_

- [ ] 13. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP, though the property tests are
  the main safeguard for an irreversible destructive operation
- Sixteen property tests, one per design property, each at `numRuns: 100` minimum and tagged
  `// Feature: student-data-bulk-wipe, Property N: <title>`
- Database properties (7–10) run against an in-memory fake `pg` client; task 12.1 checks that model
  against real PostgreSQL semantics
- Checkpoints at tasks 3, 6, 10 and 13 give incremental validation points

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "2.6", "2.7", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5", "2.8", "2.9", "4.2", "5.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "7.1", "7.4", "8.1"] },
    { "id": 4, "tasks": ["7.2", "7.3", "7.5", "8.2", "8.3", "8.4", "8.5", "8.6", "9.1", "11.1", "11.2"] },
    { "id": 5, "tasks": ["9.2", "9.3"] },
    { "id": 6, "tasks": ["9.4", "9.5", "12.1", "12.2"] }
  ]
}
```
