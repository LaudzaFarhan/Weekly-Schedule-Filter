import { NextResponse } from 'next/server';

/**
 * Discovery index.
 *
 * The app exposes two independent APIs over two different data stores. Rather
 * than merge them into one spec — which invites an agent to mix a Sheets record
 * with a Postgres one — this lists both so the caller picks deliberately.
 */
export async function GET(request) {
  const origin = new URL(request.url).origin;

  return NextResponse.json(
    {
      name: 'The Lab Operation System',
      description:
        'Two separate operation sets, each with its own OpenAPI spec and its own data store. ' +
        'Records are not shared between them: a student in New Operations is not the same row as a student in Old Operations.',
      operationSets: [
        {
          id: 'new',
          name: 'New Operations',
          store: 'PostgreSQL',
          basePath: '/api/new',
          openapi: `${origin}/api/new/openapi.json`,
          auth: 'Single bearer token (NEW_OPS_API_KEY) for every endpoint.',
          use: 'Current source of truth: schedule, students, instructors, CRM, operational rules, leave, workload and trial availability.',
        },
        {
          id: 'old',
          name: 'Old Operations',
          store: 'Google Sheets',
          basePath: '/api/old',
          openapi: `${origin}/api/old/openapi.json`,
          auth: 'Varies per endpoint: CHATBOT_API_KEY, CRM_API_KEY, or none. See the spec.',
          use: 'Legacy Sheets-backed schedule, trial booking and CRM. Also holds the shared branch config.',
          note: 'Every /api/old/* path is mirrored at its original URL without the prefix (e.g. /api/slots) for existing integrations.',
        },
      ],
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  );
}
