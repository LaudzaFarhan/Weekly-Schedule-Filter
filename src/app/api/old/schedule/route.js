/**
 * Old Operations — Schedule (Google Sheets backed).
 *
 * Namespaced alias for /api/schedule. The original path stays live so existing
 * integrations (Qontak, Apps Script) keep working; use this one for anything new
 * so old- and new-operations calls are clearly separated.
 */
export { GET } from '../../schedule/route';
