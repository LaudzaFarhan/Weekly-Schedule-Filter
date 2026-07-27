import { NextResponse } from 'next/server';

/**
 * OpenAPI 3.1 description of the Old Operations API (Google Sheets backed).
 *
 * These endpoints read and write the legacy Google Sheets workbooks. They are
 * intentionally described separately from New Operations so an agent can't
 * confuse the two data sets — a student in Sheets is not the same record as a
 * student in Postgres.
 *
 * Every path here is also available at its original un-namespaced URL
 * (e.g. /api/slots) for the existing Qontak integration.
 */

const ok = (description, schema = { type: 'object' }) => ({
  200: { description, content: { 'application/json': { schema } } },
});

const unauthorized = {
  401: { description: 'Missing or incorrect bearer token.' },
};

function buildSpec(origin) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'The Lab Operation System — Old Operations API',
      version: '1.0.0',
      'x-operation-set': 'old',
      description: [
        'Legacy operations backed by Google Sheets. Separate from the New',
        'Operations API (/api/new/openapi.json), which is backed by PostgreSQL.',
        'The two hold different data — do not mix records between them.',
        '',
        'Auth varies per endpoint and uses different secrets:',
        '- CHATBOT_API_KEY: /api/old/slots, /api/old/chatbot-book',
        '- CRM_API_KEY: /api/old/crm',
        '- Either of the two: /api/old/instructors',
        '- No auth: /api/old/schedule, /api/old/book-trial, /api/old/config',
        '',
        'Each path is mirrored at its original URL without the /old prefix.',
      ].join('\n'),
    },
    servers: [{ url: origin }],
    tags: [
      { name: 'Schedule', description: 'Weekly schedule read from a published Sheet.' },
      { name: 'Trials', description: 'Trial slot availability and booking.' },
      { name: 'CRM', description: 'Lead pipeline in Sheets.' },
      { name: 'Config', description: 'Shared branch and feature configuration.' },
    ],
    paths: {
      '/api/old/schedule': {
        get: {
          tags: ['Schedule'],
          operationId: 'oldGetSchedule',
          summary: 'Fetch and parse a published Google Sheet of the weekly schedule.',
          description: 'Server-side proxy that avoids browser CORS limits. No authentication.',
          parameters: [
            {
              name: 'sheetUrl',
              in: 'query',
              schema: { type: 'string' },
              description: 'Published Google Sheet URL to read. Falls back to the configured default.',
            },
          ],
          responses: ok('Parsed schedule rows.'),
        },
      },

      '/api/old/slots': {
        get: {
          tags: ['Trials'],
          operationId: 'oldGetTrialSlots',
          summary: 'Available one-hour trial slots for a day, filtered by busy instructors, leave and trial priority.',
          description: 'Requires Authorization: Bearer <CHATBOT_API_KEY>.',
          security: [{ chatbotKey: [] }],
          parameters: [
            { name: 'day', in: 'query', required: true, schema: { type: 'string' }, description: 'Full day name, e.g. "Monday".' },
            { name: 'program', in: 'query', schema: { type: 'string' }, description: 'Kinder, Junior, or Coder. Supply this or age.' },
            { name: 'age', in: 'query', schema: { type: 'integer' }, description: 'Student age; the program is inferred from it.' },
          ],
          responses: { ...ok('Available trial slots.'), ...unauthorized },
        },
      },

      '/api/old/instructors': {
        get: {
          tags: ['Schedule'],
          operationId: 'oldGetInstructors',
          summary: 'Instructor availability lookup for a day and time.',
          description: 'Accepts Authorization: Bearer <CHATBOT_API_KEY or CRM_API_KEY>, or ?key= as a fallback.',
          security: [{ chatbotKey: [] }, { crmKey: [] }],
          parameters: [
            { name: 'day', in: 'query', schema: { type: 'string' } },
            { name: 'time', in: 'query', schema: { type: 'string' }, description: 'Slot string, e.g. "1.00 - 2.00 pm".' },
            { name: 'branch', in: 'query', schema: { type: 'string' } },
            { name: 'key', in: 'query', schema: { type: 'string' }, description: 'API key as a query parameter, for clients that cannot set headers.' },
          ],
          responses: { ...ok('Instructor availability.'), ...unauthorized },
        },
      },

      '/api/old/book-trial': {
        post: {
          tags: ['Trials'],
          operationId: 'oldBookTrial',
          summary: 'Append a trial lead to the Trial Leads sheet.',
          description: 'Writes via the Google Sheets API when configured, otherwise proxies to the branch Apps Script. No authentication — treat as write-only.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    phone: { type: 'string' },
                    branch: { type: 'string' },
                    program: { type: 'string' },
                    date: { type: 'string', example: '2026-08-10' },
                    time: { type: 'string', example: '10.00 - 11.00 am' },
                    teacher: { type: 'string' },
                    remarks: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: ok('Write result.'),
        },
      },

      '/api/old/chatbot-book': {
        post: {
          tags: ['Trials'],
          operationId: 'oldChatbotBook',
          summary: 'Complete a chatbot trial booking: infers the program from age and assigns a free, prioritised instructor.',
          description: 'Requires Authorization: Bearer <CHATBOT_API_KEY>.',
          security: [{ chatbotKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    phone: { type: 'string' },
                    age: { type: 'integer' },
                    branch: { type: 'string' },
                    date: { type: 'string' },
                    time: { type: 'string' },
                    remarks: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { ...ok('Booking result including the assigned instructor.'), ...unauthorized },
        },
      },

      '/api/old/crm': {
        get: {
          tags: ['CRM'],
          operationId: 'oldGetCrm',
          summary: 'CRM leads matched against the schedule, with booked-slot summary and live trial availability.',
          description: 'Requires Authorization: Bearer <CRM_API_KEY>.',
          security: [{ crmKey: [] }],
          responses: { ...ok('Leads with schedule matches.'), ...unauthorized },
        },
        post: {
          tags: ['CRM'],
          operationId: 'oldCreateCrmLead',
          summary: 'Webhook for WhatsApp bots to insert a lead.',
          security: [{ crmKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    phone: { type: 'string' },
                    message: { type: 'string' },
                    branch: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { ...ok('The created lead.'), ...unauthorized },
        },
        patch: {
          tags: ['CRM'],
          operationId: 'oldUpdateCrmLead',
          summary: 'Update an existing lead, e.g. its status or notes.',
          security: [{ crmKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    phone: { type: 'string', description: 'Used to locate the lead.' },
                    status: { type: 'string' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { ...ok('The updated lead.'), ...unauthorized },
        },
      },

      '/api/old/config': {
        get: {
          tags: ['Config'],
          operationId: 'oldGetConfig',
          summary: 'All shared configuration: branches, leave list, trial priority, feature toggles.',
          description: 'Returns { configured: false } when Google Sheets credentials are absent. Also holds the New Operations branch open days, operating hours and class slot plan.',
          responses: ok('Configuration payload.'),
        },
        post: {
          tags: ['Config'],
          operationId: 'oldSetConfig',
          summary: 'Save a single configuration value.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['key', 'value'],
                  properties: {
                    key: { type: 'string', example: 'branches' },
                    value: {},
                  },
                },
              },
            },
          },
          responses: ok('Write result.'),
        },
      },
    },

    components: {
      securitySchemes: {
        chatbotKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'CHATBOT_API_KEY environment variable.',
        },
        crmKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'CRM_API_KEY environment variable.',
        },
      },
    },
  };
}

export async function GET(request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json(buildSpec(origin), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
