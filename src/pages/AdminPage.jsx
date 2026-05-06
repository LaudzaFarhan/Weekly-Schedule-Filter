import { useSchedule } from '../contexts/ScheduleContext';

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
  const { featureToggles, updateFeatureToggles } = useSchedule();

  const handleToggle = (key) => {
    const newToggles = { ...featureToggles, [key]: !featureToggles[key] };
    updateFeatureToggles(newToggles);
  };

  return (
    <section className="dashboard-view active">
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Admin Settings</h2>
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
    </section>
  );
}
