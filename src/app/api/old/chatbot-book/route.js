/**
 * Old Operations — Chatbot trial booking (Google Sheets backed).
 *
 * Namespaced alias for /api/chatbot-book. Requires
 * `Authorization: Bearer <CHATBOT_API_KEY>`, same as the original path, which
 * stays live for existing integrations.
 */
export { POST } from '../../chatbot-book/route';
