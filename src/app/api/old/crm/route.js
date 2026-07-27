/**
 * Old Operations — CRM leads (Google Sheets backed).
 *
 * Namespaced alias for /api/crm. Requires `Authorization: Bearer <CRM_API_KEY>`,
 * same as the original path, which stays live for existing integrations.
 */
export { GET, POST, PATCH } from '../../crm/route';
