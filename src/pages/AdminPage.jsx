import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { Search } from 'lucide-react';

const FEATURE_LABELS = {
  conflicts: 'Conflict Report',
  availability: 'Slot Availability Checker',
  avail_available: '  ↳ Available Column',
  avail_busy: '  ↳ Busy Column',
  avail_leave: '  ↳ On Leave Column',
  leave: 'Leave Management',
  trial: 'Trial Priority Instructors',
  trial_overview: 'Trial Availability Overview',
  finder: 'Free Instructor Finder',
  schedule: 'Master Schedule View',
  trial_input: 'Input Trial Leads',
};

export default function AdminPage() {
  const {
    featureToggles, updateFeatureToggles,
    uniqueBaseTeachers,
    disabledInstructors, updateDisabledInstructors,
  } = useSchedule();

  const [instructorSearch, setInstructorSearch] = useState('');

  const handleToggle = (key) => {
    const newToggles = { ...featureToggles, [key]: !featureToggles[key] };
    updateFeatureToggles(newToggles);
  };

  const handleInstructorToggle = (name) => {
    const newSet = new Set(disabledInstructors);
    if (newSet.has(name)) {
      newSet.delete(name);
    } else {
      newSet.add(name);
    }
    updateDisabledInstructors(newSet);
  };

  const handleEnableAll = () => {
    updateDisabledInstructors(new Set());
  };

  const handleDisableAll = () => {
    updateDisabledInstructors(new Set(uniqueBaseTeachers));
  };

  const sortedTeachers = useMemo(() => {
    const arr = [...uniqueBaseTeachers].sort();
    if (!instructorSearch) return arr;
    const s = instructorSearch.toLowerCase();
    return arr.filter((t) => t.toLowerCase().includes(s));
  }, [uniqueBaseTeachers, instructorSearch]);

  const disabledCount = disabledInstructors.size;
  const totalCount = uniqueBaseTeachers.size;

  return (
    <section className="dashboard-view active" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Feature Toggles */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Feature Toggles</h2>
            <span className="subtext">Toggle dashboard features on or off</span>
          </div>
        </div>
        <div className="panel-body">
          <div className="admin-toggles">
            {Object.entries(FEATURE_LABELS).map(([key, label]) => (
              <div key={key} className={`admin-toggle-row ${key.startsWith('avail_') ? 'indent' : ''}`}>
                <span className="admin-toggle-label">{label}</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={featureToggles[key] !== false}
                    onChange={() => handleToggle(key)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Instructor Management */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Instructor Management</h2>
            <span className="subtext">Disable instructors to exclude them from trial schedule &amp; class assignment</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {disabledCount > 0 && (
              <span className="badge badge-danger">{disabledCount} Disabled</span>
            )}
            <span className="badge badge-success">{totalCount - disabledCount} Active</span>
          </div>
        </div>
        <div className="panel-body">
          {totalCount === 0 ? (
            <div className="empty-state">
              <p>Sync the schedule first to see instructors.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1', minWidth: '200px', maxWidth: '320px' }}>
                  <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search instructors..."
                    value={instructorSearch}
                    onChange={(e) => setInstructorSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.8rem 0.5rem 2rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-sm" onClick={handleEnableAll}>Enable All</button>
                  <button className="btn btn-sm btn-warning" onClick={handleDisableAll}>Disable All</button>
                </div>
              </div>
              <div className="admin-toggles" style={{ maxWidth: '100%' }}>
                {sortedTeachers.map((name) => {
                  const isDisabled = disabledInstructors.has(name);
                  return (
                    <div
                      key={name}
                      className="admin-toggle-row"
                      style={{
                        opacity: isDisabled ? 0.55 : 1,
                        background: isDisabled ? 'var(--danger-bg)' : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span className="admin-toggle-label">{name}</span>
                        {isDisabled && (
                          <span className="badge badge-danger" style={{ fontSize: '0.65rem' }}>Disabled</span>
                        )}
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={!isDisabled}
                          onChange={() => handleInstructorToggle(name)}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  );
                })}
                {sortedTeachers.length === 0 && instructorSearch && (
                  <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No instructors match "{instructorSearch}"
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
