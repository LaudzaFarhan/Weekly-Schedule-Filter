export default function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  return (
    <div className="schedule-pagination">
      <button
        className="btn btn-sm"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        ← Prev
      </button>
      <span className="pagination-info">
        Page {currentPage} of {totalPages}
      </span>
      <button
        className="btn btn-sm"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Next →
      </button>
    </div>
  );
}
