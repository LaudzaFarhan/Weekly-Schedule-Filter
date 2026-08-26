'use client';

import React, { useState, useRef, useMemo } from 'react';
import { X, Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';

import { formatNormalizedTimeSlot } from '../../utils/timeUtils';
import { DEFAULT_BRANCH_LIST, getCanonicalBranchName } from '../../utils/constants';
import { isInstructorMatch, isSameTeacher, getInstructorDisplayName } from '../../utils/instructorUtils';

/**
 * Normalise level/program to standard options if possible
 */
function normaliseProgramLevel(rawProgram, rawTerm) {
  if (!rawProgram) return 'Kinder Core';
  const str = String(rawProgram).trim();
  const lower = str.toLowerCase();
  
  if (lower.includes('kinder')) {
    if (lower.includes('foundation')) return 'Kinder Core';
    return 'Kinder Core';
  }
  if (lower.includes('junior')) return 'Junior Core';
  if (lower.includes('coder')) return 'Coder Advance';
  
  return str;
}

const DAY_MATCH_REGEX = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)\b/i;
const TIME_MATCH_REGEX = /(\d{1,3}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)?\s*[-–—]\s*\d{1,2}\s*(?:am|pm)?)/i;

/** Validate imported instructor alias against registered instructors */
function validateInstructorAlias(rawInstructor, knownInstructors = []) {
  if (!rawInstructor || String(rawInstructor).trim() === '' || String(rawInstructor).trim() === '-') {
    return { isValid: false, matchedName: null, instructorObj: null };
  }
  const trimmed = String(rawInstructor).trim();
  if (trimmed.toUpperCase() === 'TBD') {
    return { isValid: false, matchedName: 'TBD', instructorObj: null };
  }

  if (!knownInstructors || knownInstructors.length === 0) {
    return { isValid: false, matchedName: null, instructorObj: null };
  }

  for (const inst of knownInstructors) {
    if (!inst) continue;
    const instName = typeof inst === 'string' ? inst : (inst.name || inst.fullname || getInstructorDisplayName(inst));
    if (isInstructorMatch(trimmed, inst) || isSameTeacher(trimmed, instName)) {
      return { isValid: true, matchedName: getInstructorDisplayName(inst) || instName, instructorObj: inst };
    }
  }

  return { isValid: false, matchedName: null, instructorObj: null };
}

export default function ImportStudentsModal({
  branches = [],
  defaultBranch = 'Bekasi',
  instructorsList = [],
  onClose,
  onImportComplete,
}) {
  const [file, setFile] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(defaultBranch || (branches[0]?.name || 'Bekasi'));
  const [parsedRows, setParsedRows] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const unmatchedInstructors = useMemo(() => {
    return parsedRows.filter((r) => r.originalInstructor && !r.isInstructorValid);
  }, [parsedRows]);

  const handleFileChange = (e) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    setFile(uploadedFile);
    parseSpreadsheet(uploadedFile);
  };

  const parseSpreadsheet = (fileObj) => {
    setParseError(null);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert sheet to array of arrays (matrix)
        const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!matrix || matrix.length === 0) {
          setParseError('The uploaded file appears to be empty.');
          return;
        }

        // Find header row: look for row containing 'NAME' or 'STUDENT' or 'PROGRAM'
        let headerRowIndex = -1;
        for (let r = 0; r < Math.min(matrix.length, 10); r++) {
          const rowValues = (matrix[r] || []).map((cell) => String(cell || '').trim().toUpperCase());
          if (rowValues.includes('NAME') || rowValues.includes('STUDENT NAME') || rowValues.includes('PROGRAM')) {
            headerRowIndex = r;
            break;
          }
        }

        if (headerRowIndex === -1) {
          headerRowIndex = 0; // Fallback to first row
        }

        const headers = (matrix[headerRowIndex] || []).map((h) => String(h || '').trim());
        
        // Map header indices with expanded regexes for multi-language support
        const nameIdx = headers.findIndex((h) => /NAME|STUDENT/i.test(h));
        const progIdx = headers.findIndex((h) => /PROGRAM|LEVEL/i.test(h));
        const termIdx = headers.findIndex((h) => /TERM/i.test(h));
        const daysIdx = headers.findIndex((h) => /DAYS?|DAY|HARI/i.test(h));
        const timeIdx = headers.findIndex((h) => /TIME|JAM|WAKTU|SLOT|JADWAL/i.test(h));
        const instructorIdx = headers.findIndex((h) => /INSTRUCTOR|TEACHER|GURU|PENGAJAR/i.test(h));
        const branchIdx = headers.findIndex((h) => /BRANCH|CABANG|LOKASI|LOCATION/i.test(h));
        const parentIdx = headers.findIndex((h) => /PARENT|ORANG\s*TUA/i.test(h));
        const contactIdx = headers.findIndex((h) => /CONTACT|PHONE|TELP|WA/i.test(h));
        const remarksIdx = headers.findIndex((h) => /REMARKS?|NOTES?|CATATAN|KETERANGAN|INFO/i.test(h));

        const extracted = [];
        for (let r = headerRowIndex + 1; r < matrix.length; r++) {
          const row = matrix[r];
          if (!row || row.length === 0) continue;

          const rawName = nameIdx !== -1 ? row[nameIdx] : null;
          if (!rawName || String(rawName).trim() === '') continue;

          const name = String(rawName).trim();
          const rawProgram = progIdx !== -1 ? String(row[progIdx] || '').trim() : '';
          const rawTerm = termIdx !== -1 ? String(row[termIdx] || '').trim() : '';
          let rawDays = daysIdx !== -1 ? String(row[daysIdx] || '').trim() : '';
          let rawTime = timeIdx !== -1 ? String(row[timeIdx] || '').trim() : '';
          let rawInstructor = instructorIdx !== -1 ? String(row[instructorIdx] || '').trim() : '';
          const rawBranch = branchIdx !== -1 ? String(row[branchIdx] || '').trim() : '';
          const rawParent = parentIdx !== -1 ? String(row[parentIdx] || '').trim() : '';
          const rawContact = contactIdx !== -1 ? String(row[contactIdx] || '').trim() : '';
          const rawRemarks = remarksIdx !== -1 ? String(row[remarksIdx] || '').trim() : '';

          // Smart extraction: if rawTime contains a Day name (e.g. "Monday 1.00-2.30pm")
          if (!rawDays && rawTime) {
            const dayM = rawTime.match(DAY_MATCH_REGEX);
            if (dayM) {
              rawDays = dayM[1];
              rawTime = rawTime.replace(dayM[0], '').trim();
            }
          }
          if (!rawDays && rawRemarks) {
            const dayM = rawRemarks.match(DAY_MATCH_REGEX);
            if (dayM) rawDays = dayM[1];
          }
          if (!rawTime && rawRemarks) {
            const timeM = rawRemarks.match(TIME_MATCH_REGEX);
            if (timeM) rawTime = timeM[1];
          }
          if (!rawInstructor && rawRemarks) {
            const instM = rawRemarks.match(/(?:Instructor|Teacher|Pengajar|Guru):\s*([^|\n]+)/i);
            if (instM) rawInstructor = instM[1].trim();
          }

          // Format time using standard normalizer (handles 010.00-11.30am, 1.00-2.30pm, etc.)
          if (rawTime) {
            rawTime = formatNormalizedTimeSlot(rawTime);
          }

          const level = normaliseProgramLevel(rawProgram, rawTerm);

          // If explicit REMARKS column is present in CSV, use it directly; otherwise fallback to auto-generated program/schedule details
          const fallbackParts = [];
          if (rawProgram) fallbackParts.push(`Program: ${rawProgram}`);
          if (rawTerm) fallbackParts.push(`Term: ${rawTerm}`);
          if (rawDays || rawTime) fallbackParts.push(`Schedule: ${rawDays} ${rawTime}`.trim());
          if (rawInstructor) fallbackParts.push(`Instructor: ${rawInstructor}`);
          
          const remarks = rawRemarks ? rawRemarks : (fallbackParts.join(' | ') || null);

          const valResult = validateInstructorAlias(rawInstructor, instructorsList);
          const matchedBranch = valResult.instructorObj?.branches?.[0] || valResult.instructorObj?.location;
          const canonicalBranch = rawBranch ? getCanonicalBranchName(rawBranch) : '';
          const finalBranch = canonicalBranch || matchedBranch || selectedBranch;

          extracted.push({
            name,
            level,
            branchName: finalBranch,
            parentName: rawParent || null,
            contact: rawContact || '',
            status: 'Active',
            remarks: remarks,
            // Extra info for schedule auto-creation
            rawProgram,
            rawTerm,
            rawDays,
            rawTime,
            rawInstructor: valResult.isValid ? (valResult.matchedName || rawInstructor) : rawInstructor,
            originalInstructor: rawInstructor,
            rawBranch,
            rawRemarks,
            isInstructorValid: valResult.isValid,
            matchedInstructor: valResult.matchedName,
          });
        }

        if (extracted.length === 0) {
          setParseError('No valid student rows found in the sheet. Please ensure the column header "NAME" exists.');
          setParsedRows([]);
        } else {
          setParsedRows(extracted);
        }
      } catch (err) {
        console.error('Spreadsheet parse error:', err);
        setParseError('Failed to parse spreadsheet: ' + (err?.message || 'Unknown format'));
      }
    };

    reader.readAsBinaryString(fileObj);
  };

  const handleDownloadTemplate = () => {
    const sampleData = [
      { NO: 1, BRANCH: 'Puri Indah', PROGRAM: 'Kinder Foundation', NAME: 'Liam Theodore', TERM: 'KF2', DAYS: 'Monday', TIME: '1.00-2.30pm', INSTRUCTOR: 'Supandi' },
      { NO: 2, BRANCH: 'Kelapa Gading', PROGRAM: 'Kinder Foundation', NAME: 'Marvel Benedict Josojuwono', TERM: 'KF2', DAYS: 'Monday', TIME: '1.00-2.30pm', INSTRUCTOR: 'Supandi' },
      { NO: 3, BRANCH: 'Pluit Village', PROGRAM: 'Kinder Core', NAME: 'Keenan Fidem Laksmana', TERM: 'K1', DAYS: 'Monday', TIME: '3.00-4.30pm', INSTRUCTOR: 'Ziyah' },
      { NO: 4, BRANCH: 'Gading Serpong', PROGRAM: 'Junior Core', NAME: 'Arya Arkananta', TERM: 'J1', DAYS: 'Tuesday', TIME: '3.00-5.00pm', INSTRUCTOR: 'Ziyah' },
      { NO: 5, BRANCH: 'Pondok Indah', PROGRAM: 'Junior Core', NAME: 'Edmund Glorious Widjaja', TERM: 'J2', DAYS: 'Wednesday', TIME: '3.00-5.00pm', INSTRUCTOR: 'Ziyah' },
      { NO: 6, BRANCH: 'Bekasi', PROGRAM: 'Kinder Core', NAME: 'Tiffany Callysta Lo', TERM: 'K1', DAYS: 'Thursday', TIME: '3.00-4.30pm', INSTRUCTOR: 'Supandi' },
      { NO: 7, BRANCH: 'Bintaro', PROGRAM: 'Coder', NAME: 'Georgius Marvel Suryadi', TERM: 'Coder Advance', DAYS: 'Saturday', TIME: '1.00-3.00pm', INSTRUCTOR: 'Ziyah' },
      { NO: 8, BRANCH: 'Puri Indah', PROGRAM: 'Junior Foundation', NAME: 'Adriel Djayaputra Kalim', TERM: 'JF1', DAYS: 'Saturday', TIME: '10.00-12.00am', INSTRUCTOR: 'Anya' },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, 'Student_Import_Template.xlsx');
  };

  const handleSubmit = async () => {
    if (parsedRows.length === 0 || isSubmitting) return;

    // Apply selected branch fallback if needed
    const finalData = parsedRows.map((r) => ({
      ...r,
      branchName: r.branchName || selectedBranch,
    }));

    setIsSubmitting(true);
    try {
      await onImportComplete(finalData);
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const branchList = (Array.isArray(branches) && branches.length > 0)
    ? branches.map((b) => b.name || b).filter((b) => b && b !== 'Default Branch')
    : DEFAULT_BRANCH_LIST.map((b) => b.name);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: 'var(--panel-bg)',
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          borderRadius: '16px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
          animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-color)',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileSpreadsheet size={20} style={{ color: 'var(--primary-blue, #4f46e5)' }} />
              Bulk Import Students
            </h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Upload an Excel (.xlsx, .xls) or CSV file with NO, BRANCH, PROGRAM, NAME, TERM, DAYS, TIME, INSTRUCTOR.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          
          {/* Default Branch Selection */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}>
              <label className="modal-form-label" style={{ marginBottom: '0.3rem' }}>Default / Fallback Branch</label>
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="modal-select-field"
                disabled={isSubmitting}
              >
                {branchList.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Used if a row lacks a BRANCH column. If your sheet has a BRANCH column, all students across all branches are imported at once.
              </span>
            </div>

            {/* Template Download */}
            <div style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="btn"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '0.5rem 1rem',
                  fontSize: '0.82rem',
                }}
              >
                <Download size={15} /> Download Sample Format (.xlsx)
              </button>
            </div>
          </div>

          {/* File Upload Box */}
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: '2px dashed var(--border-color)',
              borderRadius: '12px',
              padding: '2rem 1.5rem',
              textAlign: 'center',
              cursor: 'pointer',
              background: file ? 'rgba(79, 70, 229, 0.04)' : 'var(--bg-color)',
              borderColor: file ? 'var(--primary-blue, #4f46e5)' : 'var(--border-color)',
              transition: 'all 0.2s ease',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <Upload size={32} style={{ color: file ? 'var(--primary-blue, #4f46e5)' : 'var(--text-muted)', marginBottom: '0.5rem' }} />
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
              {file ? file.name : 'Click to select or drop your spreadsheet file'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Supports .xlsx, .xls, and .csv files with BRANCH column
            </div>
          </div>

          {parseError && (
            <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={16} /> {parseError}
            </div>
          )}

          {/* Unmatched Instructor Alias Warning Notification */}
          {unmatchedInstructors.length > 0 && (
            <div style={{
              padding: '0.85rem 1.1rem',
              borderRadius: '10px',
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1.5px solid rgba(245, 158, 11, 0.35)',
              color: '#b45309',
              fontSize: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
            }}>
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#92400e' }}>
                <AlertTriangle size={18} style={{ color: '#d97706', flexShrink: 0 }} />
                <span>Instructor Alias Mismatch Detected ({unmatchedInstructors.length} row{unmatchedInstructors.length > 1 ? 's' : ''})</span>
              </div>
              <div style={{ lineHeight: 1.4, color: '#92400e' }}>
                The following instructor alias{Array.from(new Set(unmatchedInstructors.map(u => u.originalInstructor))).length > 1 ? 'es' : ''} in your import file do not match any registered instructor alias:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {Array.from(new Set(unmatchedInstructors.map(u => u.originalInstructor))).map((alias, idx) => (
                  <span key={idx} style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    background: 'rgba(217, 119, 6, 0.18)',
                    color: '#92400e',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(217, 119, 6, 0.3)',
                  }}>
                    "{alias}"
                  </span>
                ))}
              </div>
              <div style={{ fontSize: '0.73rem', color: '#b45309', opacity: 0.9, marginTop: '0.1rem' }}>
                Rows with unmatched instructors are highlighted in orange in the preview below. Please check instructor alias spellings before importing.
              </div>
            </div>
          )}

          {/* Preview Table */}
          {parsedRows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <CheckCircle2 size={16} /> Found {parsedRows.length} student records across {new Set(parsedRows.map(r => r.branchName).filter(Boolean)).size} branch{new Set(parsedRows.map(r => r.branchName).filter(Boolean)).size === 1 ? '' : 'es'} ready to import
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Showing first 8 preview rows</span>
              </div>

              <div style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden', maxHeight: '220px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                  <thead style={{ background: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)', sticky: 'top' }}>
                    <tr>
                      <th style={{ padding: '0.5rem 0.75rem' }}>#</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Student Name</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Branch</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Program</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Term</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Schedule</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Instructor</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 8).map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.45rem 0.75rem', color: 'var(--text-muted)' }}>{i + 1}</td>
                        <td style={{ padding: '0.45rem 0.75rem', fontWeight: 600 }}>{r.name}</td>
                        <td style={{ padding: '0.45rem 0.75rem' }}>
                          <span style={{
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            padding: '0.15rem 0.45rem',
                            borderRadius: '6px',
                            background: 'rgba(79, 70, 229, 0.08)',
                            color: 'var(--primary-blue, #4f46e5)',
                            border: '1px solid rgba(79, 70, 229, 0.2)',
                            whiteSpace: 'nowrap'
                          }}>
                            {r.branchName || selectedBranch}
                          </span>
                        </td>
                        <td style={{ padding: '0.45rem 0.75rem' }}>{r.rawProgram || r.level}</td>
                        <td style={{ padding: '0.45rem 0.75rem' }}>{r.rawTerm || '—'}</td>
                        <td style={{ padding: '0.45rem 0.75rem' }}>{r.rawDays} {r.rawTime}</td>
                        <td style={{
                          padding: '0.45rem 0.75rem',
                          color: r.isInstructorValid ? 'var(--text-main)' : '#b45309',
                          fontWeight: r.isInstructorValid ? 400 : 700,
                          background: r.isInstructorValid ? 'transparent' : 'rgba(245, 158, 11, 0.14)',
                        }}>
                          {r.originalInstructor ? (
                            r.isInstructorValid ? (
                              r.originalInstructor
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#b45309' }}>
                                <AlertTriangle size={13} /> {r.originalInstructor} (Unmatched)
                              </span>
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '0.45rem 0.75rem', color: 'var(--text-secondary)' }}>{r.rawRemarks || r.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Actions Footer */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          background: 'var(--bg-color)',
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="btn"
            style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={parsedRows.length === 0 || isSubmitting}
            className="btn btn-primary"
            style={{
              borderRadius: '10px',
              padding: '0.5rem 1.5rem',
              fontSize: '0.85rem',
              opacity: parsedRows.length === 0 || isSubmitting ? 0.6 : 1,
              cursor: parsedRows.length === 0 || isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Importing...' : `Import ${parsedRows.length} Students`}
          </button>
        </div>
      </div>
    </div>
  );
}
