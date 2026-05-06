import { useState } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { DAY_NAMES } from '../utils/constants';
import Badge from '../components/ui/Badge';
import Pagination from '../components/ui/Pagination';
import { Trash2 } from 'lucide-react';

const PAGE_SIZE = 8;

export default function LeavePage() {
  const { uniqueBaseTeachers, leaveList, updateLeaveList } = useSchedule();
  const [selectedInstructor, setSelectedInstructor] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [reason, setReason] = useState('');
  const [page, setPage] = useState(1);

  const sortedTeachers = [...uniqueBaseTeachers].sort();
  const totalPages = Math.ceil(leaveList.length / PAGE_SIZE);
  const paged = leaveList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const canAdd = selectedInstructor && selectedDay;

  const handleAdd = () => {
    if (!canAdd) return;
    const exists = leaveList.some(
      (l) => l.name === selectedInstructor && l.day === selectedDay
    );
    if (exists) {
      alert(`${selectedInstructor} is already marked on leave for ${selectedDay}.`);
      return;
    }
    const newList = [...leaveList, { name: selectedInstructor, day: selectedDay, reason }];
    updateLeaveList(newList);
    setSelectedInstructor('');
    setSelectedDay('');
    setReason('');
  };

  const handleRemove = (index) => {
    const actualIndex = (page - 1) * PAGE_SIZE + index;
    const newList = leaveList.filter((_, i) => i !== actualIndex);
    updateLeaveList(newList);
    if (paged.length === 1 && page > 1) setPage(page - 1);
  };

  return (
    <section className="dashboard-view active">
      <div className="panel leave-panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Leave Management</h2>
            <span className="subtext">Mark instructors as on leave for specific days</span>
          </div>
          <Badge variant="warning">{leaveList.length} On Leave</Badge>
        </div>
        <div className="panel-body leave-body">
          <div className="leave-form">
            <div className="leave-form-row">
              <div className="input-group leave-input-name">
                <label>Instructor</label>
                <select value={selectedInstructor} onChange={(e) => setSelectedInstructor(e.target.value)}>
                  <option value="" disabled>Select instructor...</option>
                  {sortedTeachers.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="input-group leave-input-day">
                <label>Day</label>
                <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)}>
                  <option value="" disabled>Select day...</option>
                  {DAY_NAMES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="input-group leave-input-reason">
                <label>Reason (optional)</label>
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sick, Holiday..." />
              </div>
              <button className="btn btn-warning leave-add-btn" disabled={!canAdd} onClick={handleAdd}>
                + Mark On Leave
              </button>
            </div>
          </div>

          <div className="leave-table-wrapper">
            <table className="leave-table">
              <thead>
                <tr>
                  <th>Instructor</th>
                  <th>Day</th>
                  <th>Reason</th>
                  <th style={{ width: 60, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {leaveList.length === 0 ? (
                  <tr><td colSpan="4" className="empty-state-table">No instructors on leave.</td></tr>
                ) : (
                  paged.map((l, i) => (
                    <tr key={i}>
                      <td>{l.name}</td>
                      <td>{l.day}</td>
                      <td>{l.reason || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn-icon btn-icon-danger" onClick={() => handleRemove(i)} title="Remove">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
    </section>
  );
}
