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
import { MapPin, Search, Users } from 'lucide-react';

import { useSchedule } from '../../contexts/ScheduleContext';

/**
 * The one-letter program markers, keyed by `PROGRAM_CATEGORIES` name.
 *
 * The colours are not new: they are the `.chip-kinder` / `.chip-junior` /
 * `.chip-coder` values already in `globals.css`, where the same pink / blue /
 * near-black coding marks programs on the trial availability grid. Reusing them
 * means a Kinder student is the same pink on both screens rather than two
 * unrelated pinks that drift apart.
 *
 * A letter alone is a weak signal, so every tab also carries the full program
 * name in its `aria-label` and `title` (see the tablist below). Colour is never
 * the only thing distinguishing one tab from another.
 */
const CATEGORY_BADGES = {
  Kinder: { letter: 'K', color: '#db2777', bg: '#fce7f3' },
  Junior: { letter: 'J', color: '#2563eb', bg: '#dbeafe' },
  Coder: { letter: 'C', color: '#1e293b', bg: '#f1f5f9' },
};
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
          const badge = CATEGORY_BADGES[name] || CATEGORY_BADGES.Coder;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              id={`report-cards-tab-${name}`}
              aria-selected={selected}
              aria-controls={panelId}
              onClick={() => onCategoryChange?.(name)}
              // The visible label is one letter, so the full program name and the
              // count have to travel in the accessible name — otherwise the tab
              // announces as "K" and the colour carries meaning nothing but sight
              // can read.
              aria-label={`${name} — ${count} student${count === 1 ? '' : 's'}`}
              title={`${name} — ${count} student${count === 1 ? '' : 's'}`}
              style={{
                flex: '1 1 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.3rem',
                cursor: 'pointer',
                padding: '0.4rem 0.5rem',
                borderRadius: '8px',
                background: selected ? badge.bg : 'transparent',
                // The letter keeps its program colour whether or not the tab is
                // selected, so colour identifies the program and the filled
                // background plus the ring identify the selection. Colour is
                // never the only thing marking which tab is active.
                color: badge.color,
                border: `1px solid ${selected ? badge.color : 'var(--border-color)'}`,
                boxShadow: selected ? `inset 0 0 0 1px ${badge.color}` : 'none',
              }}
            >
              <span
                aria-hidden="true"
                style={{ fontSize: '0.95rem', fontWeight: 800, lineHeight: 1 }}
              >
                {badge.letter}
              </span>
              <span
                aria-hidden="true"
                style={{
                  minWidth: '1.4rem',
                  padding: '0 0.3rem',
                  borderRadius: '999px',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  background: selected ? 'rgba(255,255,255,0.65)' : 'var(--border-color)',
                  color: selected ? badge.color : 'var(--text-secondary)',
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
