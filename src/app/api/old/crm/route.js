/**
 * Old Operations — CRM leads (Google Sheets backed).
 *
 * Namespaced alias for /api/crm. Requires `Authorization: Bearer <CRM_API_KEY>`,
 * same as the original path, which stays live for existing integrations.
 */
import {
  GET as getNewCrm,
  POST as postNewCrm,
  PUT as putNewCrm,
  DELETE as deleteNewCrm,
} from '../../new/crm/route';

export async function GET(request) {
  return getNewCrm(request);
}

export async function POST(request) {
  return postNewCrm(request);
}

export async function PUT(request) {
  return putNewCrm(request);
}

export async function DELETE(request) {
  return deleteNewCrm(request);
}
