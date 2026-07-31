# Requirements Document

## Introduction

Instructors currently have nowhere to record how a student actually did in a lesson, and parents
have nothing to take home. This feature adds a New Operations page at `/new/report-cards` that
records one five-competency evaluation per student per teaching day, charts the history, tracks
term subscriptions as T1–T4 badges, and prints a one-page Student Learning Journey Report.

Two new companion tables carry the data — `internal_student_evaluations` and
`internal_student_terms` — because the application's database user does not own the original
tables and cannot alter them. Both tables are self-provisioning through the existing
`ensureTable()` mechanism, so a fresh database heals itself.

The document is built around one structural decision: every number that a parent can read comes
from a single pure derivation module. The on-screen radar, the trend line, the grade badge and the
printed Competency Mastery Summary are one computation with several renderers, so the screen and
the paper cannot disagree. Two consequences of that are stated as hard requirements rather than
left to implementation taste. First, a score is never invented: a partially rated evaluation is
refused, not defaulted, and a student with no evaluations reads `NOT YET ASSESSED` with no number
printed anywhere — never `0.0/5`, which a parent would read as a failing grade. Second, the grade
band is computed from the score *after* it has been rounded for display, so the printed number and
the printed label cannot contradict each other.

Four scope boundaries are settled here so they are not assumed later.

The printed academy name and the two signatory names are configuration, not component text. The
values transcribed from the prototype screenshots are placeholders from a mock, and no person's
name is compiled into a component.

Rubric wording for levels 1 and 5 is fixed verbatim from the brief. Levels 2–4 are the graduated
wording inferred from the screenshots and are provisional until the rubric owner signs them off,
so all 25 descriptors live in one module and a change is one edit in one file.

Deleting a student leaves that student's evaluation and term rows behind as orphans, exactly as
branch history already behaves, because no foreign key can be created. That is a known limitation,
documented rather than fixed. Extending `bulkWipeStudents()` to clear the two new tables would
change its three-count return contract, which the `student-data-bulk-wipe` spec's property tests
assert, so it is deliberately out of scope for this feature.

A term record carries a paid flag, a paid date and a free-text note. It carries no price and no
invoice reference. Billing is out of scope.

## Glossary

- **Report_Cards_Page**: The New Operations "Report Cards" screen at `/new/report-cards` that selects a student, records evaluations, renders charts and produces the Report_Document.
- **Students_Page**: The existing New Operations "Student Database" screen that lists, filters and edits student records.
- **App_Shell**: The component that maps the current page name to a rendered page and passes navigation parameters to it.
- **Sidebar**: The New Operations navigation list of page buttons.
- **Student_Selector_Panel**: The Report_Cards_Page sidebar holding the program tabs and the filtered student list.
- **Program_Category**: One of the three values `Kinder`, `Junior`, `Coder`, derived from a student's level.
- **Evaluation_Form**: The Report_Cards_Page control group that captures a date, a lesson topic, an instructor name, five Competency_Scores and instructor remarks, and saves them.
- **Competency**: One of the five assessed dimensions, identified by the keys `concept`, `building`, `problemSolving`, `focus`, `attitude`.
- **Competency_Score**: An integer from 1 to 5 inclusive recording one Competency for one Evaluation_Record.
- **Evaluation_Record**: One stored evaluation of one student on one calendar date, holding the five Competency_Scores plus an optional lesson topic, instructor remarks and instructor name.
- **Evaluation_Store**: The stored set of Evaluation_Records (table `internal_student_evaluations`).
- **Evaluation_API**: The server-side endpoint `/api/new/student-evaluations` exposing Evaluation_Records.
- **Evaluation_Validator**: The server-side function that accepts or rejects an untrusted Evaluation_Record payload.
- **Term_Record**: One stored term subscription row for one student, one calendar year and one term number from 1 to 4, holding a paid flag, an optional paid date and an optional free-text note.
- **Term_Store**: The stored set of Term_Records (table `internal_student_terms`).
- **Term_API**: The server-side endpoint `/api/new/student-terms` exposing Term_Records.
- **Record_Mapper**: The per-endpoint whitelist function that converts a stored row into the API record shape.
- **Report_Derivation_Module**: The single pure module (`src/lib/reportCard.js`) that computes Competency_Averages, the Overall_Grade, the Lesson_Series and the Term_Summary.
- **Competency_Averages**: The arithmetic mean of each Competency over the Evaluation_Records currently in range, or no value when that set is empty.
- **Overall_Grade**: The pair of a displayed score and a Grade_Band label derived from the Competency_Averages.
- **Grade_Band**: One of the labels `EXCELLENT`, `VERY GOOD`, `GOOD`, `DEVELOPING`, `BEGINNING`, `NOT YET ASSESSED`.
- **Lesson_Series**: The ordered chart series of Lesson_Labels, per-evaluation mean values and source dates.
- **Lesson_Label**: The text `L` followed by the 1-based ordinal position of an Evaluation_Record in that student's date-ordered history.
- **Term_Summary**: The derived set of exactly four Term_Badges plus the Start_Term and the Current_Term.
- **Term_Badge**: The rendered `T1`…`T4` indicator for one term number, carrying a state of `paid`, `unpaid` or `absent` and a current flag.
- **Start_Term**: The earliest Term_Record of a student ordered by year then term number.
- **Current_Term**: The latest paid Term_Record of a student ordered by year then term number.
- **Rubric_Module**: The single module holding the 25 rubric descriptors and the descriptor lookup function.
- **Rubric_Descriptor**: The wording that describes one Competency at one Competency_Score value.
- **Chart_Components**: The Competency radar chart and the progress trend chart, the only modules that import the charting library.
- **Report_Document**: The printable one-page Student Learning Journey Report, rooted at the element with id `report-card-print`.
- **Report_Branding_Constants**: The configuration module supplying the printed academy header text and the two signatory names.
- **App_Chrome**: The Sidebar, the application header, panel header action rows, navigation controls and toast containers.
- **Print_Stylesheet**: The `@media print` rules that hide App_Chrome and lay out the Report_Document for paper.
- **Student_Registry**: The existing stored set of student records exposed by `/api/new/students`.
- **Bulk_Wipe_Service**: The existing server-side handler that deletes the Student_Registry, branch history and live progress records in one transaction and returns exactly three counts.
- **Activity_Log**: The shared audit trail that records an action, a source, a summary, an affected-record count and a user email.

## Requirements

### Requirement 1: Record a daily five-competency evaluation

**User Story:** As an instructor, I want to rate a student on five competencies for a teaching day, so that the student's progress is recorded from evidence rather than recalled from memory.

#### Acceptance Criteria

1. THE Evaluation_Record SHALL hold a student identifier, one calendar date, the five Competency_Scores for `concept`, `building`, `problemSolving`, `focus` and `attitude`, and the optional values lesson topic, instructor remarks and instructor name, and SHALL hold at most one record for any one pair of student identifier and calendar date.
2. WHEN the Evaluation_Validator receives a payload, THE Evaluation_Validator SHALL return the validated value if and only if the student identifier is a positive integer, the date is a real calendar date in the format `YYYY-MM-DD`, and each of the five Competency_Scores is an integer from 1 to 5 inclusive; and for every other payload THE Evaluation_Validator SHALL return one non-empty error message that names the offending field.
3. IF a payload omits a Competency_Score, or carries a Competency_Score that is an empty text value, THEN THE Evaluation_Validator SHALL return an error message naming that Competency and stating that every Competency must be rated from 1 to 5, and SHALL return no validated value.
4. IF a payload carries a Competency_Score that is not an integer, or is an integer below 1, or is an integer above 5, THEN THE Evaluation_Validator SHALL return an error message naming that Competency and carrying the received value, SHALL return no validated value, and SHALL store no substitute value in place of the received value.
5. THE Evaluation_Validator SHALL reject an out-of-range Competency_Score rather than replacing it with the nearest value in the range 1 to 5 and rather than replacing it with a default value, so that no Evaluation_Record holds a Competency_Score that no instructor entered.
6. THE Evaluation_Store SHALL define each of the five Competency_Score columns as not accepting a null value and as accepting only integer values from 1 to 5 inclusive, so that a write which bypasses the Evaluation_Validator is refused by the Evaluation_Store itself.
7. WHERE a payload omits the date or carries a date that is an empty text value after leading and trailing whitespace is removed, THE Evaluation_Validator SHALL substitute the server's current calendar date in the format `YYYY-MM-DD`.
8. IF a payload carries a date that does not match the format `YYYY-MM-DD`, or matches that format but is not a real calendar date, THEN THE Evaluation_Validator SHALL return an error message naming the date field and carrying the received value, and SHALL return no validated value.
9. THE Evaluation_Validator SHALL accept a lesson topic, instructor remarks and an instructor name each as either a text value or no value, and SHALL return an error message naming the instructor name field where the instructor name exceeds 255 characters after leading and trailing whitespace is removed.
10. WHEN the Evaluation_Form renders, THE Evaluation_Form SHALL offer as instructor names the instructor names returned by `/api/new/instructors` together with the instructor name already held on the Evaluation_Record being edited when that name is absent from the returned list, so that an Evaluation_Record naming a departed instructor stays editable.
11. WHEN the Evaluation_Form opens for a student with no instructor name chosen, THE Evaluation_Form SHALL select as the default instructor name the instructor name on that student's most recent Evaluation_Record; WHERE that student has no Evaluation_Record, THE Evaluation_Form SHALL select the signed-in user's matching instructor name compared after removing leading and trailing whitespace and disregarding letter case; and WHERE neither is available, THE Evaluation_Form SHALL select no instructor name.
12. WHILE any of the five Competency_Scores is unrated, or no instructor name is chosen, THE Evaluation_Form SHALL keep its save action disabled.
13. IF a save request is rejected by the Evaluation_API, THEN THE Evaluation_Form SHALL display the error message returned by the Evaluation_API and SHALL retain every value currently entered in the Evaluation_Form.
14. THE Rubric_Module SHALL hold exactly one non-empty Rubric_Descriptor for each of the 25 pairs of one of the five Competencies with one Competency_Score from 1 to 5 inclusive, with the five Rubric_Descriptors of any one Competency distinct from each other; and THE Rubric_Module SHALL return a text value for every pair of arguments it is called with, non-empty exactly when the Competency key is one of the five defined keys and the Competency_Score is an integer from 1 to 5 inclusive.
15. THE Rubric_Module SHALL hold the Rubric_Descriptors for Competency_Score 1 and Competency_Score 5 as the wording supplied by the source brief, character for character, and SHALL hold the Rubric_Descriptors for Competency_Scores 2, 3 and 4 as provisional wording that requires the rubric owner's approval before release.
16. THE Rubric_Module SHALL be the only module in the codebase holding Rubric_Descriptor text, so that changing one Rubric_Descriptor is one edit in one file and the Evaluation_Form descriptor line, the rubric reference panel and the full scoring guidelines view render the same wording.
17. WHILE a Competency_Score is selected in the Evaluation_Form, THE Evaluation_Form SHALL display the Rubric_Descriptor for that Competency and that Competency_Score beneath the rating control for that Competency.
18. THE Evaluation_Form SHALL expose each Competency rating control as a keyboard-reachable group of five options, each option carrying an accessible name that states the Competency_Score together with its Rubric_Descriptor.

### Requirement 2: Serve evaluations and terms through a stable API contract

**User Story:** As a developer, I want the two new endpoints to expose a fixed record shape and an upsert that cannot duplicate a day, so that the page, the API documentation and future callers agree on what a record is.

#### Acceptance Criteria

1. WHEN the Evaluation_API or the Term_API returns a record, THE Record_Mapper SHALL return exactly the documented keys of that record shape and SHALL omit every other key held on the stored row, including any column added to the table after this feature is released and any key written in snake case.
2. WHEN the Evaluation_API receives a POST request carrying a payload that the Evaluation_Validator accepts, THE Evaluation_API SHALL write the record so that the Evaluation_Store holds exactly one Evaluation_Record for that pair of student identifier and date, holding the values of that payload, whether or not an Evaluation_Record for that pair already existed.
3. WHEN the Evaluation_API receives two POST requests carrying the same student identifier and the same date, THE Evaluation_API SHALL leave the Evaluation_Store holding exactly one Evaluation_Record for that pair, whose five Competency_Scores, lesson topic, instructor remarks and instructor name are those of the second request.
4. WHEN the Evaluation_API builds a list query from request parameters, THE Evaluation_API SHALL pass every value taken from those request parameters as a bind parameter, SHALL produce a query clause whose count of bind placeholders equals the count of bind parameter values, and SHALL include no value taken from those request parameters as literal text in the query clause.
5. THE Evaluation_API SHALL accept the list parameters `studentId`, `instructorName`, `search`, `from`, `to` and `limit`, SHALL return only Evaluation_Records whose date is on or after the `from` value when `from` is supplied, and SHALL return only Evaluation_Records whose date is on or before the `to` value when `to` is supplied.
6. IF a list request carries a `from` value or a `to` value that does not match the format `YYYY-MM-DD`, THEN THE Evaluation_API SHALL return status 400 with an error message naming the offending parameter and SHALL return no records.
7. WHEN the Evaluation_API returns a list of Evaluation_Records, THE Evaluation_API SHALL order them ascending by date and, for records sharing a date, ascending by record identifier.
8. IF the Evaluation_API receives a PUT request that would move an Evaluation_Record onto a date on which the same student already holds an Evaluation_Record, THEN THE Evaluation_API SHALL return status 409 with an error message naming that date and stating that the existing day can be opened to edit it, and SHALL leave both Evaluation_Records unchanged in field values.
9. IF the Evaluation_API receives a PUT or DELETE request carrying a record identifier that matches no Evaluation_Record, THEN THE Evaluation_API SHALL return status 404 with the error message `Evaluation not found` and SHALL delete and change no record.
10. THE Evaluation_API SHALL accept a DELETE request that identifies exactly one Evaluation_Record by identifier in the request query string, and SHALL provide no request form that deletes more than one Evaluation_Record.
11. WHEN the Term_API receives a POST request carrying a student identifier, a year and a term number, THE Term_API SHALL write the record so that the Term_Store holds exactly one Term_Record for that triple of student identifier, year and term number, holding the paid flag, paid date and note of that request.
12. IF a Term_API request carries a term number that is not an integer from 1 to 4 inclusive, or a year that is not an integer from 2000 to 2100 inclusive, THEN THE Term_API SHALL return status 400 with an error message naming the offending field and its permitted bounds, and SHALL write no record.
13. WHEN the Evaluation_API or the Term_API handles a request, THE handling endpoint SHALL provision its table before issuing the first query of that request, and IF provisioning fails, THEN THE handling endpoint SHALL retain no cached success for that table so that the next request attempts provisioning again.
14. IF a database query raises an error, or no database connection string is configured, THEN THE handling endpoint SHALL return status 500 carrying the error message raised, and THE Report_Cards_Page SHALL retain the data it last loaded successfully and display a retry notification.
15. WHEN a student record is deleted from the Student_Registry, THE Evaluation_Store and THE Term_Store SHALL retain that student's Evaluation_Records and Term_Records as orphaned rows, which the Report_Cards_Page SHALL not list because it lists only students returned by `/api/new/students`.
16. THE feature documentation SHALL record the orphaned rows of criterion 15 as a known limitation, and THE Bulk_Wipe_Service SHALL keep its existing three deletion counts and its existing set of deleted data sets unchanged by this feature, because changing that contract is the subject of the `student-data-bulk-wipe` specification.
17. WHEN an Evaluation_Record is saved from the Report_Cards_Page, THE Report_Cards_Page SHALL write one Activity_Log entry with the source value `students`, and IF that write fails, THEN THE Report_Cards_Page SHALL report the save as successful.
18. THE published API description SHALL carry the list, create, update and delete operations of the Evaluation_API and the Term_API, together with the list parameters named in criterion 5 and the `studentId` and `year` list parameters of the Term_API.

### Requirement 3: Derive every displayed number from one module

**User Story:** As a parent, I want the chart, the badge and the printed report to state the same numbers, so that the report I keep is the assessment the instructor recorded.

#### Acceptance Criteria

1. WHEN the Report_Derivation_Module computes Competency_Averages over a set of Evaluation_Records, THE Report_Derivation_Module SHALL return one value for each of the five Competencies, each value the arithmetic mean of that Competency over that set and in the range 1 to 5 inclusive; THE Report_Derivation_Module SHALL return no value where that set is empty; THE Report_Derivation_Module SHALL return the same values for any two orderings of the same set; and THE Report_Derivation_Module SHALL leave the supplied set unchanged.
2. WHEN the Report_Derivation_Module computes the Overall_Grade score over a non-empty set of Evaluation_Records, THE Report_Derivation_Module SHALL produce the arithmetic mean of the five Competency_Averages, which equals the arithmetic mean of all five Competency_Scores of every Evaluation_Record in that set, within a floating-point tolerance of 0.000001.
3. WHEN the Report_Derivation_Module computes the Overall_Grade, THE Report_Derivation_Module SHALL round the score to one decimal place first and SHALL then select the Grade_Band from that rounded score as `EXCELLENT` for 4.5 and above, `VERY GOOD` for 3.5 up to but excluding 4.5, `GOOD` for 2.5 up to but excluding 3.5, `DEVELOPING` for 1.5 up to but excluding 2.5, and `BEGINNING` for 1.0 up to but excluding 1.5, so that the Grade_Band recomputed from the displayed score always equals the displayed Grade_Band; and THE Report_Derivation_Module SHALL assign each Grade_Band a rank from 1 to 5 that does not decrease as the score increases.
4. WHERE a student has zero Evaluation_Records in range, THE Report_Derivation_Module SHALL return the Grade_Band `NOT YET ASSESSED` with no score value, and THE Report_Cards_Page and THE Report_Document SHALL render no numeric Competency_Average, no numeric Overall_Grade score and no `/5` score text anywhere for that student.
5. WHEN the Report_Derivation_Module computes the Lesson_Series over a set of `n` Evaluation_Records for one student with a window of `w` records, THE Report_Derivation_Module SHALL order that set ascending by date and then by record identifier, SHALL return exactly the last `w` records of that order when `n` exceeds `w` and all `n` records otherwise, SHALL label the record at 0-based position `i` of the full order as `L` followed by `i + 1` so that the labels returned are consecutive integers increasing by 1 and the last label states the ordinal `n`, SHALL return one mean value per label in the range 1 to 5 inclusive, SHALL return the source date of each label in non-decreasing order, and SHALL return the same labels, values and dates for any two orderings of the same set.
6. THE Report_Derivation_Module SHALL take the Lesson_Series window from the existing `LESSONS_PER_LEVEL` value in `src/lib/programRules.js` rather than from a value declared in this feature.
7. THE Competency radar chart and THE Report_Document Competency Mastery Summary SHALL both render the Competency_Averages returned by one call of the Report_Derivation_Module for the same student and the same date range, and THE Report_Document SHALL print each of the five values to one decimal place followed by ` / 5.0`.
8. THE Chart_Components SHALL be the only modules that import the charting library, and THE Report_Cards_Page SHALL load them so that no charting code is evaluated during server rendering.
9. IF loading a Chart_Component fails, THEN THE Report_Cards_Page SHALL render in that chart's place the numeric Competency Mastery Summary values of criterion 7, so that an assessment is never held only inside a canvas element.
10. WHERE a student has zero Evaluation_Records in range, THE Chart_Components SHALL render a stated empty message rather than an axis with no plotted data.
11. WHEN an Evaluation_Record is saved, THE Report_Cards_Page SHALL update its local set of Evaluation_Records from the record returned by the Evaluation_API and SHALL recompute the Competency_Averages, the Overall_Grade, the Lesson_Series and the Term_Summary from that updated set.

### Requirement 4: Track term subscriptions as four derived badges

**User Story:** As an administrator, I want to see at a glance which terms a student has paid for and which term they are in now, so that I can chase a lapsed subscription without opening a billing system.

#### Acceptance Criteria

1. WHEN the Report_Derivation_Module computes a Term_Badge for a term number in the selected year, THE Report_Derivation_Module SHALL set the state to `paid` where a Term_Record exists for that student, that year and that term number with the paid flag true, to `unpaid` where such a Term_Record exists with the paid flag false, and to `absent` where no such Term_Record exists.
2. WHEN the Report_Derivation_Module computes the Term_Summary, THE Report_Derivation_Module SHALL return exactly four Term_Badges labelled `T1`, `T2`, `T3` and `T4` in ascending term-number order, each carrying exactly one of the states `paid`, `unpaid` or `absent`, and SHALL set the current flag true on at most one of those four Term_Badges.
3. THE Report_Derivation_Module SHALL compute the Start_Term as the least of a student's Term_Records ordered by year and then term number and THE Current_Term as the greatest of that student's Term_Records whose paid flag is true under the same ordering, SHALL return a Current_Term if and only if at least one of that student's Term_Records has the paid flag true, and SHALL return a Current_Term that is not less than the Start_Term under that ordering whenever both are returned.
4. THE Term_Store SHALL hold no column recording which term is the current term and no column recording which term is the start term, so that a state in which one student has two current terms cannot be stored.
5. WHERE a student has no Term_Record with the paid flag true, THE Report_Cards_Page SHALL render the current-term value in the student header as an em dash rather than as a term label.
6. WHERE a student has no Term_Record, THE Report_Cards_Page SHALL render all four Term_Badges in the `absent` state and SHALL render both the start-term value and the current-term value in the student header as an em dash.
7. WHERE no year is supplied for the Term_Summary, THE Report_Derivation_Module SHALL select the greatest year held across that student's Term_Records, and WHERE that student holds no Term_Record, THE Report_Derivation_Module SHALL select the current calendar year.
8. THE Report_Derivation_Module SHALL set the current flag true on a Term_Badge only where the Current_Term year equals the selected year, so that a student whose latest paid term is in an earlier year shows no current badge in the selected year.
9. WHEN the Report_Cards_Page renders the four Term_Badges, THE Report_Cards_Page SHALL render the `paid` state, the `unpaid` state and the `absent` state each in a visually distinct style, and SHALL render an additional distinct indicator on the Term_Badge whose current flag is true.
10. THE Term_Record SHALL hold a paid flag, an optional paid date and an optional free-text note as its only subscription values, and SHALL hold no price value, no currency value and no invoice reference, which are out of scope for this feature.

### Requirement 5: Print a one-page learning journey report

**User Story:** As an instructor, I want to hand a parent a printed report, or save it as a PDF, so that the student's progress leaves the building in a form the parent keeps.

#### Acceptance Criteria

1. THE Report_Document SHALL render, in order from the top, the academy header, a student row holding the student name, the instructor name, the Current_Term and the Overall_Grade, the Performance Breakdown radar, the Competency Mastery Summary, the Instructor Remarks, and two signature lines labelled `Lead Instructor` and `Academic Director` with a name printed beneath each; and THE Report_Document SHALL carry the element id `report-card-print` on its root element.
2. THE Report_Document SHALL read the printed academy header text, the printed academy report title, the Academic Director name and the default Lead Instructor name from the Report_Branding_Constants, and SHALL hold no academy name and no person's name as text written into a component.
3. WHERE the Evaluation_Record supplying the Instructor Remarks holds an instructor name, THE Report_Document SHALL print that instructor name beneath the `Lead Instructor` signature line, and WHERE that Evaluation_Record holds no instructor name, THE Report_Document SHALL print the default Lead Instructor name from the Report_Branding_Constants.
4. WHEN the user activates the preview action, THE Report_Cards_Page SHALL mount and lay out the Report_Document on screen at print proportions together with a control that returns to the evaluate mode, and SHALL consume no paper and open no operating-system dialog.
5. WHEN the user activates the print action, THE Report_Cards_Page SHALL invoke the browser print dialog, which is also the browser's save-as-PDF path, so that printing and exporting to PDF are one action.
6. WHERE the print action is activated while the Report_Cards_Page is in evaluate mode, THE Report_Cards_Page SHALL mount and lay out the Report_Document before invoking the print dialog by positioning it outside the visible viewport, and SHALL not set the Report_Document or any of its ancestors to a state that removes it from layout.
7. WHEN the Print_Stylesheet applies, THE Print_Stylesheet SHALL hide every element of the App_Chrome by setting `display: none` on that App_Chrome element itself, and SHALL set `display: none` on no ancestor element of the Report_Document and on no ancestor element of a chart canvas inside the Report_Document, so that a canvas is always sized and rasterised into the print job.
8. WHEN the Print_Stylesheet applies, THE Print_Stylesheet SHALL clear the height and overflow constraints of the page container and view container that would otherwise confine the Report_Document to a scrolling box.
9. WHEN the Print_Stylesheet applies, THE Print_Stylesheet SHALL set the page size to A4 with 12 millimetre margins, SHALL prevent a page break inside each block named in criterion 1, and SHALL set exact colour rendering on the Report_Document root so that Term_Badge and rating colours are printed rather than stripped.
10. THE Chart_Components SHALL render with animation disabled, with automatic resizing disabled, with an explicit pixel width and height, and at a device pixel ratio of 2, so that a media change to print cannot rebuild a canvas at a different size while the print job is laid out.
11. WHERE no student is selected, WHEN a print is requested, THE Print_Stylesheet SHALL cause a stated notice to be printed asking the user to select a student, rather than an empty page.
12. WHERE a student has zero Evaluation_Records, WHEN the Report_Document renders, THE Report_Document SHALL print the Grade_Band `NOT YET ASSESSED` with no numeric score, SHALL print the empty-state message in place of the radar, and SHALL remain available for preview and printing.
13. THE Report_Document SHALL render every lesson topic, instructor remark and instructor name as escaped text content, and SHALL set no element content from unescaped markup.

### Requirement 6: Reach a student's report card from the places staff already work

**User Story:** As an instructor, I want to open a student's report card from the navigation or straight from that student's row in the student list, so that I do not search for the student twice.

#### Acceptance Criteria

1. THE Sidebar SHALL display a New Operations navigation control labelled for report cards, positioned between the Students control and the Instructors control, and WHEN that control is activated, THE App_Shell SHALL render the Report_Cards_Page.
2. WHEN the Report_Cards_Page is opened from the Sidebar, THE App_Shell SHALL set the browser address path to `/new/report-cards`.
3. THE Students_Page SHALL display in each student row's actions cell a third control that opens the report card for that student, alongside the existing edit and delete controls, and SHALL expose an accessible name on that control identifying it as the report card for that row's student.
4. WHEN the report card control of a student row is activated, THE Students_Page SHALL request navigation to the Report_Cards_Page carrying that student's identifier and name as navigation parameters.
5. WHEN the Report_Cards_Page receives a navigation parameter holding a student identifier, THE Report_Cards_Page SHALL select the student holding that identifier, both on first render and on each subsequent change of that parameter.
6. WHERE the Report_Cards_Page receives no student identifier parameter, THE Report_Cards_Page SHALL select the first student of the currently selected Program_Category, and WHERE that category holds no student, THE Report_Cards_Page SHALL select no student and display a stated prompt to select a student.
7. THE Student_Selector_Panel SHALL display one tab per Program_Category and SHALL list under each tab exactly those students whose level resolves to that Program_Category, so that every student appears under exactly one tab.
8. THE Student_Selector_Panel SHALL filter the listed students by a search value compared case-insensitively against student name, parent name and contact, by a branch value and by a status value, using the same filter predicate module that the Students_Page uses, so that the two screens cannot filter differently.
9. WHEN the Report_Cards_Page loads, THE Report_Cards_Page SHALL subscribe to the Student_Registry with the existing 3 second polling helper, and SHALL request the Evaluation_Records and Term_Records of the selected student once per student selection rather than on a poll.
10. WHEN the selected student changes, THE Report_Cards_Page SHALL request that student's Evaluation_Records and Term_Records and SHALL render the derived values of Requirement 3 and Requirement 4 for that student.
