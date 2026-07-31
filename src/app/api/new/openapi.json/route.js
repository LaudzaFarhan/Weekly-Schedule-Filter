import { NextResponse } from 'next/server';

/**
 * OpenAPI 3.1 description of the New Operations API.
 *
 * Serving this lets an agent platform (Hermes, or anything else that consumes
 * OpenAPI for tool calling) discover the available operations on its own,
 * instead of having tool definitions hand-written on the other side.
 *
 * Descriptions here are written for a model to read: they say when to use an
 * operation, not just what it returns.
 */

const idParam = {
  name: 'id',
  in: 'query',
  required: true,
  schema: { type: 'integer' },
  description: 'Record id to delete.',
};

const listParams = [
  {
    name: 'search',
    in: 'query',
    schema: { type: 'string' },
    description: 'Case-insensitive partial match. Use this instead of fetching everything and filtering.',
  },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', maximum: 500 },
    description: 'Maximum rows to return. Omit and every match is returned — always set this for chat replies.',
  },
];

const ok = (description, schema) => ({
  200: { description, content: { 'application/json': { schema } } },
});

const arrayOf = (name) => ({ type: 'array', items: { $ref: `#/components/schemas/${name}` } });

const errorResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: { type: 'object', properties: { error: { type: 'string' } } },
    },
  },
});

function crud({ tag, path, schemaName, listDescription, createDescription, extraListParams = [] }) {
  return {
    [path]: {
      get: {
        tags: [tag],
        operationId: `list${schemaName}`,
        summary: listDescription,
        parameters: [...listParams, ...extraListParams],
        responses: ok(`Matching ${tag.toLowerCase()} records.`, arrayOf(schemaName)),
      },
      post: {
        tags: [tag],
        operationId: `create${schemaName}`,
        summary: createDescription,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
        },
        responses: ok('The created record.', { $ref: `#/components/schemas/${schemaName}` }),
      },
      put: {
        tags: [tag],
        operationId: `update${schemaName}`,
        summary: `Update an existing ${tag.toLowerCase()} record. The body must include "id".`,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
        },
        responses: ok('The updated record.', { $ref: `#/components/schemas/${schemaName}` }),
      },
      delete: {
        tags: [tag],
        operationId: `delete${schemaName}`,
        summary: `Permanently delete a ${tag.toLowerCase()} record. Destructive — confirm with the user first.`,
        parameters: [idParam],
        responses: ok('Deletion result.', {
          type: 'object',
          properties: { success: { type: 'boolean' }, message: { type: 'string' } },
        }),
      },
    },
  };
}

/**
 * `DELETE /api/new/students` is the one delete in this API that does not take
 * an id. The generic `crud()` helper marks `?id=` as `required: true`, which is
 * wrong for this path in two directions: the id is optional, and a request that
 * omits it deletes the **entire** student registry.
 *
 * This override replaces the generated `delete` operation after the `crud()`
 * spread. It is written for an agent caller: the two forms are named, the
 * destructive scope is spelled out, the confirmation phrase is given verbatim,
 * and the precedence rule (`?id=` always wins) is stated so a single-record
 * delete can never be escalated into a wipe.
 */
const studentsDeleteOperation = {
  tags: ['Students'],
  operationId: 'deleteStudent',
  summary:
    'Delete ONE student by ?id=, or — with no ?id= and the exact phrase '
    + '"DELETE ALL STUDENTS" in the body — delete EVERY student record. '
    + 'The bulk form is irreversible: it empties the whole registry along with '
    + 'each student\'s branch history and live lesson progress. Never send the '
    + 'bodied form unless the user has explicitly asked for a full wipe and '
    + 'confirmed it.',
  description: [
    'Two distinct operations share this method. They are not interchangeable.',
    '',
    '1. Single record — `DELETE /api/new/students?id=42`. Deletes that one',
    '   student. No body is required and any body sent is ignored. Returns 404',
    '   when the id matches no record.',
    '',
    '2. Bulk wipe — `DELETE /api/new/students` with no `?id=` and the body',
    '   `{ "confirm": "DELETE ALL STUDENTS" }`. Deletes every student record',
    '   across every branch, every branch-history row keyed to those students,',
    '   and every live lesson progress row whose student name matches one of',
    '   them. This cannot be undone. Export the registry first.',
    '',
    'The confirmation phrase is mandatory for form 2 and is compared',
    'case-sensitively after leading and trailing whitespace is trimmed, so',
    '"delete all students" is rejected with 400. It is required of every',
    'caller the API admits, both same-origin browser requests and API-key',
    'callers.',
    '',
    '`?id=` takes precedence over the body. A request carrying an id is always',
    'a single-record delete, even when its body holds a valid confirmation',
    'phrase, so a one-student delete can never turn into a wipe.',
    '',
    'The class schedule, instructors, leave, operational rules and CRM leads',
    'are never touched. Class rows keep their student names as plain text, so',
    'after a wipe those names refer to students that no longer exist.',
  ].join('\n'),
  parameters: [
    {
      ...idParam,
      required: false,
      description:
        'Student id to delete. Omit ONLY when deleting every student record '
        + 'with the confirmation body. Supplying an id always means a '
        + 'single-record delete and makes the body irrelevant.',
    },
  ],
  requestBody: {
    required: false,
    description:
      'Required for the bulk wipe, and only for the bulk wipe. Omit entirely '
      + 'when deleting a single student by ?id=.',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['confirm'],
          properties: {
            confirm: {
              type: 'string',
              enum: ['DELETE ALL STUDENTS'],
              description:
                'Must be exactly "DELETE ALL STUDENTS" (case-sensitive, '
                + 'surrounding whitespace allowed). Sending this with no '
                + '?id= deletes every student record irreversibly.',
            },
          },
        },
        examples: {
          bulkWipe: {
            summary: 'Delete every student record — irreversible',
            value: { confirm: 'DELETE ALL STUDENTS' },
          },
        },
      },
    },
  },
  responses: {
    200: {
      description:
        'Single-record form returns { success, message }. Bulk form returns '
        + '{ success, deletedStudents, deletedHistory, deletedProgress } with '
        + 'all three counts always present, zeros included.',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string', description: 'Single-record form only.' },
              deletedStudents: {
                type: 'integer',
                minimum: 0,
                description: 'Bulk form only — student records deleted.',
              },
              deletedHistory: {
                type: 'integer',
                minimum: 0,
                description: 'Bulk form only — branch history records deleted.',
              },
              deletedProgress: {
                type: 'integer',
                minimum: 0,
                description: 'Bulk form only — live lesson progress records deleted.',
              },
            },
          },
        },
      },
    },
    400: errorResponse(
      'No ?id= and no usable confirmation value, or a confirmation value that '
      + 'does not match the phrase. Nothing is deleted.'
    ),
    404: errorResponse('The ?id= given matches no student record. Nothing is deleted.'),
    500: errorResponse(
      'The bulk delete failed or exceeded its 30-second limit. The whole '
      + 'operation is rolled back, so nothing is deleted.'
    ),
  },
};

function buildSpec(origin) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'The Lab Operation System — New Operations API',
      version: '1.0.0',
      'x-operation-set': 'new',
      description: [
        'Operational data for a multi-branch school: classes, students, instructors,',
        'CRM leads, branch operating rules, leave, and derived workload/availability.',
        '',
        'Conventions:',
        '- Days are full English names ("Monday").',
        '- Operating hours and slot times are 24h "HH:MM"; class time slots are',
        '  human strings like "1.00 pm - 3.00 pm".',
        '- Class length: Kinder programs 90 minutes, Junior and Coder 120.',
        '- Students per slot: Kinder 4, Junior and Coder 6.',
        '- Instructor levels are "Kinder and Junior" or "Junior and Coder"; an',
        '  instructor can only teach a category their level names.',
        '',
        'For questions about capacity or who is free, prefer /api/new/workload and',
        '/api/new/trial-availability — they answer in one call, with reasons.',
      ].join('\n'),
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Schedule', description: 'Weekly classes.' },
      { name: 'Students', description: 'Student registry.' },
      { name: 'Instructors', description: 'Instructor registry and capability.' },
      { name: 'CRM', description: 'Trial leads pipeline.' },
      { name: 'Operationals', description: 'Per branch/day open hours and class slot plan.' },
      { name: 'Leave', description: 'Instructor leave by date range.' },
      { name: 'Activity', description: 'Audit trail.' },
      { name: 'Reports', description: 'Derived, read-only answers.' },
    ],
    paths: {
      ...crud({
        tag: 'Schedule',
        path: '/api/new/schedule',
        schemaName: 'Class',
        listDescription: 'List weekly classes. Use search to find a student, teacher, program, or branch.',
        createDescription: 'Add a class (assign a student to a slot).',
        extraListParams: [
          { name: 'day', in: 'query', schema: { type: 'string' }, description: 'Filter to one day, e.g. "Monday".' },
          { name: 'branch', in: 'query', schema: { type: 'string' }, description: 'Filter to one branch name.' },
          { name: 'teacher', in: 'query', schema: { type: 'string' }, description: 'Filter to one instructor.' },
        ],
      }),
      '/api/new/students': {
        ...crud({
          tag: 'Students',
          path: '/api/new/students',
          schemaName: 'Student',
          listDescription: 'List students. Use search to look one up by name.',
          createDescription: 'Register a student.',
          extraListParams: [
            { name: 'branch', in: 'query', schema: { type: 'string' }, description: 'Filter to one branch name.' },
          ],
        })['/api/new/students'],
        // Overrides the generated delete: ?id= is optional here, and omitting
        // it with a confirmation body wipes the whole registry.
        delete: studentsDeleteOperation,
      },
      ...crud({
        tag: 'Instructors',
        path: '/api/new/instructors',
        schemaName: 'Instructor',
        listDescription: 'List instructors with their teaching level and branches.',
        createDescription: 'Register an instructor.',
        extraListParams: [
          { name: 'branch', in: 'query', schema: { type: 'string' }, description: 'Filter to instructors at a branch (includes "All Branches").' },
        ],
      }),
      ...crud({
        tag: 'CRM',
        path: '/api/new/crm',
        schemaName: 'Lead',
        listDescription: 'List trial leads. Use search for a name, phone, or message.',
        createDescription: 'Create a trial lead. This is the safe write for an inbound enquiry.',
        extraListParams: [
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by pipeline status, e.g. "interest_trial", "trial_booked".' },
          { name: 'branch', in: 'query', schema: { type: 'string' }, description: 'Filter to one branch name.' },
        ],
      }),

      '/api/new/operationals': {
        get: {
          tags: ['Operationals'],
          operationId: 'listOperationals',
          summary: 'Branch/day rules: whether the branch is open, its hours, and its class slot plan.',
          parameters: [
            { name: 'branch', in: 'query', schema: { type: 'string' } },
            { name: 'day', in: 'query', schema: { type: 'string' } },
            { name: 'openOnly', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: ok('Operational rules.', arrayOf('OperationalRule')),
        },
        post: {
          tags: ['Operationals'],
          operationId: 'upsertOperational',
          summary: 'Create or replace the rule for one branch/day. Upserts on (branchName, day).',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OperationalRule' } } },
          },
          responses: ok('The stored rule.', { $ref: '#/components/schemas/OperationalRule' }),
        },
        delete: {
          tags: ['Operationals'],
          operationId: 'deleteOperational',
          summary: 'Delete a rule by id, or by branch + day. Destructive.',
          parameters: [
            { name: 'id', in: 'query', schema: { type: 'integer' } },
            { name: 'branch', in: 'query', schema: { type: 'string' } },
            { name: 'day', in: 'query', schema: { type: 'string' } },
          ],
          responses: ok('Deletion result.', { type: 'object' }),
        },
      },

      '/api/new/leave': {
        get: {
          tags: ['Leave'],
          operationId: 'listLeave',
          summary: 'Instructor leave. Use from/to to find anyone away during a period.',
          parameters: [
            { name: 'instructor', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Returns leave overlapping this window, not only leave inside it.' },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['Approved', 'Pending', 'Rejected'] } },
          ],
          responses: ok('Leave records.', arrayOf('Leave')),
        },
        post: {
          tags: ['Leave'],
          operationId: 'createLeave',
          summary: 'Record instructor leave for a date range.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Leave' } } },
          },
          responses: ok('The created leave record.', { $ref: '#/components/schemas/Leave' }),
        },
        put: {
          tags: ['Leave'],
          operationId: 'updateLeave',
          summary: 'Update a leave record, e.g. approve or reject it. Body must include "id".',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Leave' } } },
          },
          responses: ok('The updated record.', { $ref: '#/components/schemas/Leave' }),
        },
        delete: {
          tags: ['Leave'],
          operationId: 'deleteLeave',
          summary: 'Delete a leave record. Destructive.',
          parameters: [idParam],
          responses: ok('Deletion result.', { type: 'object' }),
        },
      },

      '/api/new/activity': {
        get: {
          tags: ['Activity'],
          operationId: 'listActivity',
          summary: 'Recent changes, newest first. Useful for "what changed today?".',
          parameters: [
            { name: 'source', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
          ],
          responses: ok('Activity entries.', arrayOf('Activity')),
        },
        post: {
          tags: ['Activity'],
          operationId: 'createActivity',
          summary: 'Record an activity entry.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Activity' } } },
          },
          responses: ok('The created entry.', { $ref: '#/components/schemas/Activity' }),
        },
      },

      '/api/new/student-history': {
        get: {
          tags: ['Students'],
          operationId: 'listStudentHistory',
          summary: 'Branch assignment history for a student, oldest first.',
          parameters: [
            { name: 'studentId', in: 'query', schema: { type: 'integer' } },
            { name: 'branch', in: 'query', schema: { type: 'string' } },
          ],
          responses: ok('History entries.', { type: 'array', items: { type: 'object' } }),
        },
        post: {
          tags: ['Students'],
          operationId: 'createStudentHistory',
          summary: 'Append a branch assignment for a student.',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: ok('The created entry.', { type: 'object' }),
        },
      },

      '/api/new/workload': {
        get: {
          tags: ['Reports'],
          operationId: 'getWorkload',
          summary: 'How many hours each instructor teaches, per day and in total. Answers "who is overloaded?".',
          description: 'Slots where every student is on leave are reported as leaveSessions and excluded from taught hours.',
          parameters: [
            { name: 'branch', in: 'query', schema: { type: 'string' } },
            { name: 'day', in: 'query', schema: { type: 'string' } },
            { name: 'instructor', in: 'query', schema: { type: 'string' } },
          ],
          responses: ok('Workload summary.', {
            type: 'object',
            properties: {
              instructorCount: { type: 'integer' },
              totalHours: { type: 'number' },
              data: { type: 'array', items: { type: 'object' } },
            },
          }),
        },
      },

      '/api/new/trial-availability': {
        get: {
          tags: ['Reports'],
          operationId: 'getTrialAvailability',
          summary: 'Which slots can still take a trial student, and why the rest cannot. Use this for "when can a new student come in?".',
          description: 'Accounts for branch hours and slot plan, instructor capability, existing bookings, and per-program seat limits.',
          parameters: [
            { name: 'branch', in: 'query', schema: { type: 'string' } },
            { name: 'day', in: 'query', schema: { type: 'string' } },
            { name: 'category', in: 'query', schema: { type: 'string', enum: ['Kinder', 'Junior', 'Coder'] } },
          ],
          responses: ok('Availability per slot.', {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              availableCount: { type: 'integer' },
              data: { type: 'array', items: { type: 'object' } },
            },
          }),
        },
      },
    },

    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Set NEW_OPS_API_KEY in the environment and send it as a bearer token.',
        },
      },
      schemas: {
        Class: {
          type: 'object',
          required: ['day', 'time', 'program', 'student', 'teacher', 'branchName'],
          properties: {
            id: { type: 'integer', readOnly: true },
            day: { type: 'string', example: 'Monday' },
            time: { type: 'string', example: '1.00 pm - 3.00 pm' },
            program: { type: 'string', example: 'JF1.5', description: 'Program code plus lesson number, or a Coder level.' },
            student: { type: 'string' },
            teacher: { type: 'string' },
            branchName: { type: 'string' },
            classType: { type: 'string', enum: ['Regular', 'Trial'], default: 'Regular' },
            remarks: { type: 'string', description: 'Contains "izin" when the student is on leave for that session.' },
          },
        },
        Student: {
          type: 'object',
          required: ['name', 'level', 'branchName'],
          properties: {
            id: { type: 'integer', readOnly: true },
            name: { type: 'string' },
            level: { type: 'string', example: 'Coder Advance' },
            branchName: { type: 'string' },
            parentName: { type: 'string' },
            contact: { type: 'string' },
            status: { type: 'string', enum: ['Active', 'Inactive'], default: 'Active' },
            remarks: { type: 'string' },
          },
        },
        Instructor: {
          type: 'object',
          required: ['name', 'level', 'branches', 'contact'],
          properties: {
            id: { type: 'integer', readOnly: true },
            name: { type: 'string' },
            level: { type: 'string', enum: ['Kinder and Junior', 'Junior and Coder'] },
            branches: { type: 'array', items: { type: 'string' }, description: 'Branch names, or "All Branches".' },
            contact: { type: 'string' },
            status: { type: 'string', enum: ['Active', 'Inactive'], default: 'Active' },
            remarks: { type: 'string' },
          },
        },
        Lead: {
          type: 'object',
          required: ['name', 'phone'],
          properties: {
            id: { type: 'integer', readOnly: true },
            name: { type: 'string' },
            phone: { type: 'string', example: '628123456789' },
            message: { type: 'string' },
            status: {
              type: 'string',
              enum: ['interest_trial', 'trial_booked', 'trial_done', 'closed'],
              default: 'interest_trial',
            },
            branch: { type: 'string' },
            trialDate: { type: 'string', example: '2026-07-18' },
            notes: { type: 'string' },
          },
        },
        OperationalRule: {
          type: 'object',
          required: ['branchName', 'day'],
          properties: {
            id: { type: 'integer', readOnly: true },
            branchName: { type: 'string' },
            day: { type: 'string' },
            isOpen: { type: 'boolean', default: true },
            openTime: { type: 'string', example: '11:00' },
            closeTime: { type: 'string', example: '18:30' },
            slots: {
              type: 'array',
              description: 'Ordered slot plan for that day.',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['kinder', 'junior', 'coder', 'any', 'break', 'training', 'meeting'],
                    description: 'break, training and meeting block the time instead of holding a class.',
                  },
                  start: { type: 'string', example: '13:00' },
                  end: { type: 'string', example: '15:00' },
                  label: { type: 'string' },
                },
              },
            },
          },
        },
        Leave: {
          type: 'object',
          required: ['name', 'startDate', 'endDate'],
          properties: {
            id: { type: 'integer', readOnly: true },
            name: { type: 'string', description: 'Instructor name.' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            reason: { type: 'string' },
            status: { type: 'string', enum: ['Approved', 'Pending', 'Rejected'], default: 'Approved' },
          },
        },
        Activity: {
          type: 'object',
          required: ['action', 'summary'],
          properties: {
            id: { type: 'integer', readOnly: true },
            action: { type: 'string', enum: ['add', 'edit', 'delete', 'bulk'] },
            summary: { type: 'string' },
            count: { type: 'integer', default: 1 },
            userEmail: { type: 'string' },
            source: { type: 'string', default: 'schedule' },
          },
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
