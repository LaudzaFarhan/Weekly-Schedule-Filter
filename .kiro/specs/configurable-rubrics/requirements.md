# Requirements Document

## Introduction

The report card rubric is the same five competencies for every student in the school —
Concept, Building, Problem Solving, Focus and Attitude — because those five are five
`NOT NULL` columns on `internal_student_evaluations`. A Coder student is graded on
"Building" whether or not the Coder curriculum builds anything. This feature lets an
administrator add, rename, recolour, reorder and remove the competencies an evaluation is
scored against, independently for each of the three program categories.

The scope key is **Program_Category** — Kinder, Junior and Coder, three setups — matching
the K / J / C tabs the Report Cards page already uses. Per-level rubrics were considered
and rejected as more to maintain than the school needs.

Only the *set* of competencies becomes configurable. Every competency is still scored 1 to
5, and the grade bands are unchanged, because the bands are defined over a mean in `[1,5]`.
Making the scale configurable would invalidate every stored score and every printed report,
and is out of scope here.

Three structural decisions are stated as requirements rather than left to implementation
taste, because each one has a consequence a reader should be able to object to now.

First, the scores move from five named columns into one Score_Map keyed by
Competency_Key. That buys a variable set and costs the database `CHECK` that kept every
score inside 1 to 5, so the Evaluation_Validator becomes the only guard on a score's range
and its key. Requirement 3 pins that guard down. The five old columns are kept, nullable
and unread, so the change is reversible against a database holding real evaluations.

Second, a Competency_Key is immutable and a removal is a deactivation, not a delete.
The key is the join between a rubric and every score already stored against it, so renaming
"Focus" to "Attention" changes the label and leaves the key alone, and dropping Focus from
Kinder leaves last month's focus scores in place, interpretable and restorable.

Third, editing a rubric does not rewrite stored evaluations, and display is driven by the
*current* rubric. The consequence to accept is that **a printed report card reflects
today's rubric, not the rubric in force when the student was scored.** For a school report
that is the desired reading — parents compare like with like — but it means two cards a
year apart can differ in their rows with nothing on paper explaining why.

Two rules carried over from the existing report cards feature are restated here because a
variable set is exactly where they would quietly break. A missing score abstains: it is
excluded from that competency's mean, never counted as zero, so adding a competency to a
rubric cannot drag down the averages of evaluations recorded before it existed. And a
number is never invented: a competency no evaluation in range has scored has no value at
all, and nothing prints `0.0 / 5` for it.

## Glossary

- **Program_Category**: One of the three values `Kinder`, `Junior`, `Coder`, derived from a student's level by the existing category resolution.
- **Competency**: One assessed dimension of one Program_Category, holding a Competency_Key, a Competency_Label, a colour, a sort position, a Descriptor_Set and an active flag.
- **Competency_Key**: The stable, immutable text identifier of a Competency, and the only value a Competency_Score is stored against.
- **Competency_Label**: The editable on-screen and printed heading of a Competency.
- **Active_Competency**: A Competency whose active flag is true.
- **Rubric**: The ordered set of Active_Competencies of one Program_Category.
- **Rubric_Store**: The stored set of Competencies across all three Program_Categories (table `internal_rubric_competencies`).
- **Rubric_API**: The server-side endpoint `/api/new/rubric-competencies` exposing Competencies.
- **Rubric_Defaults_Module**: The module (`src/lib/reportCardRubric.js`) holding the five default Competencies and their Descriptor_Sets, used to seed the Rubric_Store and used as the fallback Rubric.
- **Descriptor_Set**: The five Rubric_Descriptors of one Competency, one for each Competency_Score from 1 to 5.
- **Rubric_Descriptor**: The wording that describes one Competency at one Competency_Score value.
- **Competency_Score**: An integer from 1 to 5 inclusive recording one Competency for one Evaluation_Record.
- **Score_Map**: The stored mapping of Competency_Key to Competency_Score held on one Evaluation_Record (column `scores`).
- **Evaluation_Record**: One stored evaluation of one student for one lesson number, holding a Score_Map plus the existing optional lesson topic, instructor remarks and instructor name.
- **Evaluation_Store**: The stored set of Evaluation_Records (table `internal_student_evaluations`).
- **Evaluation_API**: The existing server-side endpoint `/api/new/student-evaluations`.
- **Evaluation_Validator**: The server-side function that accepts or rejects an untrusted Evaluation_Record payload (`src/lib/evaluationValidation.js`).
- **Rubric_Migration**: The one idempotent step that seeds the Rubric_Store from the Rubric_Defaults_Module, backfills every Score_Map from the five legacy columns, and relaxes those columns' not-null constraints.
- **Legacy_Score_Columns**: The five columns `concept`, `building`, `problem_solving`, `focus`, `attitude` on `internal_student_evaluations`.
- **Report_Derivation_Module**: The existing single pure module (`src/lib/reportCard.js`) that computes Competency_Averages, the Overall_Grade and the Lesson_Series.
- **Competency_Averages**: The arithmetic mean of each Active_Competency over the Evaluation_Records currently in range, or no value for a Competency that none of them scored.
- **Overall_Grade**: The pair of a displayed score and a Grade_Band label derived from the Competency_Averages.
- **Grade_Band**: One of the labels `EXCELLENT`, `VERY GOOD`, `GOOD`, `DEVELOPING`, `BEGINNING`, `NOT YET ASSESSED`.
- **Lesson_Series**: The existing ordered chart series of lesson labels, per-evaluation mean values and source dates.
- **Rubric_Setup_Page**: The New Operations "Rubrics and Setup" screen at `/new/report-cards/rubric` that displays and edits the Rubric_Store.
- **Report_Cards_Page**: The New Operations "Report Cards" evaluate screen at `/new/report-cards`.
- **Evaluation_Form**: The Report_Cards_Page control group that captures a lesson number, a lesson topic, an instructor name, the Competency_Scores and instructor remarks, and saves them.
- **Radar_Chart**: The Performance Breakdown radar rendering the Competency_Averages.
- **Report_Document**: The printable one-page Student Learning Journey Report, rooted at the element with id `report-card-print`.
- **Record_Mapper**: The per-endpoint whitelist function that converts a stored row into the API record shape.
- **Activity_Log**: The shared audit trail that records an action, a source, a summary, an affected-record count and a user email.

## Requirements

### Requirement 1: Hold a separate competency set for each program category

**User Story:** As an administrator, I want each program to be graded on the competencies that program actually teaches, so that a Coder student is not scored on a dimension their curriculum does not cover.

#### Acceptance Criteria

1. THE Rubric_Store SHALL hold for each Competency a Program_Category, a Competency_Key, a Competency_Label, a colour, a sort position, a Descriptor_Set and an active flag, and SHALL hold at most one Competency for any one pair of Program_Category and Competency_Key.
2. THE Rubric_Store SHALL accept only the Program_Category values `Kinder`, `Junior` and `Coder`, and SHALL hold each Program_Category's Competencies independently, so that the same Competency_Key may be present in two Program_Categories carrying different labels, colours, sort positions and Descriptor_Sets.
3. THE Rubric_API SHALL provide no operation that changes the Competency_Key or the Program_Category of a stored Competency, and IF a request attempts to change either, THEN THE Rubric_API SHALL return status 400 with an error message stating that both are identity values and SHALL change no record, so that a stored Competency_Score can never lose the Competency it belongs to.
4. WHEN a create request supplies no Competency_Key, THE Rubric_API SHALL derive one from the Competency_Label by a deterministic rule that yields the same key for the same label, and WHERE the derived key is already held for that Program_Category, THE Rubric_API SHALL append a distinguishing suffix so that the created Competency_Key is unique within that Program_Category.
5. IF a create request carries a Competency_Key already held for that Program_Category, THEN THE Rubric_API SHALL return status 409 with an error message naming the Competency_Label of the existing Competency and SHALL write no record.
6. IF a request would leave a Program_Category holding zero Active_Competencies, THEN THE Rubric_API SHALL return status 400 with an error message stating that a Program_Category must keep at least one Active_Competency, and SHALL change no record, so that no sequence of requests can leave a Program_Category with nothing to score.
7. WHEN a Competency's Competency_Label, colour, sort position, Descriptor_Set or active flag is changed, THE Rubric_API SHALL leave the Score_Map of every Evaluation_Record unchanged, so that editing a rubric never rewrites a recorded assessment.
8. WHEN a Competency is deactivated and then reactivated with no intervening Evaluation_Record write, THE Report_Derivation_Module SHALL return the same Competency_Averages as before the deactivation, because a deactivation removes no stored Competency_Score.
9. THE Rubric_API SHALL delete a Competency outright if and only if no Evaluation_Record's Score_Map carries that Competency_Key, and IF at least one does, THEN THE Rubric_API SHALL return status 409 with an error message stating that count and directing the caller to deactivate the Competency instead, and SHALL delete no record.
10. WHERE the Rubric_Store holds no Competency for a Program_Category, or the Rubric_Store cannot be read, THE Evaluation_Form, THE Radar_Chart and THE Report_Document SHALL use the five Competencies of the Rubric_Defaults_Module as that Program_Category's Rubric, so that the evaluator never renders zero rating rows.
11. THE Rubric_Store SHALL hold one Rubric_Descriptor for each Competency_Score from 1 to 5 inclusive of each Competency, SHALL accept an empty Rubric_Descriptor, and THE Rubric_Descriptor lookup SHALL return a text value for every pair of arguments it is called with, non-empty exactly when the Competency holds a non-empty Rubric_Descriptor for that Competency_Score.
12. WHEN a Program_Category holds more than 8 Active_Competencies, THE Rubric_Setup_Page SHALL display a stated warning that the Radar_Chart becomes hard to read, and IF a request would leave a Program_Category holding more than 12 Active_Competencies, THEN THE Rubric_API SHALL return status 400 naming that bound and SHALL change no record.
13. WHEN the Rubric_API returns a list of Competencies, THE Rubric_API SHALL order them ascending by sort position and, for Competencies sharing a sort position, ascending by record identifier, so that the display order is total and does not vary between requests.
14. THE Rubric_Store SHALL hold no per-Program_Category score range and no per-Competency score range, because every Competency_Score is an integer from 1 to 5 inclusive and the Grade_Bands are defined over a mean in that range.

### Requirement 2: Edit a rubric from the Rubrics and Setup page

**User Story:** As an administrator, I want to change a program's competencies on screen, so that adapting the rubric does not require a developer or a database change.

#### Acceptance Criteria

1. THE Rubric_Setup_Page SHALL display one tab per Program_Category using the existing K, J and C letter controls, SHALL state the count of Active_Competencies on each tab, and SHALL edit exactly the Competencies of the selected tab's Program_Category.
2. THE Rubric_Setup_Page SHALL display for each Competency of the selected Program_Category its Competency_Label, its colour, its five Rubric_Descriptors and its active flag as editable values, and SHALL display its Competency_Key as a value that cannot be edited.
3. THE Rubric_Setup_Page SHALL provide a control that adds a Competency to the selected Program_Category, and SHALL keep that control's save action disabled while the new Competency_Label is empty after leading and trailing whitespace is removed.
4. THE Rubric_Setup_Page SHALL provide controls that move a Competency earlier and later in the display order, SHALL be operable by keyboard alone, and WHEN the order is changed, THE Rubric_Setup_Page SHALL write the resulting sort positions so that the stored order equals the displayed order.
5. WHEN the user requests the removal of a Competency, THE Rubric_Setup_Page SHALL request a deactivation rather than a delete WHERE any Evaluation_Record carries that Competency_Key, SHALL offer the delete only WHERE none does, and SHALL require an explicit confirmation stating that evaluations of that Program_Category will stop being scored on that Competency.
6. IF the Rubric_API rejects a change, THEN THE Rubric_Setup_Page SHALL display the error message returned by the Rubric_API and SHALL retain every value currently entered, so that a refused save loses no typing.
7. THE Rubric_Setup_Page SHALL display the Competencies whose active flag is false in a visually distinct and stated style, separately from the Active_Competencies, and SHALL provide a control that reactivates one.
8. WHEN a Competency is created, changed, deactivated, reactivated or deleted, THE Rubric_Setup_Page SHALL write one Activity_Log entry naming the Program_Category and the Competency_Label, and IF that write fails, THEN THE Rubric_Setup_Page SHALL report the change as successful.
9. THE Rubric_Setup_Page SHALL expose an accessible name on every editing control that identifies both the Competency_Label and the value being edited, and SHALL expose each Rubric_Descriptor field's accessible name as the Competency_Score it describes.
10. THE Rubric_Setup_Page SHALL display the full scoring guidelines table built from the Rubric_Store for the selected Program_Category, SHALL hold no Rubric_Descriptor text written into a component, and SHALL no longer display the notice stating that editing the rubric is unavailable.
11. WHEN the Rubric_Setup_Page saves a change, THE Report_Cards_Page SHALL render the changed Rubric on its next load of that Program_Category without requiring a full page reload.

### Requirement 3: Store one score per configured competency

**User Story:** As a developer, I want an evaluation to carry a score for whatever competencies its program defines, so that changing a rubric does not require a schema change.

#### Acceptance Criteria

1. THE Evaluation_Store SHALL hold each Evaluation_Record's Competency_Scores as one Score_Map keyed by Competency_Key, whose values are integers from 1 to 5 inclusive, and SHALL default that Score_Map to empty for a row that carries none.
2. WHEN the Evaluation_Validator receives a payload, THE Evaluation_Validator SHALL return the validated value if and only if the Score_Map carries an integer from 1 to 5 inclusive for every Active_Competency of the student's Program_Category and carries no other key; and for every other payload THE Evaluation_Validator SHALL return one non-empty error message that names the offending Competency or key.
3. IF a payload's Score_Map omits an Active_Competency, or carries an empty text value for one, THEN THE Evaluation_Validator SHALL return an error message naming that Competency_Label and stating that every Competency must be rated from 1 to 5, and SHALL return no validated value.
4. IF a payload carries a Competency_Score that is not an integer, or is an integer below 1, or is an integer above 5, THEN THE Evaluation_Validator SHALL return an error message naming that Competency_Label and carrying the received value, SHALL return no validated value, and SHALL store no substitute value in place of the received value, so that no Score_Map holds a value that no instructor entered.
5. IF a payload's Score_Map carries a key that is not the Competency_Key of an Active_Competency of that student's Program_Category, THEN THE Evaluation_Validator SHALL return an error message naming that key and SHALL return no validated value.
6. THE Evaluation_Validator SHALL be the only guard on a Competency_Score's range and on a Score_Map's keys, because the Score_Map is one JSON value and the Evaluation_Store can constrain neither; and THE feature documentation SHALL record that a write which bypasses the Evaluation_API is no longer refused by the Evaluation_Store.
7. WHEN the Rubric_Migration runs twice, THE Rubric_Store SHALL hold the same count of Competencies as after the first run and THE Evaluation_Store SHALL hold the same Score_Map for every Evaluation_Record as after the first run.
8. WHEN the Rubric_Migration runs, THE Rubric_Migration SHALL seed each of the three Program_Categories with the five Competencies of the Rubric_Defaults_Module using the Competency_Keys those five already carry in the API record shape, and SHALL set each Evaluation_Record's Score_Map from that record's Legacy_Score_Columns so that every value held in a Legacy_Score_Column before the Rubric_Migration is present in that record's Score_Map afterwards.
9. THE Evaluation_Store SHALL retain the Legacy_Score_Columns as columns that accept a null value and that nothing reads, so that the change is reversible against a database holding recorded evaluations; and THE feature documentation SHALL record their removal as a later, separate change.
10. WHEN the Evaluation_API or the Rubric_API handles a request, THE handling endpoint SHALL provision its table and apply the Rubric_Migration before issuing the first query of that request, and IF provisioning fails, THEN THE handling endpoint SHALL retain no cached success so that the next request attempts it again.
11. WHEN the Evaluation_API or the Rubric_API returns a record, THE Record_Mapper SHALL return exactly the documented keys of that record shape and SHALL omit every other key held on the stored row, including the Legacy_Score_Columns and any column added after this feature is released.
12. WHERE an Evaluation_Record's Score_Map carries a Competency_Key that no Active_Competency of that Program_Category defines, THE Report_Cards_Page and THE Report_Document SHALL display no value for it and THE Evaluation_Store SHALL retain it, so that deactivating a Competency hides its scores without destroying them.

### Requirement 4: Derive every displayed number over the active set

**User Story:** As a parent, I want the chart, the badge and the printed report to state the same numbers after the rubric changes as before, so that the report I keep is the assessment the instructor recorded.

#### Acceptance Criteria

1. WHEN the Report_Derivation_Module computes Competency_Averages over a set of Evaluation_Records and a Rubric, THE Report_Derivation_Module SHALL return one entry for each Active_Competency of that Rubric that at least one of those Evaluation_Records scores, and no entry for any other Competency_Key, including a Competency_Key held in a Score_Map but not in that Rubric.
2. THE Report_Derivation_Module SHALL compute each returned entry as the arithmetic mean of that Competency's Competency_Scores over exactly the Evaluation_Records that carry one, in the range 1 to 5 inclusive, SHALL return the same entries for any two orderings of the same set, and SHALL leave the supplied set and the supplied Rubric unchanged.
3. WHERE an Evaluation_Record carries no Competency_Score for an Active_Competency, THE Report_Derivation_Module SHALL exclude that Evaluation_Record from both the sum and the count of that Competency's mean and SHALL treat it as no value rather than as the value 0, so that adding a Competency to a Rubric changes no other Competency's mean and introduces no zero.
4. WHERE no Evaluation_Record in range carries a Competency_Score for an Active_Competency, THE Report_Derivation_Module SHALL return no value for that Competency, and THE Report_Cards_Page and THE Report_Document SHALL render no numeric value and no `/5` score text for it.
5. WHEN the Report_Derivation_Module computes the Overall_Grade, THE Report_Derivation_Module SHALL produce the arithmetic mean of exactly the Competency_Averages entries returned for that Rubric, and WHERE that set of entries is empty, THE Report_Derivation_Module SHALL return the Grade_Band `NOT YET ASSESSED` with no score value.
6. THE Report_Derivation_Module SHALL round the Overall_Grade score to one decimal place first and SHALL then select the Grade_Band from that rounded score using the existing thresholds, so that the Grade_Band recomputed from the displayed score always equals the displayed Grade_Band; and THE Grade_Band thresholds, labels and ranks SHALL be unchanged by this feature.
7. WHEN the Report_Derivation_Module computes the Lesson_Series, THE Report_Derivation_Module SHALL compute each point's value as the arithmetic mean of exactly the Competency_Scores that Evaluation_Record carries for the Active_Competencies of that Rubric, SHALL exclude an Evaluation_Record that carries none from the series, and SHALL leave the lesson ordering, the lesson labelling and the window value unchanged by this feature.
8. THE Report_Derivation_Module SHALL take the Rubric as an argument and SHALL read no Competency set from a module constant, so that the same set drives the Evaluation_Form, the Radar_Chart, the Overall_Grade and the Report_Document for one student.

### Requirement 5: Render and print however many competencies a program defines

**User Story:** As an instructor, I want the rating form, the chart and the printed page to follow the program's rubric, so that I score and hand over exactly what that program assesses.

#### Acceptance Criteria

1. WHEN the Evaluation_Form renders for a student, THE Evaluation_Form SHALL render one rating control group per Active_Competency of that student's Program_Category, in the stored sort order, each carrying that Competency's Competency_Label and colour, and SHALL render no rating control for an inactive Competency.
2. WHILE any Active_Competency of that student's Program_Category is unrated in the Evaluation_Form, THE Evaluation_Form SHALL keep its save action disabled.
3. WHILE a Competency_Score is selected in the Evaluation_Form, THE Evaluation_Form SHALL display the Rubric_Descriptor held in the Rubric_Store for that Competency and that Competency_Score beneath the rating control, and SHALL expose each of the five options with an accessible name stating the Competency_Score together with that Rubric_Descriptor.
4. WHEN the Radar_Chart renders, THE Radar_Chart SHALL render one axis per Competency_Averages entry returned for that student's Rubric, and WHERE fewer than three entries are returned, THE Report_Cards_Page SHALL render the numeric Competency Mastery Summary in place of the Radar_Chart, because a radar with fewer than three axes states nothing a shape can carry.
5. IF loading a chart component fails, THEN THE Report_Cards_Page SHALL render the numeric Competency Mastery Summary in its place, so that an assessment is never held only inside a canvas element.
6. THE Radar_Chart and THE Report_Document Competency Mastery Summary SHALL both render the Competency_Averages returned by one call of the Report_Derivation_Module for the same student and the same range, and THE Report_Document SHALL print each value to one decimal place followed by ` / 5.0`, so that every value plotted appears in the printed rows.
7. WHEN the Report_Document renders, THE Report_Document SHALL print one Competency Mastery Summary row per Active_Competency of that student's Program_Category, SHALL print each Competency_Label as held in the Rubric_Store, and WHERE a Competency has no value, THE Report_Document SHALL print a stated not-assessed marker in place of a number.
8. THE Print_Stylesheet SHALL lay out the Competency Mastery Summary and the Performance Breakdown block for a variable count of rows and axes, SHALL assume no fixed count of five, and SHALL keep the existing rule that no page break falls inside either block.
9. THE Report_Document SHALL render every Competency_Label and Rubric_Descriptor as escaped text content and SHALL set no element content from unescaped markup, because both are now values an administrator types.

### Requirement 6: Serve rubrics through a stable API contract

**User Story:** As a developer, I want the rubric endpoint to expose a fixed record shape and to refuse the changes that would corrupt stored scores, so that the page, the documentation and future callers agree on what a rubric is.

#### Acceptance Criteria

1. THE Rubric_API SHALL accept a list request carrying an optional Program_Category parameter, SHALL return only that Program_Category's Competencies when it is supplied, SHALL return all three Program_Categories' Competencies when it is absent, and SHALL return both active and inactive Competencies with the active flag on each record.
2. THE Rubric_API SHALL accept a create request, an update request carrying a record identifier, and a delete request that identifies exactly one Competency by identifier in the request query string, and SHALL provide no request form that deletes more than one Competency.
3. WHEN the Rubric_API builds a query from request parameters, THE Rubric_API SHALL pass every value taken from those request parameters as a bind parameter, SHALL produce a query clause whose count of bind placeholders equals the count of bind parameter values, and SHALL include no value taken from those request parameters as literal text in the query clause.
4. IF the Rubric_API receives an update or delete request carrying a record identifier that matches no Competency, THEN THE Rubric_API SHALL return status 404 with a stated error message and SHALL change and delete no record.
5. IF a create or update request carries an empty Competency_Label after leading and trailing whitespace is removed, a Competency_Label longer than 100 characters, a colour that is not a valid colour value, or a Program_Category outside the three permitted values, THEN THE Rubric_API SHALL return status 400 with an error message naming the offending field and SHALL write no record.
6. IF a database query raises an error, or no database connection string is configured, THEN THE Rubric_API SHALL return status 500 carrying the error message raised, and THE Rubric_Setup_Page SHALL retain the Competencies it last loaded successfully and display a retry notification.
7. THE published API description and the New Operations API documentation SHALL carry the list, create, update and delete operations of the Rubric_API together with the Program_Category list parameter, and SHALL record the Evaluation_API's Score_Map field in place of the five Legacy_Score_Columns.
8. THE feature documentation SHALL record that the Rubric_API cannot yet restrict editing to an administrator, because no server-side session exists until the `employee-accounts-postgres` feature lands, and SHALL record the intended restriction so that it is added with that feature rather than forgotten.
