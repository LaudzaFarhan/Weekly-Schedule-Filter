/**
 * Old Operations — Instructor availability lookup (Google Sheets backed).
 *
 * Namespaced alias for /api/instructors. Accepts either
 * `Authorization: Bearer <CHATBOT_API_KEY|CRM_API_KEY>` or `?key=`, same as the
 * original path, which stays live for existing integrations.
 */
export { GET } from '../../instructors/route';
