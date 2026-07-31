'use client';

/**
 * The Report_Cards_Page sidebar: three Program_Category tabs over a searchable,
 * filterable student list.
 *
 * Three things here are requirements rather than styling choices:
 *
 *   - Req 6.7 — the tabs come from `PROGRAM_CATEGORIES` and the students are
 *     bucketed by `partitionByProgramCategory`, the total resolver in
 *     `src/lib/studentFilter.js`. Every student lands in exactly one bucket, so
 *     nobody is unreachable from this panel. No level string is matched here.
 *   - Req 6.8 — the search, branch and status controls narrow the list through
 *     `filterStudents` from that same module, the predicate the Students_Page
 *     uses. There is deliberately no local predicate: a second one is how the
 *     two screens would start disagreeing.
 *   - Req 6.6 — a category holding no student renders a stated prompt, not an
 *     empty box. The wording distinguishes "this tab is empty" from "your
 *     filters excluded everyone", because the fix differs.
 *
 * The root carries `no-print`. The print stylesheet in `src/app/globals.css`
 * hides that class outright, and this panel is app chrome rather than part of the
 * printed report.
 *
 * Selection state lives on the page, not here: this component owns only the
 * three filter control values. The selected row is marked with `aria-current`
 * and carries a left border and a weight change, so the selection is never
 * signalled by colour alone.
 */

import React, { useMemo, useState } from 'react';
import { GraduationCap, MapPin, Search, Users } from 'lucide-react';

import { useSchedule } from '../../contexts/ScheduleContext';
import {
  PROGRAM_CATEGORIES,
  UNFILTERED,
  filterStudents,
  partitionByProgramCategory,
} from '../../lib/studentFilter';

/** Ids compare as text: `/api/new/students` ids arrive as numbers, params as strings. */
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

const LABEL_STYLE = {
  fontSize: '0.72rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '0.3rem',
  display: 'block',
};

/**
 * @param {Object} props
 * @param {Array<object>} props.students every student from the registry, unpartitioned
 * @param {'Kinder'|'Junior'|'Coder'} props.category the selected Program_Category
 * @param {(category: string) => void} props.onCategoryChange
 * @param {number|string|null} props.selectedStudentId
 * @param {(id: number|string) => void} props.onSelectStudent
 */
export default function StudentSelectorPanel({
  students,
  category,
  onCategoryChange,
  selectedStudentId,
  onSelectStudent,
}) {
  const { enabledBranches, branches } = useSchedule();

  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState(UNFILTERED);
  const [filterStatus, setFilterStatus] = useState(UNFILTERED);

  // Same branch list the Students_Page and the Schedule page build: the enabled
  // branches first, then any branch only present in the full list, de-duplicated.
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

  const buckets = useMemo(() => partitionByProgramCategory(students), [students]);

  // Filtered once per category, so each tab's badge counts what that tab would
  // actually list. Counting the unfiltered bucket instead would promise rows a
  // tab does not hold once a search is typed.
  const filteredByCategory = useMemo(() => {
    const criteria = { search, branch: filterBranch, status: filterStatus };
    const result = {};
    for (const name of PROGRAM_CATEGORIES) {
      result[name] = filterStudents(buckets[name], criteria);
    }
    return result;
  }, [buckets, search, filterBranch, filterStatus]);

  const activeCategory = PROGRAM_CATEGORIES.includes(category)
    ? category
    : PROGRAM_CATEGORIES[0];

  const categoryStudents = buckets[activeCategory] || [];
  const listed = filteredByCategory[activeCategory] || [];

  const filtersActive =
    search !== '' || filterBranch !== UNFILTERED || filterStatus !== UNFILTERED;

  const panelId = 'report-cards-student-list';

  return (
    <section
      className="panel no-print"
      aria-labelledby="report-cards-selector-heading"
      style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}
    >
      <div className="panel-header" style={{ display: 'block' }}>
        <h2
          id="report-cards-selector-heading"
          style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}
        >
          Students
        </h2>
        <p
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            margin: '0.2rem 0 0',
          }}
        >
          Pick a program, then a student to evaluate.
        </p>
      </div>

      {/* Program tabs. Real buttons, so Tab reaches them and Enter/Space activates. */}
      <div
        role="tablist"
        aria-label="Program category"
        style={{
          display: 'flex',
          gap: '0.35rem',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-color)',
        }}
      >
        {PROGRAM_CATEGORIES.map((name) => {
          const selected = name === activeCategory;
          const count = (filteredByCategory[name] || []).length;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              id={`report-cards-tab-${name}`}
              aria-selected={selected}
              aria-controls={panelId}
              onClick={() => onCategoryChange?.(name)}
              style={{
                flex: '1 1 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
                padding: '0.45rem 0.5rem',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: selected ? 700 : 500,
                background: selected ? 'var(--primary-blue)' : 'transparent',
                color: selected ? '#ffffff' : 'var(--text-secondary)',
                border: `1px solid ${selected ? 'var(--primary-blue)' : 'var(--border-color)'}`,
              }}
            >
              <GraduationCap size={13} aria-hidden="true" />
              {name}
              {/* The count is announced as part of the tab's own name. */}
              <span
                style={{
                  minWidth: '1.4rem',
                  padding: '0 0.35rem',
                  borderRadius: '999px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  background: selected ? 'rgba(255,255,255,0.25)' : 'var(--border-color)',
                  color: selected ? '#ffffff' : 'var(--text-secondary)',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters. Every value is handed to `filterStudents`, never compared here. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
          padding: '0.85rem 1rem',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div className="input-group" style={{ margin: 0 }}>
          <label htmlFor="report-cards-student-search" style={LABEL_STYLE}>
            Search
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={15}
              aria-hidden="true"
              style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }}
            />
            <input
              id="report-cards-student-search"
              type="text"
              placeholder="Search name, contact, parent name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '2rem', width: '100%' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <div className="input-group" style={{ margin: 0, flex: '1 1 0', minWidth: 0 }}>
            <label htmlFor="report-cards-student-branch" style={LABEL_STYLE}>
              Branch
            </label>
            <select
              id="report-cards-student-branch"
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value={UNFILTERED}>All Branches</option>
              {branchList.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, flex: '1 1 0', minWidth: 0 }}>
            <label htmlFor="report-cards-student-status" style={LABEL_STYLE}>
              Status
            </label>
            <select
              id="report-cards-student-status"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value={UNFILTERED}>All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      <div
        className="panel-body"
        id={panelId}
        role="tabpanel"
        aria-labelledby={`report-cards-tab-${activeCategory}`}
        style={{ padding: '0.6rem', overflowY: 'auto', flex: '1 1 auto' }}
      >
        {categoryStudents.length === 0 ? (
          // Req 6.6: the tab itself is empty, so there is nothing to select.
          <div
            style={{
              textAlign: 'center',
              padding: '2.5rem 1rem',
              color: 'var(--text-muted)',
            }}
          >
            <Users size={28} aria-hidden="true" style={{ marginBottom: '0.5rem' }} />
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
              {`No ${activeCategory} students yet`}
            </div>
            <div style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>
              Pick another program tab, or add a student on the Student Database page.
            </div>
          </div>
        ) : listed.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '2.5rem 1rem',
              color: 'var(--text-muted)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
              No students match your filter settings
            </div>
            <div style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>
              {`Clear the search or the filters to see all ${categoryStudents.length} ${activeCategory} students.`}
            </div>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.3rem' }}>
            {listed.map((student) => {
              const selected = sameId(student.id, selectedStudentId);
              return (
                <li key={student.id}>
                  <button
                    type="button"
                    onClick={() => onSelectStudent?.(student.id)}
                    // Not colour alone: the selected row also carries a heavier
                    // name, a left rule, and this state in the accessibility tree.
                    aria-current={selected ? 'true' : undefined}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      cursor: 'pointer',
                      padding: '0.5rem 0.65rem',
                      borderRadius: '8px',
                      background: selected
                        ? 'var(--primary-blue-light, rgba(59, 130, 246, 0.12))'
                        : 'transparent',
                      border: `1px solid ${selected ? 'var(--primary-blue)' : 'var(--border-color)'}`,
                      borderLeft: `4px solid ${selected ? 'var(--primary-blue)' : 'transparent'}`,
                      color: 'var(--text-main)',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.85rem',
                        fontWeight: selected ? 700 : 500,
                      }}
                    >
                      {student.name || '—'}
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        marginTop: '0.15rem',
                        fontSize: '0.72rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <MapPin size={11} aria-hidden="true" />
                      {student.branchName || '—'}
                      <span aria-hidden="true">·</span>
                      {student.level || '—'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {filtersActive && listed.length > 0 ? (
        <div
          style={{
            padding: '0.5rem 1rem',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.72rem',
            color: 'var(--text-secondary)',
          }}
        >
          {`Showing ${listed.length} of ${categoryStudents.length} ${activeCategory} students`}
        </div>
      ) : null}
    </section>
  );
}
