# Pulse Schedule Spreadsheet Rules

This document outlines the required format and rules for Google Sheets to sync correctly with the Pulse Dashboard. Branch managers should follow these guidelines to ensure their schedules are accurately parsed by the system.

## 1. Tab (Sheet) Names

The system automatically scans the Google Sheet for tabs that match days of the week.
*   **Required**: You must have tabs for the operational days (Monday to Saturday).
*   **Naming**: The tab name must contain the English name of the day (e.g., "Monday", "Schedule Tuesday", "Wed"). It is case-insensitive.
*   **Note**: Sunday tabs are ignored by the system.

## 2. Column Headers

The system is somewhat flexible and will look for columns based on recognized aliases. Your columns must use one of the names from the corresponding lists below (case-insensitive and ignores special characters):

*   **Time**: `Time`, `Jam`
*   **Term/Program**: `Term-Branch`, `Term Modul`, `Term Module`, `Term`, `Module`, `Modul`
*   **Main Instructor**: `Main Inst/PIC`, `Main Instructor`, `Main Inst`, `Instructor`, `PIC`, `Pengajar`, `Teacher`
*   **Student Name**: `Student Name`, `Student`, `Nama Murid`, `Murid`, `Nama Siswa`
*   **Lesson Arrangement**: `Lesson Arrange Date`, `Lesson Arrange`, `Lesson Arrangement`, `Arrange`, `Lesson Detail`
*   **Program (Full Name)**: `Program`, `Programme`
*   **Remarks/Notes**: `Remarks`, `Remark`, `Notes`, `Catatan`, `Keterangan`

## 3. Data Entry & Inheritance Rules

To make data entry easier, the system uses "inheritance". 
*   **Empty Cells**: If a cell in the **Time**, **Term**, or **Main Instructor** column is left empty, the system will automatically inherit the value from the row directly above it. 
*   **Grouped Classes**: You only need to write the Time, Term, and Main Instructor once for the first student in a class. For the subsequent students in the same class, you can leave those columns blank.
*   **Empty Rows**: Rows where Student Name, Time, and Term are *all* empty are ignored.

## 4. Lesson Arrangement Column (Overrides & Details)

The **Lesson Arrangement** column is parsed smartly to handle substitute instructors, lesson codes, and leave statuses.

*   **Substitute / Override Instructor**:
    *   **Comma Format**: If a student has a different instructor than the main one, use a comma. The text *after* the last comma becomes the new instructor. Example: `K1.10, Vivi` (Vivi is the instructor, K1.10 is the lesson).
    *   **Direct Name**: If you just type a name (e.g., `Christian`) and it doesn't contain numbers or date words, it will override the main instructor.
*   **Lesson Details**:
    *   Codes like `KF1.5`, `J2.10`, or `Coder` are recognized automatically. The system will record this as the lesson detail and *keep the Main Instructor*.
*   **Dates and Notes**:
    *   If you write a date or note (e.g., `29 May`, `izin 29 May`, `reschedule`), the system recognizes it's not an instructor name (because it contains numbers or keywords like "izin", "Jan", "May"). The Main Instructor is kept.
*   **Student on Leave (Not Arranged)**:
    *   If a student is on leave or not scheduled for that week, put a single dash (`-`) in the Lesson Arrangement column. The row will be kept in the system to show their status, but they will be marked as "Not Arranged".

## 5. Publishing

For the sync to work, the Google Sheet must be published to the web.
1.  In Google Sheets, go to **File > Share > Publish to web**.
2.  Select "Entire Document" or the specific day tabs.
3.  Click "Publish" and copy the generated link.
4.  Paste this link into the Pulse Admin Settings when creating or editing a branch.
