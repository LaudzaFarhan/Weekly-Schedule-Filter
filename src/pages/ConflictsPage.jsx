import { useState } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import Badge from '../components/ui/Badge';
import Pagination from '../components/ui/Pagination';
import { CheckCircle } from 'lucide-react';

const PAGE_SIZE = 5;

export default function ConflictsPage() {
  const { conflicts } = useSchedule();
  const [page, setPage] = useState(1);

  const totalPages = Math.ceil(conflicts.length / PAGE_SIZE);
  const paged = conflicts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <section className="dashboard-view active">
      <div className="panel conflicts-panel">
        <div className="panel-header">
          <h2>Conflict Report</h2>
          <Badge variant="danger">{conflicts.length} Detected</Badge>
        </div>
        <div className="panel-body">
          <div className="list-container">
            {conflicts.length === 0 ? (
              <div className="empty-state">
                <CheckCircle size={40} />
                <p>No conflicts detected yet.</p>
                <span className="subtext">Sync the schedule to run analysis.</span>
              </div>
            ) : (
              paged.map((c, i) => (
                <div key={i} className="conflict-card">
                  <div className="conflict-header">
                    <strong>{c.teacher}</strong>
                    <Badge variant="danger">{c.day}</Badge>
                  </div>
                  <div className="conflict-detail">
                    <span className="conflict-slot">{c.slot1}</span>
                    <span className="conflict-vs">⚡ overlaps with</span>
                    <span className="conflict-slot">{c.slot2}</span>
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
