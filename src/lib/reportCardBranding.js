/**
 * Report_Branding_Constants — the printed identity of the Student Learning Journey Report.
 *
 * Req 5.2: the Report_Document reads the academy header text, the report title, the
 * Academic Director name and the default Lead Instructor name from here, and holds no
 * academy name and no person's name as text written into a component. Req 5.3: the
 * `Lead Instructor` signature line prints the instructor recorded on the evaluation and
 * falls back to `DEFAULT_LEAD_INSTRUCTOR_NAME` below.
 *
 * ── PLACEHOLDERS ──────────────────────────────────────────────────────────────────────
 * Every default value in this file was transcribed from the prototype screenshots. They
 * are mock values, not the academy's confirmed branding: 'STEM & CODING ACADEMY',
 * 'STUDENT LEARNING JOURNEY REPORT', 'Ms. Sarah Jenkins' and 'Dr. Robert Vance' have
 * NOT been verified with the academy. The academy must confirm the header text, the
 * report title and both signatory names before any report is issued to a parent.
 *
 * This module is the one place to change them. Editing the four defaults below (or
 * setting the matching environment variables) changes every printed report; no other
 * file needs to be touched, and no component may hard-code a name of its own.
 * ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Environment overrides. Each value may be overridden per deployment so a second branch
 * or a rebrand needs no code change. The variables are `NEXT_PUBLIC_`-prefixed because
 * the Report_Document is a client component and Next only inlines that prefix into the
 * browser bundle. An unset or blank variable falls back to the literal default, so the
 * report can never print a blank header or an empty signature name:
 *
 *   NEXT_PUBLIC_REPORT_ACADEMY_HEADER      → ACADEMY_HEADER_TEXT
 *   NEXT_PUBLIC_REPORT_TITLE               → REPORT_TITLE
 *   NEXT_PUBLIC_REPORT_ACADEMIC_DIRECTOR   → ACADEMIC_DIRECTOR_NAME
 *   NEXT_PUBLIC_REPORT_LEAD_INSTRUCTOR     → DEFAULT_LEAD_INSTRUCTOR_NAME
 *
 * Pure module: no imports, so the Report_Document, the page and any test can read it.
 */

/** The literal defaults, kept separately so the fallback is always a non-empty string. */
const DEFAULTS = {
  academyHeaderText: 'STEM & CODING ACADEMY',
  reportTitle: 'STUDENT LEARNING JOURNEY REPORT',
  academicDirectorName: 'Dr. Robert Vance',
  defaultLeadInstructorName: 'Ms. Sarah Jenkins',
};

/**
 * An override wins only when it carries text; anything else keeps the literal default.
 *
 * @param {string|undefined|null} override value read from the environment
 * @param {string} fallback the literal default for that value
 * @returns {string} a non-empty, trimmed string
 */
function configured(override, fallback) {
  return typeof override === 'string' && override.trim() !== '' ? override.trim() : fallback;
}

/** Printed academy header, first line of the Report_Document. */
export const ACADEMY_HEADER_TEXT = configured(
  process.env.NEXT_PUBLIC_REPORT_ACADEMY_HEADER,
  DEFAULTS.academyHeaderText,
);

/** Printed report title, beneath the academy header. */
export const REPORT_TITLE = configured(
  process.env.NEXT_PUBLIC_REPORT_TITLE,
  DEFAULTS.reportTitle,
);

/** Name printed beneath the `Academic Director` signature line. */
export const ACADEMIC_DIRECTOR_NAME = configured(
  process.env.NEXT_PUBLIC_REPORT_ACADEMIC_DIRECTOR,
  DEFAULTS.academicDirectorName,
);

/**
 * Name printed beneath the `Lead Instructor` signature line when the evaluation
 * supplying the Instructor Remarks holds no instructor name (Req 5.3).
 */
export const DEFAULT_LEAD_INSTRUCTOR_NAME = configured(
  process.env.NEXT_PUBLIC_REPORT_LEAD_INSTRUCTOR,
  DEFAULTS.defaultLeadInstructorName,
);

/**
 * The four values as one frozen object, for the Report_Document's `signatories` prop
 * and for anything that would rather pass branding around than import four constants.
 *
 * @type {Readonly<{ academyHeaderText: string, reportTitle: string,
 *                   academicDirectorName: string, defaultLeadInstructorName: string }>}
 */
export const REPORT_BRANDING = Object.freeze({
  academyHeaderText: ACADEMY_HEADER_TEXT,
  reportTitle: REPORT_TITLE,
  academicDirectorName: ACADEMIC_DIRECTOR_NAME,
  defaultLeadInstructorName: DEFAULT_LEAD_INSTRUCTOR_NAME,
});
