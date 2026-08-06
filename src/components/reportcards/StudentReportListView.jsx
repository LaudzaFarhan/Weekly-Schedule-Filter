'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Award, CalendarDays, ClipboardList, Eye, MapPin, RefreshCw, Search, User } from 'lucide-react';

import { useSchedule } from '../../contexts/ScheduleContext';
import { competencyAverages, overallGrade } from '../../lib/reportCard';
import { COMPETENCIES } from '../../lib/reportCardRubric';
import {
  PROGRAM_CATEGORIES,
  UNFILTERED,
  filterStudents,
  matchesStudentFilter,
  partitionByProgramCategory,
  studentProgramCategory,
} from '../../lib/studentFilter';
import { getEvaluations } from '../../services/studentEvaluationService';

const CATEGORY_BADGES = {
  Kinder: { letter: 'K', color: '#db2777', bg: '#fce7f3' },
  Junior: { letter: 'J', color: '#2563eb', bg: '#dbeafe' },
  Coder: { letter: 'C', color: '#1e293b', bg: '#f1f5f9' },
};

export default function StudentReportListView({
  students = [],
  onSelectStudentAndEvaluate,
  onSelectStudentAndPreview,
}) {
  const { enabledBranches, branches } = useSchedule();

  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState(UNFILTERED);
  const [filterStatus, setFilterStatus] = useState(UNFILTERED);
  const [resultFilter, setResultFilter] = useState('all'); // 'all' | 'assessed' | 'unassessed'

  const [allEvaluations, setAllEvaluations] = useState([]);
  const [loadingEvals, setLoadingEvals] = useState(true);
  const [errorEvals, setErrorEvals] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Fetch all evaluations on mount to aggregate report results across all students
  useEffect(() => {
    let cancelled = false;
    setLoadingEvals(true);
    getEvaluations({})
      .then((data) => {
        if (cancelled) return;
        setAllEvaluations(Array.isArray(data) ? data : []);
        setLoadingEvals(false);
        setErrorEvals(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to fetch evaluations for report list:', err);
        setErrorEvals(err?.message || 'Failed to load evaluation results');
        setLoadingEvals(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Group evaluations by student ID
  const evalsByStudent = useMemo(() => {
    const map = new Map();
    for (const ev of allEvaluations) {
      const sId = ev.studentId ?? ev.student_id;
      if (sId != null) {
        const key = String(sId);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(ev);
      }
    }
    return map;
  }, [allEvaluations]);

  // Branch dropdown options
  const branchList = useMemo(
    () =>
      [
        ...new Set([
          ...(enabledBranches || []).map((b) => b.name),
          ...(branches || []).map((b) => b.name),
        ]),
      ].filter(Boolean),
    [enabledBranches, branches]
  );

  // Category partitions for counts
  const categoryCounts = useMemo(() => {
    const partitioned = partitionByProgramCategory(students);
    return {
      All: students.length,
      Kinder: partitioned.Kinder?.length || 0,
      Junior: partitioned.Junior?.length || 0,
      Coder: partitioned.Coder?.length || 0,
    };
  }, [students]);

  // Filtered student list with report results
  const filteredStudentsWithResults = useMemo(() => {
    return students
      .filter((st) => {
        // 1. Program Category Filter
        if (category !== 'All' && studentProgramCategory(st) !== category) {
          return false;
        }
        // 2. Standard criteria: search, branch, status
        if (!matchesStudentFilter(st, { search, branch: filterBranch, status: filterStatus })) {
          return false;
        }
        // 3. Report Result filter: assessed vs unassessed
        const evs = evalsByStudent.get(String(st.id)) || [];
        if (resultFilter === 'assessed' && evs.length === 0) return false;
        if (resultFilter === 'unassessed' && evs.length > 0) return false;

        return true;
      })
      .map((st) => {
        const evs = evalsByStudent.get(String(st.id)) || [];
        const averages = competencyAverages(evs);
        const grade = overallGrade(averages);
        return {
          student: st,
          evaluations: evs,
          averages,
          grade,
          evalCount: evs.length,
        };
      });
  }, [students, category, search, filterBranch, filterStatus, resultFilter, evalsByStudent]);

  return (
    <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Filter Controls Bar */}
      <div className="panel" style={{ margin: 0 }}>
        <div
          className="panel-body"
          style={{
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {/* Top row: Program Category Pills */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
              {['All', ...PROGRAM_CATEGORIES].map((cat) => {
                const active = category === cat;
                const badge = CATEGORY_BADGES[cat];
                const count = categoryCounts[cat] || 0;

                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.4rem 0.85rem',
                      borderRadius: '10px',
                      fontSize: '0.82rem',
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                      border: active ? '1.5px solid var(--primary-blue, #4f46e5)' : '1px solid var(--border-color)',
                      background: active ? 'var(--primary-blue-light, rgba(79,70,229,0.1))' : 'var(--bg-color)',
                      color: active ? 'var(--primary-blue, #4f46e5)' : 'var(--text-main)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {badge && (
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: '0.72rem',
                          color: badge.color,
                          background: badge.bg,
                          padding: '0.05rem 0.35rem',
                          borderRadius: '4px',
                        }}
                      >
                        {badge.letter}
                      </span>
                    )}
                    <span>{cat}</span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '0.1rem 0.4rem',
                        borderRadius: '99px',
                        background: active ? 'var(--primary-blue)' : 'var(--bg-muted, #f1f5f9)',
                        color: active ? '#ffffff' : 'var(--text-muted)',
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Showing <strong>{filteredStudentsWithResults.length}</strong> of {students.length} students
            </div>
          </div>

          {/* Bottom row: Search & Select Dropdowns */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem',
              alignItems: 'center',
            }}
          >
            {/* Search Input */}
            <div style={{ position: 'relative' }}>
              <Search
                size={15}
                style={{
                  position: 'absolute',
                  left: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="text"
                placeholder="Search student, parent, contact..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.45rem 0.75rem 0.45rem 2.2rem',
                  fontSize: '0.8rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-main)',
                }}
              />
            </div>

            {/* Branch Filter */}
            <div>
              <select
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.8rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-main)',
                }}
              >
                <option value={UNFILTERED}>All Branches</option>
                {branchList.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.8rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-main)',
                }}
              >
                <option value={UNFILTERED}>All Statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            {/* Result Filter */}
            <div>
              <select
                value={resultFilter}
                onChange={(e) => setResultFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.8rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-main)',
                }}
              >
                <option value="all">All Report States</option>
                <option value="assessed">Evaluated Only</option>
                <option value="unassessed">Not Yet Assessed</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Error state alert */}
      {errorEvals && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            background: 'var(--danger-bg, #fef2f2)',
            border: '1px solid var(--danger-border, #fecaca)',
            color: 'var(--danger, #dc2626)',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{errorEvals}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setReloadToken((t) => t + 1)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Main Student Report Cards List */}
      {loadingEvals && filteredStudentsWithResults.length === 0 ? (
        <div className="panel" style={{ margin: 0, padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCw size={24} className="spin" style={{ marginBottom: '0.5rem' }} />
          <p style={{ margin: 0, fontSize: '0.85rem' }}>Loading student report results…</p>
        </div>
      ) : filteredStudentsWithResults.length === 0 ? (
        <div className="panel" style={{ margin: 0, padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <User size={32} style={{ opacity: 0.4, marginBottom: '0.5rem' }} />
          <h4 style={{ margin: '0 0 0.2rem', fontSize: '0.95rem', color: 'var(--text-main)' }}>No students found</h4>
          <p style={{ margin: 0, fontSize: '0.8rem' }}>No student records match your active search and filter criteria.</p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '1rem',
          }}
        >
          {filteredStudentsWithResults.map(({ student, grade, evalCount, averages }) => {
            const hasReport = evalCount > 0;
            const categoryName = studentProgramCategory(student);
            const badge = CATEGORY_BADGES[categoryName];

            // Grade styling
            const isExcellent = grade.label === 'EXCELLENT';
            const isVeryGood = grade.label === 'VERY GOOD';
            const isGood = grade.label === 'GOOD';

            const gradeColor = !hasReport
              ? 'var(--text-muted)'
              : isExcellent
              ? '#059669'
              : isVeryGood
              ? '#2563eb'
              : isGood
              ? '#d97706'
              : '#dc2626';

            const gradeBg = !hasReport
              ? 'var(--bg-muted, #f1f5f9)'
              : isExcellent
              ? '#ecfdf5'
              : isVeryGood
              ? '#eff6ff'
              : isGood
              ? '#fffbeb'
              : '#fef2f2';

            const gradeBorder = !hasReport
              ? 'var(--border-color)'
              : isExcellent
              ? '#a7f3d0'
              : isVeryGood
              ? '#bfdbfe'
              : isGood
              ? '#fde68a'
              : '#fecaca';

            return (
              <div
                key={student.id}
                className="panel"
                style={{
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <div className="panel-body" style={{ padding: '1.1rem 1.25rem' }}>
                  {/* Student Header */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <div>
                      <h3
                        style={{
                          margin: 0,
                          fontSize: '1rem',
                          fontWeight: 700,
                          color: 'var(--text-main)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        {student.name || 'Unnamed Student'}
                      </h3>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          marginTop: '0.25rem',
                          fontSize: '0.75rem',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.2rem',
                          }}
                        >
                          <MapPin size={11} /> {student.branchName || 'No branch'}
                        </span>
                        <span>·</span>
                        <span>{student.level || student.program || 'No level'}</span>
                      </div>
                    </div>

                    {badge && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          color: badge.color,
                          background: badge.bg,
                          padding: '0.18rem 0.5rem',
                          borderRadius: '6px',
                        }}
                      >
                        {categoryName}
                      </span>
                    )}
                  </div>

                  {/* Report Result Summary Card */}
                  <div
                    style={{
                      padding: '0.75rem 0.9rem',
                      borderRadius: '8px',
                      background: gradeBg,
                      border: `1px solid ${gradeBorder}`,
                      marginBottom: '0.85rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Award size={16} style={{ color: gradeColor }} />
                        <span style={{ fontSize: '0.85rem', fontWeight: 800, color: gradeColor }}>
                          {hasReport && grade.score != null ? `${grade.score.toFixed(1)} / 5.0` : 'Not Assessed'}
                        </span>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            color: gradeColor,
                            textTransform: 'uppercase',
                            background: 'rgba(255,255,255,0.7)',
                            padding: '0.05rem 0.35rem',
                            borderRadius: '4px',
                          }}
                        >
                          {grade.label}
                        </span>
                      </div>

                      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        {evalCount} eval{evalCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    {/* Competency Averages mini badges */}
                    {hasReport && averages && (
                      <div
                        style={{
                          marginTop: '0.65rem',
                          paddingTop: '0.55rem',
                          borderTop: `1px dashed ${gradeBorder}`,
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.35rem',
                        }}
                      >
                        {(COMPETENCIES[categoryName] || COMPETENCIES['Kinder'] || []).map((c) => {
                          const val = averages[c.key];
                          return (
                            <span
                              key={c.key}
                              style={{
                                fontSize: '0.68rem',
                                padding: '0.12rem 0.4rem',
                                borderRadius: '4px',
                                background: '#ffffff',
                                border: '1px solid rgba(0,0,0,0.08)',
                                color: 'var(--text-main)',
                                display: 'inline-flex',
                                gap: '0.25rem',
                              }}
                            >
                              <span style={{ color: 'var(--text-muted)' }}>{c.label.split(' ')[0]}:</span>
                              <strong style={{ color: gradeColor }}>
                                {val != null ? val.toFixed(1) : '—'}
                              </strong>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Action Buttons */}
                <div
                  style={{
                    padding: '0.75rem 1.25rem',
                    background: 'var(--bg-muted, #f8fafc)',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    justify: 'flex-end',
                    gap: '0.5rem',
                    alignItems: 'center',
                    borderRadius: '0 0 12px 12px',
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onSelectStudentAndPreview(student.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      fontSize: '0.75rem',
                      borderRadius: '6px',
                      padding: '0.35rem 0.75rem',
                    }}
                  >
                    <Eye size={13} /> Preview PDF
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => onSelectStudentAndEvaluate(student.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      fontSize: '0.75rem',
                      borderRadius: '6px',
                      padding: '0.35rem 0.85rem',
                    }}
                  >
                    <ClipboardList size={13} /> Evaluate Report
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
