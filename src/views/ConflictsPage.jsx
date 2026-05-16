'use client';

import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { DAY_NAMES } from '../utils/constants';
import Badge from '../components/ui/Badge';
import Pagination from '../components/ui/Pagination';
import { CheckCircle } from 'lucide-react';

const PAGE_SIZE = 5;

export default function ConflictsPage() {
  const { conflicts, branches } = useSchedule();
  const [page, setPage] = useState(1);
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterDay, setFilterDay] = useState('all');

  const filteredConflicts = useMemo(() => {
    let result = conflicts;
    if (filterBranch !== 'all') {
      result = result.filter(c => c.branches.includes(filterBranch));
    }
    if (filterDay !== 'all') {
      result = result.filter(c => c.day === filterDay);
    }
    return result;
  }, [conflicts, filterBranch, filterDay]);

  const totalPages = Math.ceil(filteredConflicts.length / PAGE_SIZE);
  const paged = filteredConflicts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const branchOptions = ['all', ...(branches || []).map(b => b.name)];

  const handlePrev = () => {
    const idx = branchOptions.indexOf(filterBranch);
    const prevIdx = idx <= 0 ? branchOptions.length - 1 : idx - 1;
    setFilterBranch(branchOptions[prevIdx]);
    setPage(1);
  };

  const handleNext = () => {
    const idx = branchOptions.indexOf(filterBranch);
    const nextIdx = idx >= branchOptions.length - 1 ? 0 : idx + 1;
    setFilterBranch(branchOptions[nextIdx]);
    setPage(1);
  };

  return (
    <section className="dashboard-view active">
      <div className="panel conflicts-panel">
        <div className="panel-header">
          <h2>Conflict Report</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary, #f1f5f9)', borderRadius: '8px', padding: '0.35rem 0.6rem' }}>
              <button
                onClick={handlePrev}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}
              >
                ‹
              </button>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '110px', textAlign: 'center' }}>
                {filterBranch === 'all' ? 'All Branches' : filterBranch}
              </span>
              <button
                onClick={handleNext}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}
              >
                ›
              </button>
            </div>
            <Badge variant="danger">{filteredConflicts.length} Detected</Badge>
          </div>
        </div>
        <div className="panel-body">
          {/* Day filter tabs */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <button
              onClick={() => { setFilterDay('all'); setPage(1); }}
              style={{
                padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
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
                  padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
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

          <div className="list-container">
            {filteredConflicts.length === 0 ? (
              <div className="empty-state">
                <CheckCircle size={40} />
                <p>No conflicts detected{filterBranch !== 'all' ? ` for ${filterBranch}` : ''}.</p>
                <span className="subtext">Sync the schedule to run analysis.</span>
              </div>
            ) : (
              paged.map((c, i) => (
                <div key={i} className="conflict-card">
                  <div className="conflict-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <strong>{c.teacher}</strong>
                      {c.branches.length > 0 && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          ({c.branches.join(', ')})
                        </span>
                      )}
                    </div>
                    <Badge variant="danger">{c.day}</Badge>
                  </div>
                  <div className="conflict-detail">
                    <span className="conflict-slot">
                      {c.slot1}
                      {c.branch1 && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '4px' }}>[{c.branch1}]</span>}
                    </span>
                    <span className="conflict-vs">⚡ overlaps with</span>
                    <span className="conflict-slot">
                      {c.slot2}
                      {c.branch2 && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '4px' }}>[{c.branch2}]</span>}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
    </section>
  );
}
