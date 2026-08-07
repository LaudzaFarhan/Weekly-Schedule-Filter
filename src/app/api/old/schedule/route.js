/**
 * Old Operations — Schedule (Google Sheets backed).
 *
 * Namespaced alias for /api/schedule. The original path stays live so existing
 * integrations (Qontak, Apps Script) keep working; use this one for anything new
 * so old- and new-operations calls are clearly separated.
 */
import { GET as getNewSchedule, POST as postNewSchedule } from '../../new/schedule/route';

export async function GET(request) {
  return getNewSchedule(request);
}

export async function POST(request) {
  return postNewSchedule(request);
}
