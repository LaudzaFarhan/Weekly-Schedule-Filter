'use client';

import React, { useState, useRef } from 'react';
import { X, Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function ImportInstructorsModal({
  branches = [],
  onClose,
  onImportComplete,
}) {
  const [file, setFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

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
        
        // Convert to array of objects
        const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!rawJson || rawJson.length === 0) {
          setParseError('The uploaded file appears to be empty.');
          return;
        }

        // Find keys case-insensitively
        const sampleRow = rawJson[0];
        const keys = Object.keys(sampleRow);
        
        const nameKey = keys.find(k => /NAME/i.test(k));
        const branchKey = keys.find(k => /BRANCH/i.test(k));
        const phoneKey = keys.find(k => /WHATSAPP|PHONE|NUMBER|CONTACT/i.test(k));
        const emailKey = keys.find(k => /EMAIL/i.test(k));
        const remarksKey = keys.find(k => /REMARKS?|NOTES?|CATATAN|KETERANGAN/i.test(k));

        if (!nameKey) {
          setParseError('Column header "Name" is required.');
          return;
        }

        const extracted = [];
        rawJson.forEach((row, i) => {
          const name = String(row[nameKey] || '').trim();
          if (!name) return;

          const rawBranch = String(row[branchKey] || '').trim();
          // Branches can be comma separated, e.g. "Bekasi, Bintaro"
          const branchesArray = rawBranch
            ? rawBranch.split(/[,;|]/).map(b => b.trim()).filter(Boolean)
            : ['Bekasi'];

          const contact = phoneKey ? String(row[phoneKey] || '').trim() : 'N/A';
          const email = emailKey ? String(row[emailKey] || '').trim() : '';
          const rawRemarks = remarksKey ? String(row[remarksKey] || '').trim() : '';

          const remarksParts = [];
          if (email) remarksParts.push(`Email: ${email}`);
          if (rawRemarks) remarksParts.push(rawRemarks);
          const remarks = remarksParts.join(' | ');

          extracted.push({
            name,
            level: 'Kinder and Junior', // default teaching level
            branches: branchesArray,
            contact: contact || 'N/A',
            status: 'Active',
            remarks: remarks || '',
            // for preview display
            email,
            rawRemarks,
            branchString: branchesArray.join(', '),
          });
        });

        if (extracted.length === 0) {
          setParseError('No valid rows found in the sheet.');
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
    const csvContent = "Name,Branch,Whatsapp Number,Email\n" +
      "Supandi,Bekasi,+628123456789,supandi@thelab.com\n" +
      "Ziyah,\"Bekasi, Bintaro\",+628223456789,ziyah@thelab.com\n" +
      "Anya,Bintaro,+628323456789,anya@thelab.com\n";
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "Instructor_Import_Template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmit = async () => {
    if (parsedRows.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onImportComplete(parsedRows);
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

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
          maxWidth: '680px',
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
              Bulk Import Instructors
            </h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Upload a CSV file containing columns: Name, Branch, Whatsapp Number, Email.
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
          
          {/* Action button bar */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
              <Download size={15} /> Download CSV Template
            </button>
          </div>

          {/* File Drop area */}
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
              accept=".csv, .xlsx, .xls"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <Upload size={32} style={{ color: file ? 'var(--primary-blue, #4f46e5)' : 'var(--text-muted)', marginBottom: '0.5rem' }} />
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
              {file ? file.name : 'Click to select or drop your CSV / Excel file'}
            </div>
          </div>

          {parseError && (
            <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={16} /> {parseError}
            </div>
          )}

          {/* Preview list */}
          {parsedRows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={16} /> Found {parsedRows.length} instructors ready to import
              </span>

              <div style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden', maxHeight: '200px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                  <thead style={{ background: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)' }}>
                    <tr>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Name</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Branch</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Whatsapp Number</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.45rem 0.75rem', fontWeight: 600 }}>{r.name}</td>
                        <td style={{ padding: '0.45rem 0.75rem' }}>{r.branchString}</td>
                        <td style={{ padding: '0.45rem 0.75rem' }}>{r.contact}</td>
                        <td style={{ padding: '0.45rem 0.75rem' }}>{r.email || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
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
            {isSubmitting ? 'Importing...' : `Import ${parsedRows.length} Instructors`}
          </button>
        </div>
      </div>
    </div>
  );
}
