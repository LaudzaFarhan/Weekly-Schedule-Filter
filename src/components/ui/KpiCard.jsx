export default function KpiCard({ icon, title, value, variant = 'blue' }) {
  const colors = {
    blue: { bg: 'rgba(79, 70, 229, 0.1)', color: '#4f46e5' },
    green: { bg: 'rgba(16, 185, 129, 0.1)', color: '#10b981' },
    red: { bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' },
    orange: { bg: 'rgba(249, 115, 22, 0.1)', color: '#f97316' },
  };

  const style = colors[variant] || colors.blue;

  return (
    <div className="kpi-card">
      <div className="kpi-content">
        <h3>{title}</h3>
        <p>{value}</p>
      </div>
      <div className="kpi-icon" style={{ backgroundColor: style.bg, color: style.color }}>
        {icon}
      </div>
    </div>
  );
}
