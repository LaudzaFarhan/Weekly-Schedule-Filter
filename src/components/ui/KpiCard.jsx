export default function KpiCard({ icon, title, value, variant = 'blue' }) {
  const colors = {
    blue: { bg: 'var(--primary-blue-light)', color: 'var(--primary-blue)' },
    green: { bg: 'var(--success-bg)', color: 'var(--success)' },
    red: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
    orange: { bg: 'var(--primary-orange-light)', color: 'var(--primary-orange)' },
  };

  const style = colors[variant] || colors.blue;

  return (
    <div className="kpi-card">
      <div className="kpi-icon" style={{ backgroundColor: style.bg, color: style.color }}>
        {icon}
      </div>
      <div className="kpi-content">
        <h3>{title}</h3>
        <p>{value}</p>
      </div>
    </div>
  );
}
