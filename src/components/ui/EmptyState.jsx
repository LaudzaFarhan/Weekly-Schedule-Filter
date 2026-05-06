export default function EmptyState({ icon, message, subtext }) {
  return (
    <div className="empty-state">
      {icon}
      <p>{message}</p>
      {subtext && <span className="subtext">{subtext}</span>}
    </div>
  );
}
