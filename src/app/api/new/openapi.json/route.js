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

/**
 * List filters of `/api/new/student-evaluations`, on top of the shared
 * `search` + `limit` pair. `search` matches the lesson topic, the instructor
 * remarks and the instructor name.
 *
 * `from`/`to` are a real range comparison on the stored `eval_date`, and the
 * route validates their shape before it touches the database, so a malformed
 * value is a 400 naming the parameter rather than a 500 from a failed cast.
 */
const evaluationListParams = [
  {
    name: 'studentId',
    in: 'query',
    schema: { type: 'integer' },
    description:
      'Filter to one student, by their id from /api/new/students. Nearly always '
      + 'set this — an evaluation only means anything in the context of one student.',
  },
  {
    name: 'instructorName',
    in: 'query',
    schema: { type: 'string' },
    description: 'Exact instructor name, as stored on the record. Use search for a partial match.',
  },
  {
    name: 'from',
    in: 'query',
    schema: { type: 'string', format: 'date' },
    description:
      'Return only evaluations dated on or after this "YYYY-MM-DD". Any other '
      + 'shape is rejected with 400 and no records are returned.',
  },
  {
    name: 'to',
    in: 'query',
    schema: { type: 'string', format: 'date' },
    description:
      'Return only evaluations dated on or before this "YYYY-MM-DD". Any other '
      + 'shape is rejected with 400 and no records are returned.',
  },
];

/** List filters of `/api/new/student-terms`, on top of `search` + `limit`. */
const termListParams = [
  {
    name: 'studentId',
    in: 'query',
    schema: { type: 'integer' },
    description: 'Filter to one student, by their id from /api/new/students.',
  },
  {
    name: 'year',
    in: 'query',
    schema: { type: 'integer', minimum: 2000, maximum: 2100 },
    description:
      'Filter to one calendar year (2000–2100). Stored as term_year. A value '
      + 'outside those bounds is rejected with 400.',
  },
];

/**
 * `POST /api/new/student-evaluations` is an upsert, not a create, so the
 * generated summary ("Add a record") would mislead an agent into thinking a
 * second post of the same day adds a second row. This override replaces the
 * generated `post` after the `crud()` spread and states the three things a
 * caller can get wrong: the day is replaced wholesale, the five scores are
 * required and refused rather than corrected, and `date` defaults to today.
 */
const evaluationCreateOperation = {
  tags: ['Evaluations'],
  operationId: 'createEvaluation',
  summary:
    'Save one student\'s evaluation for one teaching day. UPSERT on '
    + '(studentId, date) — posting a day that already has an evaluation '
    + 'REPLACES it instead of adding a second record. All five competency '
    + 'scores are required integers from 1 to 5.',
  description: [
    'There is at most one evaluation per student per calendar day. A second post',
    'of the same (studentId, date) overwrites every field of that day with this',
    'payload — nothing is merged, so send the whole record even when only one',
    'score changed.',
    '',
    'The five competency scores — concept, building, problemSolving, focus and',
    'attitude — are all required, and each must be an integer from 1 to 5. A',
    'missing, non-integer or out-of-range score is REJECTED with 400 naming the',
    'competency and carrying the value received. Nothing is clamped to 1 or 5',
    'and nothing is defaulted, because a report card a parent keeps must not',
    'hold a score no instructor entered. If a score is rejected, ask for the',
    'real rating rather than sending a corrected guess.',
    '',
    '`date` is optional: omitted or blank, the server\'s current calendar date is',
    'used. A malformed date, or one with the right shape but no such day such as',
    '"2026-02-30", is a 400. The API field is `date`; it is stored in the',
    '`eval_date` column, which is what list ordering and from/to compare against.',
    '',
    '`lessonTopic`, `instructorNotes` and `instructorName` are optional.',
    '`instructorName` is free text of at most 255 characters and is not checked',
    'against /api/new/instructors, so history survives an instructor leaving.',
  ].join('\n'),
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Evaluation' } } },
    examples: {
      oneDay: {
        summary: 'Rate one student for one day',
        value: {
          studentId: 42,
          date: '2026-08-03',
          lessonTopic: 'Loops and repetition',
          concept: 4,
          building: 5,
          problemSolving: 4,
          focus: 3,
          attitude: 5,
          instructorNotes: 'Worked through the repeat block on his own.',
          instructorName: 'Angel',
        },
      },
    },
  },
  responses: {
    ...ok('The stored evaluation for that student and day.', {
      $ref: '#/components/schemas/Evaluation',
    }),
    400: errorResponse(
      'A missing, non-integer or out-of-range competency score, a studentId '
      + 'that is not a positive integer, or a date that is not a real '
      + '"YYYY-MM-DD". The message names the field. Nothing is written.'
    ),
    500: errorResponse('The database rejected the write or is unreachable. Nothing is written.'),
  },
};

/**
 * `PUT /api/new/student-evaluations` overrides the generated update because two
 * behaviours are not derivable from the schema: the whole record is revalidated
 * (so this is a replace, not a patch), and moving a record onto a date the same
 * student already holds is a 409 rather than a silent overwrite of the other day.
 */
const evaluationUpdateOperation = {
  tags: ['Evaluations'],
  operationId: 'updateEvaluation',
  summary:
    'Edit one existing evaluation by id. The body must include "id" and all '
    + 'five competency scores. To change a day\'s ratings, prefer POST — it '
    + 'upserts that day.',
  description: [
    'The body is validated exactly as POST\'s is, so all five competency scores',
    'must be present integers from 1 to 5. This is a replace, not a patch: an',
    'omitted score is a 400, not "leave it as it was".',
    '',
    'Moving a record onto a date on which the same student already holds an',
    'evaluation is refused with 409 naming that date, and both records keep',
    'their field values. Open the existing day and edit that instead.',
    '',
    'An id matching no record is 404 "Evaluation not found", and nothing is',
    'changed.',
  ].join('\n'),
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Evaluation' } } },
  },
  responses: {
    ...ok('The updated evaluation.', { $ref: '#/components/schemas/Evaluation' }),
    400: errorResponse('Missing "id", or the same payload problems POST rejects. Nothing is changed.'),
    404: errorResponse('The id matches no evaluation. Nothing is changed.'),
    409: errorResponse(
      'That student already holds an evaluation on the requested date. Both '
      + 'records keep their values — open the existing day to edit it.'
    ),
    500: errorResponse('The database rejected the write or is unreachable.'),
  },
};

/**
 * `POST /api/new/student-terms` overrides the generated create for two reasons:
 * it upserts on the natural key, and an OMITTED `paid` key is not the same as
 * `paid: false`. The naive reading — absent means false — would let a request
 * that only edits the note flip a settled subscription to unpaid, so the rule is
 * stated here rather than left to be discovered.
 */
const termCreateOperation = {
  tags: ['Terms'],
  operationId: 'createStudentTerm',
  summary:
    'Record one term subscription for one student in one year. UPSERT on '
    + '(studentId, year, termNumber), so marking a term paid is one request '
    + 'whether or not the row exists. OMITTING "paid" leaves the stored flag '
    + 'unchanged — only an explicit false marks a term unpaid.',
  description: [
    'One row per (studentId, year, termNumber). Posting the same triple again',
    'updates that row rather than adding a second one, so the caller never has',
    'to know whether it already exists.',
    '',
    'Only the keys the payload actually carries are written. An OMITTED `paid`,',
    '`paidAt` or `note` leaves the stored value alone; an explicit `null` on',
    '`paidAt` or `note` clears it. In particular, a payload with no `paid` key',
    'says nothing about payment and will NOT mark the term unpaid, even though',
    'the column defaults to false on a first insert — otherwise a request that',
    'only edited a note would flip a paid term to unpaid and an administrator',
    'would chase a subscription that is already settled. Send `paid: false`',
    'when you mean unpaid.',
    '',
    '`year` must be an integer from 2000 to 2100 and `termNumber` an integer',
    'from 1 to 4; anything else is a 400 naming the field and its bounds, and no',
    'row is written. `paid` is read strictly — true/false, 1/0, or the strings',
    '"true"/"false"/"1"/"0" — so "false" can never arrive as true.',
    '',
    'The API field `year` is stored in the `term_year` column. There is no',
    'current-term or start-term field to set: both are derived on read from the',
    'term rows, so a student cannot be stored with two current terms. There is',
    'also no price, currency or invoice reference — billing is out of scope.',
  ].join('\n'),
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/StudentTerm' } } },
    examples: {
      markPaid: {
        summary: 'Mark term 2 of 2026 paid',
        value: { studentId: 42, year: 2026, termNumber: 2, paid: true, paidAt: '2026-08-01' },
      },
      noteOnly: {
        summary: 'Add a note without touching the paid flag',
        value: { studentId: 42, year: 2026, termNumber: 2, note: 'Parent asked for a receipt' },
      },
    },
  },
  responses: {
    ...ok('The stored term row.', { $ref: '#/components/schemas/StudentTerm' }),
    400: errorResponse(
      'studentId is not a positive integer, year is outside 2000–2100, '
      + 'termNumber is outside 1–4, paid is not a boolean value, or paidAt is '
      + 'not a real "YYYY-MM-DD". Nothing is written.'
    ),
    500: errorResponse('The database rejected the write or is unreachable. Nothing is written.'),
  },
};

/**
 * `PUT /api/new/student-terms` overrides the generated update because the triple
 * that identifies a term is deliberately not editable here — only the
 * subscription values are — and because at least one of them must be supplied.
 */
const termUpdateOperation = {
  tags: ['Terms'],
  operationId: 'updateStudentTerm',
  summary:
    'Edit the subscription values of one existing term row by id. The body must '
    + 'include "id" and at least one of paid, paidAt or note. Prefer POST, '
    + 'which upserts on (studentId, year, termNumber).',
  description: [
    'Only `paid`, `paidAt` and `note` are written. `studentId`, `year` and',
    '`termNumber` are not editable through this operation, so a PUT can never',
    'move a row onto another student\'s term or collide with the uniqueness of',
    'the triple. Re-filing a term is a POST of the new triple plus a DELETE of',
    'the old row.',
    '',
    'A body carrying none of the three is a 400: there would be nothing to',
    'write. An id matching no record is 404 "Term not found".',
  ].join('\n'),
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/StudentTerm' } } },
  },
  responses: {
    ...ok('The updated term row.', { $ref: '#/components/schemas/StudentTerm' }),
    400: errorResponse(
      'Missing "id", none of paid/paidAt/note supplied, or a supplied value out '
      + 'of bounds. Nothing is changed.'
    ),
    404: errorResponse('The id matches no term row. Nothing is changed.'),
    500: errorResponse('The database rejected the write or is unreachable.'),
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
      { name: 'Evaluations', description: 'Daily five-competency evaluations behind the student report cards.' },
      { name: 'Terms', description: 'Student term subscriptions — which terms are paid.' },
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
      '/api/new/student-evaluations': {
        ...crud({
          tag: 'Evaluations',
          path: '/api/new/student-evaluations',
          schemaName: 'Evaluation',
          listDescription:
            'List daily competency evaluations, oldest first (by date, then id). '
            + 'Set studentId to read one student\'s history; from/to narrow it to a '
            + 'date window. search matches the lesson topic, instructor remarks and '
            + 'instructor name.',
          createDescription: 'Save one student\'s evaluation for one day.',
          extraListParams: evaluationListParams,
        })['/api/new/student-evaluations'],
        // Overrides the generated create and update: POST upserts a day rather
        // than adding a row, and PUT revalidates the whole record and answers
        // 409 when it would land on a day the student already has.
        post: evaluationCreateOperation,
        put: evaluationUpdateOperation,
      },
      '/api/new/student-terms': {
        ...crud({
          tag: 'Terms',
          path: '/api/new/student-terms',
          schemaName: 'StudentTerm',
          listDescription:
            'List term subscription rows, ordered by year then term number. Set '
            + 'studentId to read one student\'s terms.',
          createDescription: 'Record one term subscription for one student.',
          extraListParams: termListParams,
        })['/api/new/student-terms'],
        // Overrides the generated create and update: POST upserts on the natural
        // key and treats an omitted "paid" as "leave it alone", and PUT edits
        // only the subscription values.
        post: termCreateOperation,
        put: termUpdateOperation,
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
        Evaluation: {
          type: 'object',
          description:
            'One student\'s evaluation of one teaching day. At most one record per '
            + '(studentId, date). The five competency scores are required integers '
            + 'from 1 to 5 and are rejected, never clamped, when out of range.',
          required: ['studentId', 'concept', 'building', 'problemSolving', 'focus', 'attitude'],
          properties: {
            id: { type: 'integer', readOnly: true },
            studentId: {
              type: 'integer',
              minimum: 1,
              description:
                'Student id from /api/new/students. There is no foreign key, so '
                + 'deleting the student leaves this record behind as an orphan.',
            },
            date: {
              type: 'string',
              format: 'date',
              example: '2026-08-03',
              description:
                'Calendar day of the lesson, "YYYY-MM-DD". Omit for the server\'s '
                + 'current date. Stored in the eval_date column; unique per student.',
            },
            lessonTopic: { type: 'string', example: 'Loops and repetition' },
            concept: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              description: 'Understanding of the concept taught. Required integer 1–5.',
            },
            building: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              description: 'Independence while building. Required integer 1–5.',
            },
            problemSolving: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              description: 'Problem solving. Required integer 1–5.',
            },
            focus: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              description: 'Following along and staying on task. Required integer 1–5.',
            },
            attitude: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              description: 'Attitude and enthusiasm. Required integer 1–5.',
            },
            instructorNotes: { type: 'string', description: 'Remarks printed on the report card.' },
            instructorName: {
              type: 'string',
              maxLength: 255,
              description:
                'Free text, at most 255 characters. Not checked against '
                + '/api/new/instructors, so a record naming a departed instructor '
                + 'stays editable.',
            },
            createdAt: { type: 'string', format: 'date-time', readOnly: true },
            updatedAt: { type: 'string', format: 'date-time', readOnly: true },
          },
        },
        StudentTerm: {
          type: 'object',
          description:
            'One term subscription row: one student, one calendar year, one term '
            + 'number 1–4. Holds a paid flag, an optional paid date and a note, and '
            + 'no price, currency or invoice reference. The current term and the '
            + 'start term are derived on read, not stored.',
          required: ['studentId', 'year', 'termNumber'],
          properties: {
            id: { type: 'integer', readOnly: true },
            studentId: {
              type: 'integer',
              minimum: 1,
              description:
                'Student id from /api/new/students. No foreign key, so deleting the '
                + 'student leaves this row behind as an orphan.',
            },
            year: {
              type: 'integer',
              minimum: 2000,
              maximum: 2100,
              example: 2026,
              description: 'Calendar year of the term. Stored in the term_year column.',
            },
            termNumber: {
              type: 'integer',
              minimum: 1,
              maximum: 4,
              description: 'Which term of that year — T1 to T4.',
            },
            paid: {
              type: 'boolean',
              description:
                'Whether the term is paid. OMITTING this key on a write leaves the '
                + 'stored flag unchanged; only an explicit false marks the term '
                + 'unpaid. A first insert with no paid key stores false.',
            },
            paidAt: {
              type: 'string',
              format: 'date',
              example: '2026-08-01',
              description: 'Date paid. Omit to keep the stored value, send null to clear it.',
            },
            note: {
              type: 'string',
              description: 'Free text. Omit to keep the stored value, send null to clear it.',
            },
            createdAt: { type: 'string', format: 'date-time', readOnly: true },
            updatedAt: { type: 'string', format: 'date-time', readOnly: true },
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
