# Requirements Document

## Introduction

Staff need to clear the entire New Operations student list in one action so the registry can be
repopulated from a new CRM, instead of deleting 26+ records one row at a time. The action is
irreversible, so the feature is built around a required export, a typed confirmation, an
Admin-only control, an all-or-nothing transaction, and an audit entry.

Scope is deliberately narrow. The wipe removes student records and the two data sets that are
keyed to them and would otherwise be orphaned: branch history and live lesson progress. It leaves
the weekly class schedule, instructors, leave, operational rules and CRM leads intact.

One consequence of that boundary is worth stating up front, because it is a real behaviour change
rather than a defect: class records store student names as plain text, not as references. After a
wipe, class rows keep those names while the registry is empty, so the Schedule page's "Unallocated
Students" panel reads zero and its student-level lock has nothing to look up until the new list is
imported. This document requires that the confirmation dialog says so before the user commits.

A second boundary is authorisation. The New Operations API is guarded by one shared secret and
treats every same-origin browser request as trusted, with no per-user identity attached. Role
information exists on the client only. The wipe is therefore gated by role in the interface and by
a required confirmation field on the request, which together prevent an unauthorised screen and an
accidental scripted call. Per-user server-side authorisation is out of scope for this feature.

## Glossary

- **Student_Database_Page**: The New Operations "Student Database" screen that lists, filters and edits student records.
- **Wipe_Control**: The destructive-action control in the Student_Database_Page header that starts a Wipe_Operation.
- **Wipe_Confirmation_Dialog**: The modal that collects the export and the typed Confirmation_Phrase before a Wipe_Operation runs.
- **Student_Export**: The component that generates a downloadable spreadsheet file of the Student_Registry.
- **Bulk_Wipe_Service**: The server-side handler that executes a Wipe_Operation against stored data.
- **Wipe_Operation**: One execution of the bulk deletion described in Requirement 4.
- **Student_Registry**: The stored set of student records, one record per student, holding name, level, branch, parent name, contact, status and remarks.
- **Student_Branch_History**: Stored records of a student's branch moves, keyed by student identifier.
- **Local_Branch_History**: The per-browser copy of branch-move entries held in browser storage, keyed by student identifier.
- **Live_Progress_Records**: Stored per-student lesson progress records, keyed by student name.
- **Class_Schedule**: The stored weekly class records. Each record holds student names as text values rather than references to the Student_Registry.
- **Protected_Data_Sets**: Class_Schedule, instructor records, leave records, operational rules and CRM lead records.
- **Confirmation_Phrase**: The exact text `DELETE ALL STUDENTS`.
- **Authorised_Role**: The `Admin` role.
- **Signed_In_User**: The account currently authenticated in the browser session.
- **Activity_Log**: The shared audit trail that records who changed what, with an action, a source, a summary, an affected-record count and a user email.

## Requirements

### Requirement 1: Restrict the wipe to Admin users

**User Story:** As an Admin, I want the wipe control visible only to Admin accounts, so that other staff cannot erase the student list.

#### Acceptance Criteria

1. WHERE the Signed_In_User holds the Authorised_Role, WHEN the Student_Database_Page renders its panel header, THE Student_Database_Page SHALL display the Wipe_Control in that header alongside the "Add Student" control.
2. WHERE the Signed_In_User holds any recorded role other than the Authorised_Role, THE Student_Database_Page SHALL render the panel header with the "Add Student" control as its only action control and with no Wipe_Control present in the rendered page.
3. WHERE no role is recorded for the Signed_In_User, or no Signed_In_User account identifier is available to the Student_Database_Page, THE Student_Database_Page SHALL resolve the Signed_In_User to a role other than the Authorised_Role and SHALL render the panel header with the "Add Student" control as its only action control.
4. WHILE the Wipe_Confirmation_Dialog is open, IF the Signed_In_User's role changes to a role other than the Authorised_Role, THEN THE Student_Database_Page SHALL close the Wipe_Confirmation_Dialog within 1 second of the role change, discard any text typed in the confirmation input, and leave the Student_Registry, Student_Branch_History and Live_Progress_Records unchanged in record count and field values.
5. THE Wipe_Control SHALL render with the same destructive visual styling that the Student_Database_Page applies to the per-row delete control, with no additional style overrides.
6. WHERE the Wipe_Control is displayed, THE Student_Database_Page SHALL place the Wipe_Control in the keyboard tab order of the panel header immediately after the "Add Student" control, SHALL show a visible focus indicator while the Wipe_Control holds keyboard focus, and SHALL open the Wipe_Confirmation_Dialog when the focused Wipe_Control receives an Enter or Space key press.
7. THE Wipe_Control SHALL expose an accessible name to assistive technology that identifies the action as deleting all student records and states that the action cannot be undone.
8. IF a Wipe_Operation is initiated from the Student_Database_Page while the Signed_In_User holds a role other than the Authorised_Role, THEN THE Student_Database_Page SHALL send no request to the Bulk_Wipe_Service, SHALL display an error notification indicating that the action requires the Authorised_Role, and SHALL leave the Student_Registry, Student_Branch_History and Live_Progress_Records unchanged.

### Requirement 2: Export the current list before any deletion

**User Story:** As an Admin, I want a downloaded copy of the student list before it is deleted, so that I can recover the data if the new CRM import goes wrong.

#### Acceptance Criteria

1. WHEN the Signed_In_User activates the Wipe_Control, THE Wipe_Confirmation_Dialog SHALL present the export action in an enabled state.
2. WHEN the Signed_In_User activates the export action, THE Student_Export SHALL generate one spreadsheet file in the same `.xlsx` format used for the schedule import template, named with a fixed student-export prefix followed by the export date, containing one row per Student_Registry record across every branch, and SHALL finish generating that file within 10 seconds for a Student_Registry holding up to 10,000 records.
3. WHEN the Student_Export generates a file, THE Student_Export SHALL write a first row of column headers naming the identifier, name, level, branch, parent name, contact, status and remarks fields in that order, followed by one row per record carrying those eight values in the matching column order, writing an empty text value for any field the record does not hold and truncating no value.
4. THE Student_Export SHALL export every Student_Registry record regardless of the search text, level filter, branch filter and status filter active on the Student_Database_Page, including records held in a status other than `Active`.
5. WHEN the Student_Export hands a generated file to the browser for download without raising an error, THE Wipe_Confirmation_Dialog SHALL record the export as completed for the current dialog session and SHALL enable the confirmation input.
6. IF the Student_Export raises an error while generating a file, or does not finish generating the file within the 10-second bound stated in criterion 2, THEN THE Wipe_Confirmation_Dialog SHALL display an error message identifying the cause of the export failure and SHALL keep the confirmation input and the wipe action disabled.
7. WHILE no export has been recorded as completed since the Wipe_Confirmation_Dialog was last opened, THE Wipe_Confirmation_Dialog SHALL keep the wipe action disabled.
8. WHEN the Signed_In_User activates the Wipe_Control, THE Wipe_Confirmation_Dialog SHALL present the confirmation input in a disabled state accompanied by a message stating that the export must complete before the Confirmation_Phrase can be typed.
9. WHERE the Student_Registry holds zero records, WHEN the Signed_In_User activates the export action, THE Student_Export SHALL generate a file containing the header row stated in criterion 3 and zero record rows.
10. IF an export attempt fails, THEN THE Wipe_Confirmation_Dialog SHALL keep the export action enabled and SHALL accept further export attempts with no maximum attempt count.

### Requirement 3: Require a typed confirmation that states the scope

**User Story:** As an Admin, I want to type an exact phrase and see precisely what will be deleted, so that I cannot erase the list by a mis-click.

#### Acceptance Criteria

1. WHEN the Signed_In_User activates the Wipe_Control, THE Wipe_Confirmation_Dialog SHALL display the number of Student_Registry records held at the moment the dialog opened, as a whole number of 0 or greater.
2. WHEN the Signed_In_User activates the Wipe_Control, THE Wipe_Confirmation_Dialog SHALL name Student_Registry, Student_Branch_History and Live_Progress_Records as the data to be deleted, SHALL name the Protected_Data_Sets as the data to be kept, and SHALL expose that naming text as the accessible description of the dialog.
3. WHEN the Signed_In_User activates the Wipe_Control, THE Wipe_Confirmation_Dialog SHALL state that Class_Schedule records keep their stored student names and that the Schedule page reports zero unallocated students until a new list is imported.
4. THE Wipe_Confirmation_Dialog SHALL display the Confirmation_Phrase `DELETE ALL STUDENTS` as the text the Signed_In_User is required to type.
5. WHILE the confirmation input value with leading and trailing whitespace removed differs from the Confirmation_Phrase `DELETE ALL STUDENTS` under a character-for-character case-sensitive comparison, THE Wipe_Confirmation_Dialog SHALL keep the wipe action disabled.
6. WHEN the confirmation input value changes by any input method, including typed characters, deletion of characters, paste, autofill and value replacement performed without keystrokes, THE Wipe_Confirmation_Dialog SHALL re-evaluate the comparison required by criterion 5 and update the enabled state of the wipe action within 300 milliseconds of the change.
7. WHEN the Signed_In_User cancels the Wipe_Confirmation_Dialog by activating the cancel control, by pressing the Escape key, or by activating a point outside the dialog boundary, THE Student_Database_Page SHALL close the dialog and leave the Student_Registry, Student_Branch_History and Live_Progress_Records unchanged in record count and in field values.
8. WHEN the Signed_In_User reopens the Wipe_Confirmation_Dialog after cancelling by any of the three cancel routes named in criterion 7, THE Wipe_Confirmation_Dialog SHALL present an empty confirmation input and a disabled wipe action.
9. WHERE any of the search text, level filter, branch filter or status filter on the Student_Database_Page is set to a value other than its unfiltered default, THE Wipe_Confirmation_Dialog SHALL state that the Wipe_Operation covers every Student_Registry record rather than the filtered rows on screen.
10. WHILE the Wipe_Confirmation_Dialog is open, THE Wipe_Confirmation_Dialog SHALL display the count required by criterion 1 as the total Student_Registry record count captured at the moment the dialog opened, independent of the search text, level filter, branch filter and status filter active on the Student_Database_Page.
11. WHEN the Wipe_Confirmation_Dialog opens, THE Wipe_Confirmation_Dialog SHALL place initial keyboard focus on the export action rather than on the confirmation input or the wipe action.
12. WHILE the Wipe_Confirmation_Dialog is open, THE Wipe_Confirmation_Dialog SHALL confine forward and backward keyboard focus movement to the controls inside the dialog, moving from the last control to the first control and from the first control to the last control.
13. WHEN the Wipe_Confirmation_Dialog closes, THE Student_Database_Page SHALL return keyboard focus to the Wipe_Control.

### Requirement 4: Delete the student list and its keyed side data only

**User Story:** As an Admin, I want the wipe to clear the student list and the records keyed to it, so that no orphaned rows remain and no other operational data is lost.

#### Acceptance Criteria

1. WHEN the Bulk_Wipe_Service executes a Wipe_Operation, THE Bulk_Wipe_Service SHALL delete every Student_Registry record that exists at the start of that Wipe_Operation's database transaction, across every branch.
2. WHEN the Bulk_Wipe_Service executes a Wipe_Operation, THE Bulk_Wipe_Service SHALL delete every Student_Branch_History record whose student identifier is an exact, character-for-character match of the identifier of a deleted Student_Registry record.
3. WHEN the Bulk_Wipe_Service executes a Wipe_Operation, THE Bulk_Wipe_Service SHALL delete every Live_Progress_Records record whose student name matches the name of a deleted Student_Registry record under the name-matching rule stated in criterion 11, including all such records when two or more of them carry the same name.
4. WHEN the Bulk_Wipe_Service executes a Wipe_Operation, THE Bulk_Wipe_Service SHALL leave every Live_Progress_Records record whose student name matches the name of no deleted Student_Registry record under the name-matching rule stated in criterion 11 unchanged in count and in field values.
5. WHEN the Bulk_Wipe_Service executes a Wipe_Operation, THE Bulk_Wipe_Service SHALL leave every record in the Protected_Data_Sets unchanged in count and in field values, including the student-name text values held in Class_Schedule records.
6. WHEN a Wipe_Operation completes successfully, THE Student_Database_Page SHALL remove every Local_Branch_History entry within 5 seconds of receiving the success response.
7. IF removing Local_Branch_History entries fails, THEN THE Student_Database_Page SHALL report the Wipe_Operation as successful, SHALL retain in browser storage every Local_Branch_History entry that was not removed, and SHALL record the storage failure in the browser console.
8. WHEN the Bulk_Wipe_Service commits a Wipe_Operation, THE Student_Registry SHALL hold zero records at the point of commit.
9. THE Bulk_Wipe_Service SHALL delete every Student_Registry record regardless of the search text, level filter, branch filter and status filter active on the Student_Database_Page, including records held in a status other than `Active`.
10. WHEN the Bulk_Wipe_Service executes a Wipe_Operation, THE Bulk_Wipe_Service SHALL leave every instructor record and every CRM lead record unchanged in count and in field values, including records whose name matches the name of a deleted Student_Registry record under the name-matching rule stated in criterion 11.
11. THE Bulk_Wipe_Service SHALL treat a Live_Progress_Records student name as matching a Student_Registry name only when the two values are equal after removing leading and trailing whitespace from each value and disregarding letter case, and SHALL evaluate this rule against every Live_Progress_Records record so that all records sharing one matched name are selected.
12. IF a deleted Student_Registry record holds a name that is empty or consists only of whitespace, THEN THE Bulk_Wipe_Service SHALL select no Live_Progress_Records record on the basis of that name and SHALL leave every Live_Progress_Records record that matches no other deleted Student_Registry name unchanged in count and in field values.
13. WHEN the Bulk_Wipe_Service executes a Wipe_Operation, THE Bulk_Wipe_Service SHALL leave unchanged in count and in field values every Student_Branch_History record whose student identifier matched no Student_Registry record at the start of that Wipe_Operation's database transaction.

### Requirement 5: Guard the deletion endpoint against accidental calls

**User Story:** As an Admin, I want the bulk delete to be impossible to trigger by a stray request, so that a mistaken script or agent call cannot empty the registry.

#### Acceptance Criteria

1. THE Bulk_Wipe_Service SHALL treat a deletion request as a Wipe_Operation request only where that request carries a confirmation value in its request body whose text, after leading and trailing whitespace is removed, matches the Confirmation_Phrase character for character in a case-sensitive comparison.
2. IF a deletion request carries no student identifier and carries a request body that holds no confirmation value, holds a confirmation value that is empty or whitespace only, or cannot be read as a set of named values, THEN THE Bulk_Wipe_Service SHALL return status 400 with an error message indicating that the confirmation phrase is required, SHALL delete zero records, and SHALL leave the record counts and field values of the Student_Registry, Student_Branch_History and Live_Progress_Records unchanged.
3. IF a deletion request carries a confirmation value that differs from the Confirmation_Phrase after leading and trailing whitespace is removed, including a value that differs only in letter case, THEN THE Bulk_Wipe_Service SHALL return status 400 with an error message indicating that the confirmation phrase does not match, SHALL delete zero records, and SHALL leave the record counts and field values of the Student_Registry, Student_Branch_History and Live_Progress_Records unchanged.
4. WHEN a deletion request identifies a single student record by identifier in the request query string, THE Bulk_Wipe_Service SHALL delete that one record, SHALL require no confirmation value for that request, and SHALL leave every other Student_Registry record unchanged.
5. IF a deletion request carries neither a student identifier in its query string nor a confirmation value in its body, THEN THE Bulk_Wipe_Service SHALL return status 400 with an error message indicating that either a student identifier or the Confirmation_Phrase is required, SHALL delete zero records, and SHALL leave the record counts and field values of the Student_Registry, Student_Branch_History and Live_Progress_Records unchanged.
6. WHEN a deletion request carries both a student identifier in its query string and a confirmation value in its body, THE Bulk_Wipe_Service SHALL apply the single-record deletion of criterion 4, SHALL execute no Wipe_Operation, and SHALL leave every other Student_Registry record unchanged.
7. IF a deletion request carries a student identifier that matches no Student_Registry record, THEN THE Bulk_Wipe_Service SHALL return status 404 with an error message indicating that the student record was not found, SHALL delete zero records, and SHALL leave the record counts and field values of the Student_Registry, Student_Branch_History and Live_Progress_Records unchanged.
8. THE Bulk_Wipe_Service SHALL apply the confirmation requirement of criterion 1 to every deletion request admitted by the New Operations API guard, including requests admitted as same-origin browser requests and requests admitted by the shared API key.

### Requirement 6: Complete the deletion as one all-or-nothing unit

**User Story:** As an Admin, I want the wipe to either finish completely or change nothing, so that a failure part-way through cannot leave the database in a mixed state.

#### Acceptance Criteria

1. THE Bulk_Wipe_Service SHALL execute the Student_Registry, Student_Branch_History and Live_Progress_Records deletions of a single Wipe_Operation within one database transaction, and SHALL commit that transaction only after all three deletions have succeeded.
2. IF any deletion within a Wipe_Operation fails, or the database connection is lost before the transaction is committed, THEN THE Bulk_Wipe_Service SHALL discard every deletion of that Wipe_Operation and return status 500 with the failure reason.
3. IF a Wipe_Operation fails, THEN THE Student_Registry, Student_Branch_History and Live_Progress_Records SHALL hold the same record counts and the same field values they held before the Wipe_Operation started.
4. IF a Wipe_Operation fails, THEN THE Student_Database_Page SHALL display an error notification carrying the failure reason, SHALL keep the Wipe_Confirmation_Dialog open with the typed confirmation value and the completed-export state of the current dialog session preserved, and SHALL re-enable the wipe action within 1 second of receiving the failure response so that the Signed_In_User can retry.
5. WHEN the Bulk_Wipe_Service executes a Wipe_Operation against a Student_Registry holding zero records, THE Bulk_Wipe_Service SHALL return a success response reporting zero deleted Student_Registry records, zero deleted Student_Branch_History records and zero deleted Live_Progress_Records records.
6. WHILE a Wipe_Operation is in progress, THE Wipe_Confirmation_Dialog SHALL keep the wipe action and the cancel action disabled and SHALL display a progress indicator within 1 second of the wipe action being activated.
7. WHILE a Wipe_Operation is in progress, IF the Signed_In_User activates the wipe action again, THEN THE Student_Database_Page SHALL send no further deletion request for that Wipe_Operation and SHALL leave the in-progress Wipe_Operation running.
8. IF the transaction of a Wipe_Operation has not been committed within 30 seconds of the Bulk_Wipe_Service starting it, THEN THE Bulk_Wipe_Service SHALL discard every deletion of that Wipe_Operation and return status 500 with an error indicating that the operation exceeded its 30-second time limit.
9. IF the Student_Database_Page receives no response from the Bulk_Wipe_Service within 30 seconds of sending a deletion request, THEN THE Student_Database_Page SHALL display a notification stating that the outcome of the Wipe_Operation is unconfirmed rather than a success notification, and SHALL state that reloading the Student_Database_Page shows the current Student_Registry record count.

### Requirement 7: Report how many records were removed

**User Story:** As an Admin, I want to see the number of records actually deleted, so that I can confirm the registry is clear before importing the new CRM data.

#### Acceptance Criteria

1. WHEN a Wipe_Operation succeeds, THE Bulk_Wipe_Service SHALL return a success response carrying three separate counts, each an integer of 0 or greater: the number of deleted Student_Registry records, the number of deleted Student_Branch_History records and the number of deleted Live_Progress_Records records, and SHALL include all three counts even when a count equals 0.
2. WHEN a Wipe_Operation succeeds, THE Student_Database_Page SHALL display a success notification within 2 seconds of receiving the success response, stating the number of deleted Student_Registry records reported by the Bulk_Wipe_Service in singular wording when that number equals 1 and in plural wording for every other value, keep the notification visible for at least 5 seconds, and render the notification in a region that assistive technology announces without moving keyboard focus.
3. IF the number of deleted Student_Registry records reported by the Bulk_Wipe_Service differs from the count displayed in the Wipe_Confirmation_Dialog, THEN THE Student_Database_Page SHALL display the number reported by the Bulk_Wipe_Service as the only deleted-record count shown, SHALL omit the count previously displayed in the Wipe_Confirmation_Dialog, and SHALL report the Wipe_Operation as successful.
4. WHEN a Wipe_Operation succeeds, THE Student_Database_Page SHALL close the Wipe_Confirmation_Dialog within 2 seconds of receiving the success response and SHALL return keyboard focus to the panel header that holds the Wipe_Control.
5. WHEN a Wipe_Operation succeeds, THE Student_Database_Page SHALL reload the Student_Registry records from the Bulk_Wipe_Service and render the reloaded record set within 5 seconds of receiving the success response.
6. WHILE the reloaded Student_Registry record set holds zero records, THE Student_Database_Page SHALL display the "No Students Registered" empty state in place of the student table rows.
7. IF reloading the Student_Registry records after a successful Wipe_Operation fails, THEN THE Student_Database_Page SHALL keep the success notification of criterion 2 displayed, SHALL display an additional notification indicating that the student list could not be refreshed and offering a retry action, and SHALL report the Wipe_Operation as successful.
8. WHERE the Student_Registry holds zero records, THE Student_Database_Page SHALL present the Wipe_Control in a disabled state that performs no action on activation, and SHALL expose a tooltip stating that the student list is already empty on pointer hover and on keyboard focus.

### Requirement 8: Record the wipe in the audit trail

**User Story:** As a supervisor, I want every wipe recorded with who ran it and how many records went, so that the deletion is traceable after the fact.

#### Acceptance Criteria

1. WHEN a Wipe_Operation succeeds, THE Student_Database_Page SHALL write exactly one Activity_Log entry, with the action value `bulk` and the source value `students`, within 5 seconds of receiving the success response from the Bulk_Wipe_Service.
2. WHEN a Wipe_Operation succeeds, THE Student_Database_Page SHALL set the affected-record count of the Activity_Log entry to the number of deleted Student_Registry records reported by the Bulk_Wipe_Service, including the value zero when the Bulk_Wipe_Service reports zero deleted Student_Registry records.
3. WHERE the Signed_In_User has an email address recorded, WHEN a Wipe_Operation succeeds, THE Student_Database_Page SHALL set the user value of the Activity_Log entry to that email address unchanged.
4. WHEN a Wipe_Operation succeeds, THE Student_Database_Page SHALL set the summary of the Activity_Log entry to text of at most 500 characters that names Student_Registry, Student_Branch_History and Live_Progress_Records together with the deleted record count reported by the Bulk_Wipe_Service for each of those three data sets.
5. IF writing the Activity_Log entry fails, THEN THE Student_Database_Page SHALL retry the write once within 2 seconds, and IF the retry also fails, THEN THE Student_Database_Page SHALL report the Wipe_Operation as successful, record the logging failure in the browser console, and leave the deleted record counts reported to the Signed_In_User unchanged.
6. WHERE the Signed_In_User has no email address recorded, WHEN a Wipe_Operation succeeds, THE Student_Database_Page SHALL write the Activity_Log entry required by criterion 1 with a user value indicating an unidentified user rather than omitting the entry.
7. IF a Wipe_Operation fails, THEN THE Student_Database_Page SHALL write exactly one Activity_Log entry with the action value `bulk`, the source value `students`, an affected-record count of zero, and a summary stating that the wipe attempt failed and that no records were deleted.

### Requirement 9: Behave predictably when repeated or run against a changing list

**User Story:** As an Admin, I want a second wipe and a wipe during live edits to behave predictably, so that repeated attempts cannot corrupt the registry or mislead me about the result.

#### Acceptance Criteria

1. WHEN the Bulk_Wipe_Service receives a bulk deletion request carrying the Confirmation_Phrase while the Student_Registry holds zero records, THE Bulk_Wipe_Service SHALL return a success response reporting zero deleted Student_Registry records, zero deleted Student_Branch_History records and zero deleted Live_Progress_Records records, irrespective of the time elapsed since the preceding Wipe_Operation.
2. WHEN the Bulk_Wipe_Service executes a Wipe_Operation, THE Bulk_Wipe_Service SHALL delete every Student_Registry record held at the moment the Wipe_Operation transaction starts, including records created after the Wipe_Confirmation_Dialog opened.
3. WHEN a Wipe_Operation succeeds, THE Student_Database_Page SHALL set the displayed page number to 1 within 5 seconds of receiving the success response.
4. WHEN a Wipe_Operation succeeds, THE Student_Database_Page SHALL leave the search text, level filter, branch filter and status filter values unchanged from the values held when the Wipe_Control was activated.
5. WHILE the Wipe_Confirmation_Dialog is open, THE Wipe_Confirmation_Dialog SHALL hold the displayed Student_Registry record count at the value read when the dialog opened, unchanged by any Student_Database_Page list refresh, and SHALL state that the Wipe_Operation deletes every record held when the wipe runs, which may differ from the displayed count.
6. IF the Bulk_Wipe_Service receives a second bulk deletion request carrying the Confirmation_Phrase while a Wipe_Operation is in progress, THEN THE Bulk_Wipe_Service SHALL start the second request only after the in-progress Wipe_Operation transaction has ended, and SHALL return for the second request a success response reporting zero deleted Student_Registry records.
7. IF a request to update a Student_Registry record identifies a record that a completed Wipe_Operation has deleted, THEN THE Bulk_Wipe_Service SHALL reject the request with an error indicating that the record no longer exists and SHALL leave the Student_Registry at zero records.
