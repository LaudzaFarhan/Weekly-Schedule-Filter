'use client';

import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { DAY_NAMES, SCHEDULE_PAGE_SIZE } from '../utils/constants';
import Pagination from '../components/ui/Pagination';

export default function SchedulePage() {
  const { overallClasses, uniqueTeachers, branches } = useSchedule();
  const [search, setSearch] = useState('');
  const [filterInstructor, setFilterInstructor] = useState('all');
  const [filterDay, setFilterDay] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [page, setPage] = useState(1);

  const sortedTeachers = [...uniqueTeachers].sort();

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return overallClasses.filter((c) => {
      if (filterDay !== 'all' && c.day !== filterDay) return false;
      if (filterBranch !== 'all' && c.branchName !== filterBranch) return false;
      if (filterInstructor !== 'all' && c.teacher !== filterInstructor) return false;
      if (s) {
        const match =
          (c.teacher && c.teacher.toLowerCase().includes(s)) ||
          (c.student && c.student.toLowerCase().includes(s)) ||
          (c.program && c.program.toLowerCase().includes(s)) ||
          (c.remarks && c.remarks.toLowerCase().includes(s));
        if (!match) return false;
      }
      return true;
    });
  }, [overallClasses, search, filterInstructor, filterDay, filterBranch]);

  const totalPages = Math.ceil(filtered.length / SCHEDULE_PAGE_SIZE);
  const paged = filtered.slice((page - 1) * SCHEDULE_PAGE_SIZE, page * SCHEDULE_PAGE_SIZE);

  return (
    <section className="dashboard-view active">
      <div className="panel full-schedule-panel">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2>Master Schedule View</h2>
          <div className="filter-controls" style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div className="input-group">
              <label>Search</label>
              <input
                type="text"
                placeholder="Filter by teacher, student, module..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                disabled={overallClasses.length === 0}
              />
            </div>
            <div className="input-group">
              <label>Branch</label>
              <select
                value={filterBranch}
                onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }}
                disabled={overallClasses.length === 0}
              >
                <option value="all">All Branches</option>
                {branches?.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label>Instructor</label>
              <select
                value={filterInstructor}
                onChange={(e) => { setFilterInstructor(e.target.value); setPage(1); }}
                disabled={overallClasses.length === 0}
              >
                <option value="all">All Instructors</option>
                {sortedTeachers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Day tabs */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <button
            onClick={() => { setFilterDay('all'); setPage(1); }}
            style={{
              padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
              border: filterDay === 'all' ? '1.5px solid var(--primary, #3b82f6)' : '1px solid var(--border-color)',
              background: filterDay === 'all' ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
              fontWeight: filterDay === 'all' ? 600 : 400,
              color: filterDay === 'all' ? 'var(--primary, #3b82f6)' : 'var(--text-secondary)'
            }}
          >
            All Days
          </button>
          {DAY_NAMES.map(day => (
            <button
              key={day}
              onClick={() => { setFilterDay(day); setPage(1); }}
              style={{
                padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
                border: filterDay === day ? '1.5px solid var(--primary, #3b82f6)' : '1px solid var(--border-color)',
                background: filterDay === day ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                fontWeight: filterDay === day ? 600 : 400,
                color: filterDay === day ? 'var(--primary, #3b82f6)' : 'var(--text-secondary)'
              }}
            >
              {day}
            </button>
          ))}
        </div>

        <div className="panel-body table-wrapper">
          <table id="schedule-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Time</th>
                <th>Program</th>
                <th>Instructor</th>
                <th>Student Name</th>
                <th>Branch</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {overallClasses.length === 0 ? (
                <tr><td colSpan="7" className="empty-state-table">Click "Sync Schedule" to load data</td></tr>
              ) : paged.length === 0 ? (
                <tr><td colSpan="7" className="empty-state-table">No results match your filter.</td></tr>
              ) : (
                paged.map((c, i) => (
                  <tr key={i}>
                    <td>{c.day}</td>
                    <td>{c.time}</td>
                    <td>{c.program}</td>
                    <td>{c.teacher}</td>
                    <td>{c.student}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{c.branchName || '—'}</td>
                    <td>{c.remarks || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
    </section>
  );
}
