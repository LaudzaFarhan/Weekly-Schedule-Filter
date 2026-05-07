'use client';

import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { SCHEDULE_PAGE_SIZE } from '../utils/constants';
import Pagination from '../components/ui/Pagination';

export default function SchedulePage() {
  const { allClasses, uniqueTeachers } = useSchedule();
  const [search, setSearch] = useState('');
  const [filterInstructor, setFilterInstructor] = useState('all');
  const [page, setPage] = useState(1);

  const sortedTeachers = [...uniqueTeachers].sort();

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return allClasses.filter((c) => {
      const matchInst = filterInstructor === 'all' || c.teacher === filterInstructor;
      const matchSearch =
        !s ||
        c.teacher.toLowerCase().includes(s) ||
        c.student.toLowerCase().includes(s) ||
        c.program.toLowerCase().includes(s) ||
        (c.remarks && c.remarks.toLowerCase().includes(s));
      return matchInst && matchSearch;
    });
  }, [allClasses, search, filterInstructor]);

  const totalPages = Math.ceil(filtered.length / SCHEDULE_PAGE_SIZE);
  const paged = filtered.slice((page - 1) * SCHEDULE_PAGE_SIZE, page * SCHEDULE_PAGE_SIZE);

  const handleFilterChange = () => {
    setPage(1);
  };

  return (
    <section className="dashboard-view active">
      <div className="panel full-schedule-panel">
        <div className="panel-header">
          <h2>Master Schedule View</h2>
          <div className="filter-controls">
            <input
              type="text"
              placeholder="Filter by teacher, student, module..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              disabled={allClasses.length === 0}
            />
            <div className="input-group">
              <label>Instructor</label>
              <select
                value={filterInstructor}
                onChange={(e) => { setFilterInstructor(e.target.value); setPage(1); }}
                disabled={allClasses.length === 0}
              >
                <option value="all">All Instructors</option>
                {sortedTeachers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
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
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {allClasses.length === 0 ? (
                <tr><td colSpan="6" className="empty-state-table">Click "Sync Schedule" to load data</td></tr>
              ) : paged.length === 0 ? (
                <tr><td colSpan="6" className="empty-state-table">No results match your filter.</td></tr>
              ) : (
                paged.map((c, i) => (
                  <tr key={i}>
                    <td>{c.day}</td>
                    <td>{c.time}</td>
                    <td>{c.program}</td>
                    <td>{c.teacher}</td>
                    <td>{c.student}</td>
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
